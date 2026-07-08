'use strict';
// Focused dump: only 2 TARGET_CLASSES, NO full 10092-class iteration.
// Pattern: same as dump_name_binder_classes.js (already proven to work).
// Run: echo 31271 | sudo -S frida -p $PID -l frida-il2cpp-bridge -l <this file>
function fmt(off) { try { return '0x' + (off | 0).toString(16).padStart(4, '0'); } catch (e) { return '0x????'; } }
function getName(k) { try { var ns = (k && k.namespace) || ''; var n = (k && k.name) || '<anon>'; return ns ? ns + '.' + n : n; } catch (e) { return '<unreadable>'; } }
function getFields(k) {
    try {
        var f = k.fields;
        if (!f) return [];
        if (Array.isArray(f)) return f;
        if (typeof f === 'object') { var out = []; for (var k2 in f) if (Object.prototype.hasOwnProperty.call(f, k2)) out.push(f[k2]); return out; }
    } catch (e) {}
    return [];
}
function getParent(k) { try { return k.parent; } catch (e) { return null; } }
function getSize(k) { try { return k.instanceSize; } catch (e) { return '?'; } }

Il2Cpp.perform(function () {
    var asm = (function () { try { var d = Il2Cpp.domain; var a = d && d.assembly ? d.assembly('Assembly-CSharp') : (d && d.assemblies && d.assemblies['Assembly-CSharp']); return a; } catch (e) { return null; } })();
    if (!asm) { console.log('[!] Assembly-CSharp missing'); return; }

    var C = function (n) { try { return asm.image.class(n); } catch (e) { return null; } };

    var targets = [
        'DisplayCharacterNameWorldObjectAnchoredGui',
        'LinkedCharacterNameLabel',
        'PlayerCharacterView',
    ];

    for (var i = 0; i < targets.length; i++) {
        var cn = targets[i];
        var klass = C(cn);
        if (!klass) { console.log('\n[!] ' + cn + ' not found'); continue; }
        console.log('\n=== ' + cn + ' ===');
        var cur = klass, depth = 0;
        while (cur) {
            try {
                console.log('  -- depth=' + depth + ' ' + getName(cur) + ' size=' + getSize(cur) + ' --');
                var fields = getFields(cur);
                for (var j = 0; j < fields.length; j++) {
                    var f = fields[j];
                    var tn = '?', fn = '<unnamed>', off = '?';
                    try { off = f.offset; } catch (e) {}
                    try { tn = (f.type && f.type.name) || '?'; } catch (e) {}
                    try { fn = f.name || '<unnamed>'; } catch (e) {}
                    console.log('     ' + fmt(off).padStart(6) + '  ' + String(tn).padEnd(20) + '  "' + fn + '"');
                }
            } catch (e) {
                console.log('  [depth=' + depth + ' walk-failed: ' + (e && e.message ? e.message : e) + ']');
                break;
            }
            var next = getParent(cur);
            if (!next || depth >= 10) break;
            cur = next;
            depth++;
        }
    }
    console.log('\n[*] === done ===');
});
