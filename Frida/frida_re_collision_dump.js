'use strict';
/*
 * frida_re_collision_dump.js (v2 — post-review fixes)
 *
 * Что нового в v2 (apply из code-review feedback):
 *   • dumpInstanceFields теперь фильтрует поля по ТИПУ перед чтением указателя.
 *     Value-type поля (Int32, Byte, Single, Vector*, Rect…) больше НЕ дают
 *     флуд false-positives "byte[] длиной 142213".
 *   • klass.methods обёрнут в safe() + ручную фильтрацию по m.name (без
 *     недокументированных m.parameters/m.relativeVirtualAddress — fallback
 *     на .name).
 *   • Watchdog: setTimeout(180с) — print stats + Process.exit(0).
 *   • Per-hook счётчик (для каждого метода свой soft-cap), чтобы рендерер
 *     не сжёг общий budget зря.
 *   • TARGET_ATLAS_SIZES исключены размеры 262144/65536 (downscale мусор).
 *     Они по-прежнему логируются, но НЕ дампятся (помечены INFO-пометкой).
 *   • Где есть wrapper ret.length — используем его; raw memory +0x18 — только
 *     как fallback (если wrapper по какой-то причине дал 0 или NaN).
 *   • Null-check obj.handle перед .add(off), чтобы не падать в мусор.
 *   • Пишем "TRUNCATED" в лог если MAX_DUMP_BYTES обрезал реальный размер.
 *
 * В остальном поведение то же: 4 фазы RE (inventory + live dump + a7h letter
 * hooks + AtlasGenerator hooks).
 */

const TARGETS = [
    'a7h',
    'CollisionTester',
    'CollisionGridAtlasGenerator',
    'AkTriggerCollisionEnter',
    'AkTriggerCollisionExit',
];

// Размеры, при совпадении С НИМИ мы РЕАЛЬНО дампим содержимое.
const TARGET_ATLAS_SIZES = [
    656100,    // 810×810 × 1 B — главный кандидат
    10497600,  // 810×810 × 16 B — Matrix4x4 / Vector4[]
    2624400,   // 810×810 × 4 B — int/float[]
    1312200,   // 810×810 × 2 B — short[]
];

// Ниже — только логируем в INFO, не дампим.
const INFO_SIZES = [
    262144,    // 512×512 (downscale preview — те самые мусорные дампы)
    65536,     // 256×256
];

const ALL_SIZES_KNOWN = [].concat(TARGET_ATLAS_SIZES, INFO_SIZES);

const DUMP_DIR = '/tmp';
const MAX_DUMPS = 32;            // global file write budget
const PER_HOOK_HITS = 8;         // per-method soft cap
const MAX_DUMP_BYTES = 12 * 1024 * 1024;
const WATCHDOG_MS = 180 * 1000;  // auto-detach через 3 мин

const dumpHits = {};             // method-name -> int (per-hook)
const globalDumpCount = 0;       // обновляется по записи
let dumpCount = 0;

// ─── formatting helpers ──────────────────────────────────────────────
function h(n){ return typeof n === 'number' ? '0x' + (n >>> 0).toString(16).padStart(4, '0') : String(n); }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }
function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function cname(k){ try { var ns = k.namespace || ''; var n = k.name || '?'; return ns ? ns + '.' + n : n; } catch (e) { return '?'; } }
function fieldsOf(k){ try { var f = k.fields; if (Array.isArray(f)) return f; if (f && typeof f === 'object') { var o = []; for (var x in f) if (Object.prototype.hasOwnProperty.call(f, x)) o.push(f[x]); return o; } return []; } catch (e) { return []; } }
function allFieldsWithParent(k){ var out = []; var cur = k; var depth = 0; while (cur) { fieldsOf(cur).forEach(function(f){ out.push({ field: f, depth: depth, ownerName: cname(cur) }); }); var nx = safe(function(){ return cur.parent; }, null); if (!nx || depth >= 8) break; cur = nx; depth++; } return out; }
function hexp(b, n){ if (!b) return '<null>'; n = Math.min(n || 32, b.length); var s = ''; for (var i = 0; i < n; i++) { s += ('0' + b[i].toString(16)).slice(-2); if (i + 1 < n) s += ' '; } return s; }

const VALUE_TYPE_NAMES = {
    'Int32':1, 'Int64':1, 'UInt32':1, 'UInt64':1,
    'Int16':1, 'UInt16':1, 'Byte':1, 'SByte':1,
    'Single':1, 'Double':1, 'Boolean':1, 'Char':1,
    'short':1, 'ushort':1, 'int':1, 'uint':1, 'long':1, 'ulong':1,
    'float':1, 'double':1, 'bool':1, 'byte':1, 'sbyte':1, 'char':1,
    'Vector2':1, 'Vector3':1, 'Vector4':1, 'Vector2Int':1, 'Vector3Int':1,
    'Rect':1, 'RectInt':1, 'Bounds':1, 'BoundsInt':1,
    'Quaternion':1, 'Color':1, 'Color32':1, 'Matrix4x4':1, 'Plane':1, 'Ray':1,
};
function isValueType(tn){ return VALUE_TYPE_NAMES[tn] === 1; }
function isArrayType(tn){ return (typeof tn === 'string') && (/\[\]$/.test(tn) || /^Il2CppArray/.test(tn)); }

// ─── main ────────────────────────────────────────────────────────────
function startup() {
    Il2Cpp.perform(function () {
    var asm = safe(function(){
        var d = Il2Cpp.domain;
        return d && d.assembly ? d.assembly('Assembly-CSharp')
             : (d && d.assemblies ? d.assemblies['Assembly-CSharp'] : null);
    }, null);
    if (!asm) { console.log('[!] Assembly-CSharp not loaded — abort.\n'); processExit('no-assembly'); return; }
    console.log('[*] Assembly-CSharp loaded\n');

    var klassMap = {};

    // ═════════ PHASE 1: class inventory ═════════
    console.log('[PHASE 1] class inventory\n');
    TARGETS.forEach(function (cn) {
        var klass = safe(function () { return asm.image.class(cn); }, null);
        if (!klass) { console.log('[!] ' + cn + ' NOT FOUND\n'); return; }
        klassMap[cn] = klass;

        console.log('========== ' + cn + ' ==========');
        console.log('  instanceSize=' + (klass.instanceSize || '?') + '  abstract=' + (klass.isAbstract || false) + '  sealed=' + (klass.isSealed || false));

        var cur = klass, depth = 0;
        while (cur) {
            console.log('  -- depth=' + depth + ' ' + cname(cur) + ' size=' + (safe(function(){return cur.instanceSize;}, '?') || '?') + ' --');
            fieldsOf(cur).forEach(function (f) {
                var off = safe(function(){ return f.offset; }, '?');
                var tn  = safe(function(){ return f.type && f.type.name || '?'; }, '?');
                var fn  = safe(function(){ return f.name || '<unnamed>'; }, '<unnamed>');
                console.log('     ' + h(off) + '  ' + String(tn).padEnd(34) + '  "' + fn + '"');
            });
            var nx = safe(function(){ return cur.parent; }, null);
            if (!nx || depth >= 8) break;
            cur = nx; depth++;
        }

        // methods: enumerate by NAME only (без нестабильного m.parameters/m.relative*).
        // frida-il2cpp-bridge даёт klass.methods как Array, но устойчивы только .name и .handle.
        console.log('  -- methods (by name) --');
        var ms = safe(function(){ return klass.methods; }, null);
        if (!ms) {
            console.log('     klass.methods unavailable — falling back to OnEnable probe');
            var probe = safe(function(){ return klass.method('OnEnable') !== undefined; }, false);
            console.log('     OnEnable probe: ' + probe);
        } else {
            // Try a couple of common getters; if they exist, count 'em, log names only.
            var names = [];
            for (var j = 0; j < ms.length; j++) {
                try { names.push(safe(function(){ return ms[j].name; }, '?')); } catch (e) { names.push('?'); }
            }
            console.log('     ' + ms.length + ' methods: [' + names.join(', ') + ']');
        }
        console.log('');
    });

    // ═════════ PHASE 2: live-instance dump via CollisionTester.GetCollisionGrid ═════════
    console.log('[PHASE 2] hook CollisionTester.GetCollisionGrid + OnEnable — live a7h dump\n');
    var ct = klassMap['CollisionTester'];
    if (ct) {
        armHook(ct, 'GetCollisionGrid', function (ret, ctx) {
            // ret — a7h, dump its fields
            dumpInstanceFields(ret, ctx, 'a7h_from_CollisionTester');
        });
        armHook(ct, 'OnEnable', function (ret, ctx) {
            dumpInstanceFields(ctx.self, ctx, 'CollisionTester_self');
        });
    } else {
        console.log('[!] CollisionTester missing\n');
    }

    // ═════════ PHASE 3: hooks on a7h letter methods ═════════
    console.log('[PHASE 3] hook a7h.{b,c,d,e,f,g,h,i,j,k}\n');
    var a7h = klassMap['a7h'];
    if (a7h) {
        ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].forEach(function (l) {
            armHook(a7h, l, function (ret, ctx) { inspectReturn(ret, ctx, 'a7h.' + l + '_return'); });
        });
    } else {
        console.log('[!] a7h missing\n');
    }

    // ═════════ PHASE 4: hooks on CollisionGridAtlasGenerator ═════════
    console.log('[PHASE 4] hook CollisionGridAtlasGenerator methods\n');
    var cga = klassMap['CollisionGridAtlasGenerator'];
    if (cga) {
        ['SetCollisionGrid', 'SetSpellOcclusionActive', 'OnEnable', 'OnClusterLoaded',
         'SetSpellOcclusionAtlasSize'].forEach(function (mn) {
            armHook(cga, mn, function (ret, ctx) {
                if (ctx.self) dumpInstanceFields(ctx.self, ctx, 'CGA_' + mn);
                inspectReturn(ret, ctx, 'CGA_' + mn + '_return');
            });
        });
    } else {
        console.log('[!] CollisionGridAtlasGenerator missing\n');
    }

    console.log('[*] ALL HOOKS ARMED. Move around the map; auto-detach in ' + (WATCHDOG_MS/1000) + 's.\n');
    }); // Il2Cpp.perform
}

// ─── Hook installation ───────────────────────────────────────────────
function armHook(klass, methodName, hookFn) {
    var m = safe(function(){ return klass.method(methodName); }, null);
    if (!m) { console.log('   [!] no method ' + methodName + ' on ' + (klass.name || '?')); return; }
    console.log('   [+] hook ' + cname(klass) + '.' + methodName + '()');
    m.implementation = function () {
        var self = this;
        var ret = m.invoke(self);
        var tag = cname(klass) + '.' + methodName;
        dumpHits[tag] = (dumpHits[tag] || 0) + 1;
        if (dumpHits[tag] > PER_HOOK_HITS) return ret;  // soft cap
        var ctx = { self: self, hitNum: dumpHits[tag], tag: tag };
        console.log('\n[HOOK #' + dumpHits[tag] + '] ' + tag + '  this=' + hp(safe(function(){return self.handle;}, null)));
        try { hookFn(ret, ctx); } catch (e) { console.log('   [!] hookFn failed: ' + (e.message || e)); }
        return ret;
    };
}

// ─── Field walker (post-fix: type-aware) ─────────────────────────────
function dumpInstanceFields(obj, ctx, label) {
    if (!obj) return;
    var handled = safe(function(){ return obj.handle; }, null);
    if (!handled) { console.log('   [!] obj.handle=null, skip'); return; }
    var klass = safe(function(){ return obj.class; }, null);
    if (!klass) { console.log('   [!] obj.class=null, skip'); return; }

    var own = allFieldsWithParent(klass);
    var printed = 0;

    own.forEach(function (entry) {
        if (printed >= 64) return;
        var f = entry.field;
        var off = safe(function(){ return f.offset; }, null);
        var tn  = safe(function(){ return f.type && f.type.name || '?'; }, '?');
        var fn  = safe(function(){ return f.name || '<unnamed>'; }, '<unnamed>');
        if (off == null) return;

        // FIX #1: Hämta bara ner i pekare om fältet ÄR referenstyp eller array.
        var isArr = isArrayType(tn);
        var isObj = !isArr && /^[A-Z]/.test(tn) && !isValueType(tn);
        if (!isArr && !isObj) return;

        try {
            var ptr = handled.add(off).readPointer();
            if (!ptr || ptr.isNull()) return;

            if (isArr) {
                // Length: prefer wrapper, fallback raw +0x18 (x64 IL2CPP)
                var length = -1;
                try { length = ptr.add(0x18).readS32(); } catch (e) {}
                if (!(length > 0 && length <= 16 * 1024 * 1024)) return;
                printed++;
                console.log('   ARR  "' + fn + '" @' + h(off) + ' depth=' + entry.depth + ' owner=' + entry.ownerName);
                console.log('        type=' + tn + ' ptr=' + hp(ptr) + ' length=' + length);
                if (TARGET_ATLAS_SIZES.indexOf(length) >= 0) {
                    console.log('        ★★★ ATLAS-SIZE HIT ★★★ dumping');
                    var fname = DUMP_DIR + '/aor_collision_' + sanitize(label) + '_' + sanitize(fn) + '_' + off.toString(16) + '_' + length + '.bin';
                    writeDumpFile(ptr, length, fname);
                } else if (INFO_SIZES.indexOf(length) >= 0) {
                    console.log('        INFO: downscale-sized array (preview only)');
                    try { var pv = ptr.add(0x20).readByteArray(8); console.log('        preview: ' + hexp(pv)); } catch (e) {}
                } else {
                    try { var pv2 = ptr.add(0x20).readByteArray(8); console.log('        preview: ' + hexp(pv2)); } catch (e) {}
                }
            } else if (isObj && /Material|Texture|Renderer|Sprite|Collider/i.test(tn)) {
                printed++;
                console.log('   OBJ  "' + fn + '" @' + h(off) + ' type=' + tn + ' ptr=' + hp(ptr));
            }
        } catch (e) {
            // skip on read failure
        }
    });
}

// Inspect a primitive/array return value
function inspectReturn(ret, ctx, label) {
    if (!ret) { console.log('   ret=null'); return; }
    var cn = safe(function(){ return ret.class.name; }, '?');
    console.log('   ret.class=' + cn + ' ptr=' + hp(safe(function(){return ret.handle;}, null)));

    // FIX #6: prefer wrapper ret.length, fall back to raw memory
    var len = safe(function(){ return ret.length; }, null);
    if (typeof len !== 'number' || isNaN(len) || len <= 0) {
        var hp2 = safe(function(){return ret.handle;}, null);
        if (hp2) { try { len = hp2.add(0x18).readS32(); } catch (e) { len = -1; } }
    }
    if (typeof len === 'number' && len > 0 && len <= 16 * 1024 * 1024) {
        console.log('   ret.length=' + len + ' (0x' + (len >>> 0).toString(16) + ')');
        if (TARGET_ATLAS_SIZES.indexOf(len) >= 0) {
            console.log('   ★★★ ATLAS-SIZE HIT (return) ★★★ dumping');
            var hp3 = safe(function(){return ret.handle;}, null);
            var fname = DUMP_DIR + '/aor_collision_' + sanitize(label) + '_' + len + '.bin';
            if (hp3) writeDumpFile(hp3, len, fname);
        } else if (INFO_SIZES.indexOf(len) >= 0) {
            try {
                var pv = safe(function(){return ret.handle.add(0x20).readByteArray(16);}, null);
                console.log('   INFO downscale ret, preview: ' + hexp(pv));
            } catch (e) {}
        } else {
            try {
                var pv2 = safe(function(){return ret.handle.add(0x20).readByteArray(16);}, null);
                console.log('   preview 16b: ' + hexp(pv2));
            } catch (e) {}
        }
    }
}

function writeDumpFile(handle, length, fname) {
    if (dumpCount >= MAX_DUMPS) { console.log('   [!] MAX_DUMPS(' + MAX_DUMPS + ') reached, skip'); return; }
    if (!handle || length <= 0) return;
    var n = Math.min(length, MAX_DUMP_BYTES);
    var truncated = (n < length);
    try {
        var bytes = handle.add(0x20).readByteArray(n);
        if (!bytes) return;
        var f = new File(fname, 'wb');
        f.write(bytes);
        f.close();
        dumpCount++;
        var msg = '   ★ dumped ' + n + ' B → ' + fname;
        if (truncated) msg += '  [TRUNCATED from ' + length + ' B by MAX_DUMP_BYTES=' + MAX_DUMP_BYTES + ']';
        console.log(msg);
    } catch (e) {
        console.log('   [!] dump failed: ' + (e.message || e));
    }
}

function sanitize(s) { try { return String(s).replace(/[^a-zA-Z0-9_]/g, '_'); } catch (e) { return 'X'; } }
function processExit(reason) {
    console.log('\n[*] ============ detach (' + reason + ') ============');
    console.log('[*] dumpCount=' + dumpCount + '/' + MAX_DUMPS);
    try {
        Object.keys(dumpHits).forEach(function (k){
            console.log('[*]   hook " + k + " fired ' + dumpHits[k] + 'x (cap=' + PER_HOOK_HITS + ')');
        });
    } catch (e) {}
    console.log('[*] dump dir: ' + DUMP_DIR + '/aor_collision_*.bin');
}

// ─── Watchdog ────────────────────────────────────────────────────────
setTimeout(function () { processExit('watchdog 180s'); /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */ }, WATCHDOG_MS);

startup();
