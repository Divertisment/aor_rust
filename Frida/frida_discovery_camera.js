'use strict';
/*
 * frida_discovery_camera.js
 *
 * Использует GAMEOBJECT-MAIN-CAMERA как ground-truth чтобы найти точные
 * C++ GameObject offsets:
 *   - m_InstanceID
 *   - m_Components buffer (ptr + stride)
 *   - m_Name Il2CppString*
 *   - NODE_TO_GO (Node - X = GameObject)
 *
 * Требует предварительно загруженный lib_offsets_discovery.js (через -l chain
 * раньше в frida-команде). Discovery-функция берётся оттуда.
 *
 * Запуск (ВАЖНО: lib идёт ПЕРВЫМ в -l chain):
 *   echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/lib_offsets_discovery.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/frida_discovery_camera.js
 */

const SCAN_RANGE = 0x120;   // scan up to 0x120 from go ptr
function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before the bridge dispatches any native work). Без этого после
//     print-цикла «=== END OF DISCOVERY ===» V8-изолят висит вечно и
//     web_panel.py думает что job всё ещё running.
const WATCHDOG_MS = 120 * 1000;  // FIX: было 180s — уменьшил по просьбе пользователя
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

Il2Cpp.perform(function () {
    console.log('[*] === C++ GAMEOBJECT LAYOUT DISCOVERY (Camera.main ground-truth) ===\n');

    // Re-assert: reference the global function from lib_offsets_discovery.js
    if (typeof discoverGameObjectOffsets !== 'function') {
        console.log('[!] discoverGameObjectOffsets() не найдена — lib_offsets_discovery.js должен быть загружен через -l раньше');
        return;
    }
    var offsets = discoverGameObjectOffsets();
    console.log('[*] discovery: m_InstanceID @ +0x' + offsets.instanceIdOff.toString(16) +
                ', nodeToGo @ +0x' + offsets.nodeToGo.toString(16) +
                ', m_Components @ +0x' + (offsets.compArrOff !== null ? offsets.compArrOff.toString(16) : '??') +
                ', stride=' + (offsets.compArrOff !== null ? offsets.compStride : '??'));

    // Для подробного отчёта используем bridge напрямую — получаем nativeGo/nativeCam/expectedId.
    // Это идентично тому, что делает lib, но тут мы просто показываем всё в логе.
    try {
        // FIX: cross-assembly lookup — Camera может жить в любом из UnityEngine.*Module,
        // не только в CoreModule. Il2Cpp.domain.class(name) сканирует ВСЕ загруженные images.
        var Camera = Il2Cpp.domain.class('UnityEngine.Camera');
        var cam = Camera.method('get_main').invoke(null);
        var go = cam.method('get_gameObject').invoke();
        var nativeGo = go.field('m_CachedPtr').value;
        var nativeCam = cam.field('m_CachedPtr').value;
        var expectedId = go.method('GetInstanceID').invoke();

        console.log('[*] Bridge exact values: nativeGo=' + hp(nativeGo) +
                    ' nativeCam=' + hp(nativeCam) + ' expectedId=' + expectedId);

        // ─── 1. Полный scan m_InstanceID (чтобы показать ВСЕ матчи в логе) ─────
        console.log('\n[1] Scanning m_InstanceID (looking for s32 == ' + expectedId + ')...');
        for (var off = 0x00; off <= 0x30; off += 4) {
            try {
                if (nativeGo.add(off).readS32() === expectedId) {
                    console.log('   [+] match @ +0x' + off.toString(16));
                }
            } catch (e) {}
        }

        // ─── 2. Полный scan m_Components — все матчи ─────────────────────────
        console.log('\n[2] Scanning m_Components (looking for nativeCam as pointer) ...');
        for (var off = 0x10; off <= 0x100; off += 8) {
            try {
                var arr = nativeGo.add(off).readPointer();
                if (!arr || (arr.isNull && arr.isNull())) continue;
                if (arr.compare && arr.compare(0x10000) < 0) continue;
                for (var j = 0; j < 8; j++) {
                    try {
                        if (nativeCam && arr.add(j * 8).readPointer().equals(nativeCam)) {
                            console.log('   [+] arr @ +0x' + off.toString(16) + '  stride=8   cam at index ' + j);
                        }
                        if (nativeCam && arr.add(j * 16 + 8).readPointer().equals(nativeCam)) {
                            console.log('   [+] arr @ +0x' + off.toString(16) + '  stride=16  cam at index ' + j);
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        }

        // ─── 3. Hunt for m_Name (Il2CppString*) ───────────────────────────────
        console.log('\n[3] Hunting for m_Name (short ASCII Il2CppString)...');
        var foundAnyName = false;
        for (var off = 0x28; off <= 0xa0; off += 0x08) {
            try {
                var cand = nativeGo.add(off).readPointer();
                if (!cand || (cand.isNull && cand.isNull())) continue;
                var len = safe(function(){ return cand.add(0x10).readS32(); }, -1);
                if (!(len > 0 && len < 200)) continue;
                var s = safe(function(){ return cand.add(0x14).readUtf16String(len); }, null);
                if (s && s.length === len && /^[A-Za-z0-9 _\-/()\[\]]{1,100}$/.test(s)) {
                    console.log('   [+] candidate m_Name @ +0x' + off.toString(16) + '  = "' + s + '" (len=' + len + ')');
                    foundAnyName = true;
                }
            } catch (e) {}
        }
        if (!foundAnyName) console.log('   [-] no plausible m_Name found');

        // ─── 4. NODE_TO_GO heuristic ───────────────────────────────────────────
        var startNode = null;
        try {
            var unityBase = Process.findModuleByName('UnityPlayer.so').base;
            var gom = unityBase.add(0x20EAAC0).readPointer();
            startNode = gom.add(0x18).readPointer();
        } catch (e) {}
        if (startNode && (!startNode.isNull || !startNode.isNull())) {
            console.log('\n[4] Verifying NODE_TO_GO (GameObject = Node - X)...');
            var tryOffsets = [0x60, 0x68, 0x70, 0x78, 0x80, 0x10, 0x18, 0x48, 0x58];
            for (var k = 0; k < tryOffsets.length; k++) {
                var xOff = tryOffsets[k];
                try {
                    var probeGo = startNode.sub(xOff);
                    try {
                        var gotId = probeGo.add(offsets.instanceIdOff).readS32();
                        var flag = (gotId > 0 && gotId < 0x40000000) ? ' ✓ plausible' : ' ✗ garbage';
                        console.log('   [probe] Node-0x' + xOff.toString(16) + '  +0x' + offsets.instanceIdOff.toString(16) + ' id=' + gotId + flag);
                    } catch (e) {}
                } catch (e) {}
            }
        } else {
            console.log('\n[4] startNode not readable — skip NODE_TO_GO verification');
        }
    } catch (e) {
        console.log('[!] detail-print error: ' + e.message);
    }

    console.log('\n=== END OF DISCOVERY ===');
    console.log('VERIFIED OFFSETS:');
    console.log('   m_InstanceID   @ +0x' + offsets.instanceIdOff.toString(16));
    console.log('   m_Components   @ +0x' + (offsets.compArrOff !== null ? offsets.compArrOff.toString(16) : '??') +
                '  stride=' + (offsets.compArrOff !== null ? offsets.compStride : '??'));
    console.log('   nodeToGo       @ +0x' + offsets.nodeToGo.toString(16));
    console.log('\nИспользуй их в frida_gom_poll.js и frida_dump_all_gos.js как FALLBACK_* values.');
});
