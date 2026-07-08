'use strict';
/*
 * frida_dump_byte_candidates.js
 *
 * Цель: найти настоящий byte[] массiv карты коллизий в Albion.Common
 *       (810×810 = 656100 B).
 *
 * Стратегия (по рекомендации thinker-with-files-gemini):
 *   PHASE A — STATIC scan: пройти все классы Albion.Common, для каждого
 *             вывести все Byte[] declared fields с class+field+offset.
 *             Это статическая карта, ничего живого.
 *
 *   PHASE B — DYNAMIC: хуки на CollisionTester.GetCollisionGrid(),
 *             a7h.k(), a7h.b(), и ключевые методы
 *             CollisionGridAtlasGenerator. На каждом срабатывании —
 *             пройти parent-chain поля THIS, для каждого Byte[] поля
 *             прочитать (.add(off)).readPointer().add(0x18).readS32()
 *             С null-check — БЕЗ disk-dump, печатаем только длину.
 *             Если длина в [656100, 10497600, 2624400, 1312200] —
 *             помечаем как кандидат и АВТО-ДАМПИМ в /tmp.
 *
 * НЕ используем Il2Cpp.choose() (thinker'ом отвергнут: замораживает
 * потоки и форсит GC).
 *
 * Использует frida-il2cpp-bridge v0.13.1.
 *
 * Запуск:
 *   echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/frida_dump_byte_candidates.js 2>&1 | tee /tmp/aor_byte_dump.log
 */

const TARGET_SIZES = [656100, 10497600, 2624400, 1312200];
const DUMP_DIR = '/tmp';
const MAX_DUMPS = 8;
const WATCHDOG_MS = 180 * 1000;

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before the bridge dispatches any native work). Without this,
//     the bottom-of-file setTimeout never fires when hooks hold the JS loop.
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    console.log('[*] dumps produced: ' + dumpCount + '/' + MAX_DUMPS);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }
function h(n){ return typeof n === 'number' ? '0x' + (n >>> 0).toString(16).padStart(4, '0') : String(n); }
function cname(k){ try { var ns = (k.namespace || ''); var n = (k.name || '?'); return ns ? ns + '.' + n : n; } catch (e) { return '?'; } }

let dumpCount = 0;
function tryAutoDump(handle, length, label) {
    if (dumpCount >= MAX_DUMPS) return;
    if (!handle || length <= 0 || length > 16 * 1024 * 1024) return;
    try {
        var n = Math.min(length, 12 * 1024 * 1024);
        var bytes = handle.add(0x20).readByteArray(n);
        if (!bytes) return;
        var fname = DUMP_DIR + '/aor_collision_' + label.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + length + '.bin';
        var f = new File(fname, 'wb'); f.write(bytes); f.close();
        dumpCount++;
        console.log('   ★ DUMPED ' + n + ' B → ' + fname + (n < length ? '  [TRUNCATED from ' + length + ' B]' : ''));
    } catch (e) {
        console.log('   [!] dump failed: ' + (e.message || e));
    }
}

function lengthOf(hpPtr) {
    if (!hpPtr || hpPtr.isNull()) return -1;
    try { return hpPtr.add(0x18).readS32(); } catch (e) { return -1; }
}

function scanByteArrayLengths(klass, instanceHandle, label, doAutoDump) {
    if (!klass || !instanceHandle) return;
    var cur = klass;
    var depth = 0;
    var found = 0;
    while (cur && depth < 8) {
        try {
            var fields = cur.fields;
            if (fields && fields.length) {
                for (var i = 0; i < fields.length; i++) {
                    var f = fields[i];
                    var tn = safe(function(){ return f.type && f.type.name || ''; }, '');
                    if (tn.indexOf('Byte[]') < 0) continue;
                    var off = safe(function(){ return f.offset; }, null);
                    var fn  = safe(function(){ return f.name || '<unnamed>'; }, '<unnamed>');
                    if (off == null) continue;
                    var ptr;
                    try { ptr = instanceHandle.add(off).readPointer(); } catch (e) { ptr = null; }
                    if (!ptr || ptr.isNull()) continue;
                    var len = lengthOf(ptr);
                    found++;
                    var tag = TARGET_SIZES.indexOf(len) >= 0 ? ' ★★★ HIT ★★★' : '';
                    console.log('   [LEN] depth=' + depth + ' ' + cname(cur) + '.' + fn + ' @' + h(off) + ' type=' + tn + ' len=' + len + (len > 0 ? '  (0x' + (len >>> 0).toString(16) + ')' : '') + tag);
                    if (doAutoDump && TARGET_SIZES.indexOf(len) >= 0) {
                        tryAutoDump(ptr, len, label + '_' + fn + '_d' + depth);
                    }
                }
            }
        } catch (e) {}
        var nx = safe(function(){ return cur.parent; }, null);
        if (!nx) break;
        cur = nx;
        depth++;
    }
    if (found === 0) console.log('   (no Byte[] fields in parent chain of ' + cname(klass) + ')');
}

Il2Cpp.perform(function () {
    console.log('[*] === FRIDA_DUMP_BYTE_CANDIDATES ===\n');
    var d = Il2Cpp.domain;

    // ══════════════ PHASE A: STATIC SCAN ══════════════
    console.log('[A] STATIC: enumerate Byte[] fields in Albion.Common\n');
    var commonAsm = safe(function(){ return d.assembly('Albion.Common'); }, null);
    if (!commonAsm) {
        console.log('[!] Albion.Common missing — sweep aborted');
    } else {
        var classes = safe(function(){ return commonAsm.image.classes; }, null);
        if (!classes || !classes.length) {
            console.log('[!] Albion.Common.image.classes missing');
        } else {
            console.log('[*] ' + classes.length + ' classes in Albion.Common');
            var lineCount = 0;
            var maxLines = 200;  // safety cap
            for (var ci = 0; ci < classes.length && lineCount < maxLines; ci++) {
                try {
                    var klass = classes[ci];
                    var fields = klass && klass.fields;
                    if (!fields || !fields.length) continue;
                    for (var fi = 0; fi < fields.length && lineCount < maxLines; fi++) {
                        var f = fields[fi];
                        var tn = safe(function(){ return f.type && f.type.name || ''; }, '');
                        if (tn.indexOf('Byte[]') < 0) continue;
                        var off = safe(function(){ return f.offset; }, '?');
                        var fn  = safe(function(){ return f.name || '<unnamed>'; }, '<unnamed>');
                        console.log('   [STATIC] ' + cname(klass) + '.' + fn + ' @' + h(typeof off === 'number' ? off : 0) + ' classSize=' + (klass.instanceSize || '?'));
                        lineCount++;
                    }
                } catch (e) {}
            }
            if (lineCount >= maxLines) console.log('   ... (capped at ' + maxLines + ' lines)');
        }
    }
    console.log('');

    // ══════════════ PHASE B: DYNAMIC HOOKS ══════════════
    console.log('[B] DYNAMIC: hook getCollisionGrid + a7h.k/b + CGA methods\n');

    function arm(klassName, methodName, onThis, onRet, asmName) {
        var asm = safe(function(){ return d.assembly(asmName || 'Assembly-CSharp'); }, null);
        if (!asm) { console.log('   [-] asm missing: ' + (asmName || 'Assembly-CSharp')); return false; }
        var klass = safe(function(){ return asm.image.class(klassName); }, null);
        if (!klass) { console.log('   [-] missing class: ' + klassName + ' in ' + (asmName || 'Assembly-CSharp')); return false; }
        var m = safe(function(){ return klass.method(methodName); }, null);
        if (!m) { console.log('   [-] missing method: ' + klassName + '.' + methodName); return false; }
        console.log('   [+] hook ' + klassName + '.' + methodName + ' (from ' + (asmName || 'Assembly-CSharp') + ')');
        m.implementation = function () {
            // FIX: invoke может кидать 'cannot invoke non-static method ... through Il2Cpp.Object',
            // особенно на MonoBehaviour-методах типа OnClusterLoaded. Поэтому:
            //   1) сначала осматриваем `this` (Byte[] поля + длины),
            //   2) только потом пытаемся invoke() под try/catch.
            var savedThis = this;
            var tag = klassName + '.' + methodName;
            console.log('\n[HOOK] ' + tag + '  this=' + hp(safe(function(){return savedThis.handle;}, null)));
            try {
                if (onThis) onThis(savedThis, klass, tag);
            } catch (e) { console.log('   [!] onThis failed: ' + (e.message || e)); }

            var ret = undefined;
            try {
                ret = m.invoke(savedThis);
            } catch (e) {
                console.log('   [!] invoke() threw — continuing anyway: ' + (e.message || e));
                // for void/non-critical methods this is acceptable. The world's side-effect skipped.
                return undefined;
            }
            try {
                if (onRet && ret) onRet(ret, ret.class, tag);
            } catch (e) { console.log('   [!] onRet failed: ' + (e.message || e)); }
            return ret;
        };
        return true;
    }

    arm('CollisionTester', 'GetCollisionGrid',
        function(self){ scanByteArrayLengths(self.class, self.handle, 'CollisionTester_this', false); },
        function(ret){ console.log('   ret.class = ' + cname(ret) + '  assembly=' + safe(function(){return ret.class.image.assembly.name;}, '?')); scanByteArrayLengths(ret.class, ret.handle, 'CollisionTester_GetCollisionGrid_ret', true); }
    );

    arm('CollisionTester', 'OnEnable',
        function(self){ scanByteArrayLengths(self.class, self.handle, 'CollisionTester_OnEnable_this', false); },
        function(){}
    );

    // a7h is in Albion.Common — use that asm
    arm('a7h', 'k',
        function(self){ scanByteArrayLengths(self.class, self.handle, 'a7h_k_this', false); },
        function(ret){
            if (ret) {
                console.log('   ret.class = ' + cname(ret) + '  assembly=' + safe(function(){return ret.class.image.assembly.name;}, '?'));
                // try wrapper length
                var wlen = safe(function(){return ret.length;}, -1);
                console.log('   ret.length (wrapper) = ' + wlen);
                if (typeof wlen === 'number' && TARGET_SIZES.indexOf(wlen) >= 0) {
                    console.log('       ★★★ HIT ON RETURN ★★★');
                    tryAutoDump(safe(function(){return ret.handle;}, null), wlen, 'a7h_k_ret');
                }
            }
        },
        'Albion.Common'
    );

    arm('a7h', 'b',
        function(self){ scanByteArrayLengths(self.class, self.handle, 'a7h_b_this', false); },
        function(ret){},
        'Albion.Common'
    );

    arm('CollisionGridAtlasGenerator', 'SetCollisionGrid',
        function(self){ scanByteArrayLengths(self.class, self.handle, 'CGA_SetCollisionGrid_this', true); },
        function(){}
    );

    arm('CollisionGridAtlasGenerator', 'OnClusterLoaded',
        function(self){ scanByteArrayLengths(self.class, self.handle, 'CGA_OnClusterLoaded_this', true); },
        function(){}
    );

    arm('CollisionGridAtlasGenerator', 'OnEnable',
        function(self){ scanByteArrayLengths(self.class, self.handle, 'CGA_OnEnable_this', true); },
        function(){}
    );

    console.log('\n[*] HOOKS ARMED — move around the map to fire B-phase');
    console.log('[*] watchdog: auto-detach in ' + (WATCHDOG_MS/1000) + 's\n');
});

setTimeout(function () {
    console.log('\n[*] === watchdog detach ===');
    console.log('[*] dumps produced: ' + dumpCount + '/' + MAX_DUMPS);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);
