'use strict';
// AOR_core/Frida/dump_all_entities.js
// Lists all instances of co6 (Hero/Character MonoBehaviour) with their
// PhotonViewID, position, angle, and native GameObject.m_Name (probed).
//
// Run: echo 31271 | sudo -S frida -p $PID \
//   -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
//   -l dump_all_entities.js
//
// Reads:
//   +0x10 m_InstanceID  (Int32, PhotonViewID)
//   +0x18 m_CachedPtr   (IntPtr, → native GameObject)
//   +0x38 X, +0x3C Y, +0x40 angle (float)
// Then probes m_Name at 8 candidate offsets inside native GameObject.

function safeAdd(p, off) { try { return p.add(off); } catch (e) { return null; } }
function safeReadS32(p, off) { try { return p.add(off).readS32(); } catch (e) { return null; } }
function safeReadF32(p, off) { try { return p.add(off).readFloat(); } catch (e) { return null; } }
function safeReadPtr(p, off) { try { return p.add(off).readPointer(); } catch (e) { return null; } }
function safeCString(p) { try { return p.readCString(); } catch (e) { return null; } }

Il2Cpp.perform(function () {
    var image = (function () { try { return Il2Cpp.domain.assembly('Albion.PhotonClient').image; } catch (e) { return null; } })();
    if (!image) { console.log('[!] Albion.PhotonClient missing'); return; }
    var cls = (function () { try { return image.class('co6'); } catch (e) { return null; } })();
    if (!cls) { console.log('[!] co6 class not found'); return; }
    console.log('[*] Class: ' + cls.fullName);

    // Chain: cls.choose → Il2Cpp.choose → Il2Cpp.gc.choose → gc.heap.findInstances
    var instances = null;
    var source = 'none';
    try { instances = cls.choose(); source = 'cls.choose()'; } catch (e) { instances = []; }
    if (!instances || instances.length === 0) {
        try { instances = Il2Cpp.choose(cls); source = 'Il2Cpp.choose(cls)'; } catch (e) { instances = instances || []; }
    }
    if (!instances || instances.length === 0) {
        try { instances = Il2Cpp.gc.choose(cls); source = 'Il2Cpp.gc.choose(cls)'; } catch (e) { instances = instances || []; }
    }
    if (!instances || instances.length === 0) {
        try { if (Il2Cpp.gc && Il2Cpp.gc.heap) instances = Il2Cpp.gc.heap.findInstances(cls); source = 'Il2Cpp.gc.heap.findInstances(cls)'; } catch (e) { instances = instances || []; }
    }
    if (!instances) instances = [];
    console.log('[*] choose() returned ' + instances.length + ' instances (via ' + source + ')');

    if (instances.length === 0) {
        console.log('[-] no instances found via any API - skipping enumeration');
        return;
    }

    console.log('\n[id]\t\tPhotonViewID\tX\t\tY\t\tangle\t\tname');
    console.log('------------------------------------------------------------------------');
    for (var i = 0; i < instances.length; i++) {
        var inst = instances[i];
        var id = safeReadS32(inst, 0x10);
        var x = safeReadF32(inst, 0x38);
        var y = safeReadF32(inst, 0x3C);
        var a = safeReadF32(inst, 0x40);
        var cached = safeReadPtr(inst, 0x18);

        // Probe m_Name at 8 candidate offsets in native GameObject
        var name = null;
        if (cached && !cached.isNull()) {
            var CANDIDATES = [0x10, 0x30, 0x48, 0x58, 0x60, 0x68, 0x70, 0x78];
            for (var j = 0; j < CANDIDATES.length && !name; j++) {
                var off = CANDIDATES[j];
                var p = safeReadPtr(cached, off);
                if (p && !p.isNull()) {
                    var s = safeCString(p);
                    if (s && s.length > 0 && s.length < 64 && /^[A-Za-z0-9_()\-]+$/.test(s)) {
                        name = s;
                    }
                }
                // try inline ascii too
                if (!name) {
                    try {
                        var bytes = cached.add(off).readByteArray(64);
                        var u8 = new Uint8Array(bytes);
                        var ascii = '';
                        for (var k = 0; k < u8.length && u8[k] !== 0; k++) {
                            if (u8[k] >= 0x20 && u8[k] < 0x7f) ascii += String.fromCharCode(u8[k]);
                            else break;
                        }
                        if (ascii.length >= 3 && /^[A-Za-z0-9_()\-]+$/.test(ascii)) name = ascii;
                    } catch (e2) { /* skip */ }
                }
            }
        }

        var xStr = (x != null) ? x.toFixed(2) : '?';
        var yStr = (y != null) ? y.toFixed(2) : '?';
        var aStr = (a != null) ? a.toFixed(2) : '?';
        var idStr = (id != null) ? String(id) : '?';
        var nameStr = name || '<no-name>';
        console.log('[' + i + ']\t' + idStr + '\t\t' + xStr + '\t\t' + yStr + '\t\t' + aStr + '\t\t"' + nameStr + '"');
    }
    console.log('\n[*] === done (' + instances.length + ' entities) ===');
});
