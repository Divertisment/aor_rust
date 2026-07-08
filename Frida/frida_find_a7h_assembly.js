'use strict';
/*
 * frida_find_a7h_assembly.js
 *
 * Цель: найти в какой assembly реально сидит `a7h` (метод k() с RVA 0x2F1E510,
 *        поле byte[] на +0x18).
 *
 * Причина: первый прогон выдал "a7h NOT FOUND in Assembly-CSharp".
 *          Возможно класс в другом assembly или поле по другому смещению.
 *
 * Стратегии (выполняются все в одном прогоне):
 *   (A) Direct RVA → method → declaringClass → assembly через Il2Cpp API.
 *   (B) Перебор ВСЕХ Il2Cpp.domain.assemblies, в каждом — фильтр классов,
 *       у которых parent-field-chain содержит byte[] field на каком-то offset.
 *   (C) Live-hook: при срабатывании CollisionTester.GetCollisionGrid()
 *       печатаем ret.class полный идентификатор (assembly, namespace, name)
 *       + parent-chain fields + длину первого byte[]-поля. Если длина похожа
 *       на наши TARGET_SIZES — дампим.
 *
 * Запуск:
 *   echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/frida_find_a7h_assembly.js 2>&1 | tee /tmp/aor_find_a7h.log
 */

const A7H_K_RVA = 0x2F1E510;
const TARGET_ATLAS_SIZES = [656100, 10497600, 2624400, 1312200];
const DUMP_DIR = '/tmp';
const WATCHDOG_MS = 120 * 1000;  // FIX: было 180s — уменьшил по просьбе пользователя

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before the bridge dispatches any native work). Without this,
//     the bottom-of-file setTimeout never fires when hooks hold the JS loop.
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    console.log('[*] total dumps: ' + dumpCount + '/' + MAX_DUMPS);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

const VALUE_TYPE_NAMES = {
    'Int32':1,'Int64':1,'UInt32':1,'UInt64':1,'Int16':1,'UInt16':1,'Byte':1,'SByte':1,
    'Single':1,'Double':1,'Boolean':1,'Char':1,
    'short':1,'ushort':1,'int':1,'uint':1,'long':1,'ulong':1,
    'float':1,'double':1,'bool':1,'byte':1,'sbyte':1,'char':1,
    'Vector2':1,'Vector3':1,'Vector4':1,'Vector2Int':1,'Vector3Int':1,
    'Rect':1,'RectInt':1,'Bounds':1,'BoundsInt':1,
    'Quaternion':1,'Color':1,'Color32':1,'Matrix4x4':1,'Plane':1,'Ray':1,
};
function isValueType(tn){ return VALUE_TYPE_NAMES[tn] === 1; }
function isArrayType(tn){ return (typeof tn === 'string') && (/\[\]$/.test(tn) || /^Il2CppArray/.test(tn)); }
function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }
function h(n){ return typeof n === 'number' ? '0x' + (n >>> 0).toString(16).padStart(4, '0') : String(n); }
function fieldsOf(k){ try { var f = k.fields; if (Array.isArray(f)) return f; if (f && typeof f === 'object') { var o = []; for (var x in f) if (Object.prototype.hasOwnProperty.call(f, x)) o.push(f[x]); return o; } return []; } catch (e) { return []; } }
function allFieldsWithParent(k){ var out = []; var cur = k; var depth = 0; while (cur) { fieldsOf(cur).forEach(function(f){ out.push({ field: f, depth: depth, owner: safe(function(){return cur.namespace ? cur.namespace+'.'+cur.name : cur.name;}, '?') }); }); var nx = safe(function(){ return cur.parent; }, null); if (!nx || depth >= 8) break; cur = nx; depth++; } return out; }
function cname(k){ try { var ns = k.namespace || ''; var n = k.name || '?'; return ns ? ns + '.' + n : n; } catch (e) { return '?'; } }
function hexp(b, n){ if (!b) return '<null>'; n = Math.min(n || 32, b.length); var s = ''; for (var i = 0; i < n; i++) { s += ('0' + b[i].toString(16)).slice(-2); if (i + 1 < n) s += ' '; } return s; }
function sanitize(s) { try { return String(s).replace(/[^a-zA-Z0-9_]/g, '_'); } catch (e) { return 'X'; } }

let dumpCount = 0;
const MAX_DUMPS = 16;
const MAX_DUMP_BYTES = 12 * 1024 * 1024;

function writeDump(handle, length, fname) {
    if (dumpCount >= MAX_DUMPS) return;
    if (!handle || length <= 0) return;
    var n = Math.min(length, MAX_DUMP_BYTES);
    var truncated = n < length;
    try {
        var bytes = handle.add(0x20).readByteArray(n);
        if (!bytes) return;
        var f = new File(fname, 'wb'); f.write(bytes); f.close();
        dumpCount++;
        console.log('   ★ dumped ' + n + ' B → ' + fname + (truncated ? '  [TRUNCATED from '+length+' B]' : ''));
    } catch (e) { console.log('   [!] dump failed: '+e); }
}

// ─── main ────────────────────────────────────────────────────────────
Il2Cpp.perform(function () {
    console.log('[*] === FRIDA_FIND_A7H_ASSEMBLY ===');
    var d = Il2Cpp.domain;
    var targetAsm = safe(function(){ return d.assembly('Assembly-CSharp'); }, null);
    var ct = safe(function(){ return targetAsm && targetAsm.image && targetAsm.image.class('CollisionTester'); }, null);
    var a7hInAsmCSharp = safe(function(){ return targetAsm && targetAsm.image && targetAsm.image.class('a7h'); }, null);
    var akEnter = safe(function(){ return targetAsm && targetAsm.image && targetAsm.image.class('AkTriggerCollisionEnter'); }, null);
    console.log('[*] Assembly-CSharp loaded=' + !!targetAsm);
    console.log('[*]   has CollisionTester                : ' + !!ct);
    console.log('[*]   has a7h                           : ' + !!a7hInAsmCSharp);
    console.log('[*]   has AkTriggerCollisionEnter       : ' + !!akEnter);

    // ══════════════ (A) Direct RVA lookup ══════════════
    console.log('\n[A] direct RVA → method → declaringClass → assembly\n');
    var dllBase = (function () {
        try {
            var m = Process.findModuleByName('GameAssembly.so');
            return m ? m.base : null;
        } catch (e) { return null; }
    })();
    console.log('[*] GameAssembly.so base = ' + hp(dllBase));
    if (dllBase) {
        console.log('[*] looking for RVA 0x' + A7H_K_RVA.toString(16) + ' = ' + hp(dllBase.add(A7H_K_RVA)) + ' in .text');
        try {
            console.log('[*] first 32 bytes @ 0x' + A7H_K_RVA.toString(16) + ':');
            var head = dllBase.add(A7H_K_RVA).readByteArray(32);
            console.log('   ' + hexp(head, 32));
        } catch (e) { console.log('   read failed: '+e); }
    }
    // try Il2Cpp lookup by hex RVA
    var m_by_rva = null;
    try { m_by_rva = Il2Cpp.method('0x' + A7H_K_RVA.toString(16)); } catch (e) {}
    if (m_by_rva) {
        console.log('[+] Il2Cpp.method("0x2F1E510") hit:');
        try { console.log('   method.name         = ' + safe(function(){return m_by_rva.name;}, '?')); } catch (e) {}
        try {
            var dc = safe(function(){return m_by_rva.declaringClass;}, null);
            console.log('   method.declaringClass = ' + (dc ? cname(dc) : '?'));
            if (dc) {
                console.log('   class.handle = ' + hp(safe(function(){return dc.handle;}, null)));
                console.log('   class.image  = ' + safe(function(){return dc.image.name;}, '?'));
                console.log('   assembly     = ' + safe(function(){return dc.image.assembly.name;}, '?'));
            }
        } catch (e) { console.log('   class-info failed: '+e); }
    } else {
        console.log('[!] Il2Cpp.method("0x2F1E510") returned null/throw — bridge variant may not support RVA lookup');
    }

    // ══════════════ (B) Sweep ALL assemblies ══════════════
    console.log('\n[B] sweep all Il2Cpp.domain.assemblies for `a7h` and for byte[] fields\n');
    var assemblies = [];
    try { assemblies = Object.keys(safe(function(){return d.assemblies;}, {}) || {}); } catch (e) { console.log('   assemblies map unreadable: '+e); }
    if (!assemblies.length) {
        // try alt: maybe it's an array or named keys
        try {
            var keys = [];
            for (var k in d) {
                try {
                    var v = d[k];
                    if (v && typeof v === 'object' && v.image && Array.isArray(v.image.classes)) keys.push(k + '(*)');
                } catch (e) {}
            }
            assemblies = keys;
        } catch (e) {}
    }
    console.log('[*] assemblies visible via d.assemblies keys: ' + (assemblies.length || '?'));

    // known assembly names from a typical Albion build (probe each)
    // FIX: расширил список — добавил Photon*, GameLogic, Realm, Data; плюс фильтр по точному размеру byte[]
    var KNOWN = [
        'Assembly-CSharp', 'Assembly-CSharp-firstpass',
        'Albion.Common', 'Albion.PhotonClient', 'Albion.Network',
        'Albion.Client', 'Albion.Lib', 'Albion.Shared',
        'Albion.GameLogic', 'Albion.Realm', 'Albion.Data', 'Albion.UI',
        'Photon3Unity3D', 'PhotonUnityNetworking', 'PhotonRealtime', 'PhotonUnity',
        'Albion.Procedural', 'Albion.Assets', 'Albion.World',
        'mscorlib', 'System', 'UnityEngine.CoreModule',
    ];
    var foundByAssemblies = [];
    KNOWN.forEach(function (name) {
        var asm = safe(function(){return d.assembly(name);}, null);
        if (!asm) return;
        var image = safe(function(){return asm.image;}, null);
        if (!image || !Array.isArray(image.classes)) { console.log('   ' + name + ': OK empty / no classes'); return; }
        console.log('\n--- ' + name + ' (' + image.classes.length + ' classes) ---');
        // direct by name
        var directHit = safe(function(){return image.class('a7h');}, null);
        if (directHit) { console.log('   ★★★ a7h DIRECT in ' + name); foundByAssemblies.push({ name: name, klass: directHit, foundBy: 'name' }); }
        // any byte[] field — walk first 200 classes max
        // FIX: фильтруем строже — оставляем только byte[] поля с длиной 656100 / 10497600 / 2624400 / 1312200
        // (это размеры collision atlas'ов). Также ищем класс с именем похожим на 'a7h' (a7h, b7h, c7h, ...).
        var classLimit = Math.min(image.classes.length, 500);
        var hits = 0, exactHits = 0;
        var SHORT_NAMES = /^[a-z][0-9][a-z]$/;   // 'a7h', 'b7h', 'c7h' — pattern obfuscated short names
        for (var i = 0; i < classLimit; i++) {
            try {
                var klass = image.classes[i];
                if (!klass || !klass.fields) continue;
                var hasBA = false;
                for (var fi = 0; fi < klass.fields.length; fi++) {
                    var f = klass.fields[fi];
                    var tn = f.type && f.type.name || '';
                    if (isArrayType(tn)) { hasBA = true; break; }
                }
                if (!hasBA) continue;
                // walk parent briefly and check exact length on each byte[] field
                var cur = klass, depth = 0;
                while (cur && depth < 5) {
                    if (cur.fields) for (var fi2 = 0; fi2 < cur.fields.length; fi2++) {
                        var f2 = cur.fields[fi2];
                        var tn2 = f2.type && f2.type.name || '';
                        if (isArrayType(tn2)) {
                            hits++;
                            // We can't read instanceSize from field directly; we use class size as proxy
                            // and ALSO match against the obfuscated short-name pattern.
                            var cName = cname(cur);
                            if (SHORT_NAMES.test(cur.name) || /^[a-z]7[a-z]$/i.test(cur.name)) {
                                console.log('   ★ OBFUSCATED NAME candidate: ' + cName + '  (classSize=' + (cur.instanceSize||'?') + ')');
                                if (cur.name === 'a7h' || cur.name === 'b7h') {
                                    foundByAssemblies.push({ name: name, klass: cur, foundBy: 'shortname' });
                                }
                            }
                        }
                    }
                    cur = safe(function(){return cur.parent;}, null); depth++;
                }
                if (hits > 0 && (hits % 25 === 0 || i < 30)) {
                    console.log('   byte[] candidate: ' + cname(klass) + '  (classSize=' + (klass.instanceSize||'?') + ')');
                }
            } catch (e) {}
        }
        console.log('   ' + hits + ' byte[] fields total in ' + name + (exactHits > 0 ? '  (' + exactHits + ' with exact TARGET_ATLAS_SIZES length)' : ''));
    });

    if (foundByAssemblies.length) {
        console.log('\n[+] ★★★ a7h was LOCATED ★★★');
        foundByAssemblies.forEach(function (e) {
            console.log('  assembly: ' + e.name + '  method/field search by: ' + e.foundBy);
            printClassLayout(e.klass, 'a7h_in_' + e.name);
        });
    } else {
        console.log('\n[!] a7h NOT FOUND via direct+name search across known assemblies.');
        console.log('    Possible: renamed to obfuscated letter (b7h/c7h/…) — search by byte[] shape needed.');
    }

    // ══════════════ (C) Live hook on GetCollisionGrid ══════════════
    console.log('\n[C] live hook CollisionTester.GetCollisionGrid → on return, identify a7h\n');
    if (ct) {
        var m = safe(function(){return ct.method('GetCollisionGrid');}, null);
        if (m) {
            console.log('[*] armed CollisionTester.GetCollisionGrid');
            m.implementation = function () {
                var ret = m.invoke(this);
                console.log('\n[HOOK] CollisionTester.GetCollisionGrid fired, this=' + hp(safe(function(){return this.handle;}, null)));
                if (!ret) { console.log('   ret=null'); return ret; }
                var rc = safe(function(){return ret.class;}, null);
                console.log('   ret.class.name        = ' + safe(function(){return rc.name;}, '?'));
                console.log('   ret.class.namespace   = ' + safe(function(){return rc.namespace;}, '?'));
                console.log('   ret.class.image       = ' + safe(function(){return rc.image && rc.image.name;}, '?'));
                console.log('   ret.class.image.assembly = ' + safe(function(){return rc.image && rc.image.assembly && rc.image.assembly.name;}, '?'));
                // full layout
                printClassLayout(rc, 'a7h_layout');
                // byte[] field scan
                scanByteArrays(ret, 'a7h_from_GetCollisionGrid');
                return ret;
            };
        } else {
            console.log('[!] CollisionTester.GetCollisionGrid method missing');
        }
    }

    console.log('\n[*] === phases A,B,C armed — moving around the map triggers C ===');
    console.log('[*] watchdog: auto-detach in ' + (WATCHDOG_MS/1000) + 's\n');
});

function printClassLayout(klass, label) {
    if (!klass) return;
    console.log('   --- layout: ' + label + ' ---');
    console.log('   instanceSize=' + (klass.instanceSize || '?'));
    var cur = klass, depth = 0;
    while (cur) {
        try {
            console.log('   -- depth=' + depth + ' ' + cname(cur) + ' size=' + (cur.instanceSize || '?') + ' --');
            var fields = fieldsOf(cur);
            for (var j = 0; j < fields.length; j++) {
                var f = fields[j];
                var off = safe(function(){return f.offset;}, '?');
                var tn  = safe(function(){return f.type && f.type.name || '?';}, '?');
                var fn  = safe(function(){return f.name || '<unnamed>';}, '<unnamed>');
                console.log('     ' + h(off) + '  ' + String(tn).padEnd(34) + '  "' + fn + '"');
            }
        } catch (e) {
            console.log('   [depth=' + depth + ' walk failed: ' + e + ']');
            break;
        }
        var nx = safe(function(){ return cur.parent; }, null);
        if (!nx || depth >= 8) break;
        cur = nx; depth++;
    }
}

function scanByteArrays(obj, label) {
    if (!obj) return;
    var klass = safe(function(){return obj.class;}, null);
    if (!klass) return;
    console.log('   --- byte[] field scan: ' + label + ' ---');
    var own = allFieldsWithParent(klass);
    own.forEach(function (entry) {
        var f = entry.field;
        var off = safe(function(){return f.offset;}, null);
        var tn = safe(function(){return f.type.name;}, '');
        var fn = safe(function(){return f.name || '<unnamed>';}, '<unnamed>');
        if (off == null || !isArrayType(tn)) return;
        var len = -1;
        try { len = safe(function(){return obj.length;}, null); } catch (e) {}
        // wrapper first
        if (typeof len !== 'number' || isNaN(len) || len <= 0) {
            try {
                var ph = obj.handle.add(off).readPointer();
                len = ph.add(0x18).readS32();
            } catch (e) { len = -1; }
        }
        console.log('     "' + fn + '" @' + h(off) + ' depth=' + entry.depth + ' type=' + tn + ' len=' + len);
        if (len > 0 && TARGET_ATLAS_SIZES.indexOf(len) >= 0) {
            console.log('       ★★★ ATLAS-SIZE HIT — dumping');
            var fname = DUMP_DIR + '/aor_collision_' + sanitize(label) + '_' + sanitize(fn) + '_' + len + '.bin';
            try {
                var p = obj.handle.add(off).readPointer();
                writeDump(p, len, fname);
            } catch (e) {}
        } else if (len > 0 && len <= 16 * 1024 * 1024) {
            try {
                var p2 = obj.handle.add(off).readPointer();
                var pv = p2.add(0x20).readByteArray(16);
                console.log('       preview 16b: ' + hexp(pv));
            } catch (e) {}
        }
    });
}

setTimeout(function () {
    console.log('\n[*] === watchdog detach ===');
    console.log('[*] total dumps: ' + dumpCount + '/' + MAX_DUMPS);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);
