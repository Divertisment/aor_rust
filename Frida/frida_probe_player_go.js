'use strict';
/*
 * frida_probe_player_go.js
 *
 * Probe-скрипт: определяет ПРАВИЛЬНЫЕ offsets для m_Components
 *               в Unity 6 / IL2CPP GameObject (x64).
 *
 * Стратегия:
 *   1. Walk GOM intrusive list (verified offsets из EntityFinderGom.cs)
 *      UnityPlayer.so + 0x20EAAC0 → s_Instance
 *      *(s_Instance) → GOM
 *      GOM + 0x18 → startNode
 *      Node.next = [Node]+0x00 | GameObject = Node - 0x68
 *      GO+0x10 = m_InstanceID
 *   2. Найди GO с ID = 533 (твой локальный Hero из /home/stas/.aor_state)
 *   3. Хексдампни 256 байт вокруг GO-структуры (читай сырые байты)
 *   4. Прогони 9 candidate probe-пар (arr_off / cnt_off / stride):
 *      - читаем pointer на m_Components array + int счётчик count
 *      - проверяем что первые 2 записи массива — non-null pointers
 *      - если да — "ВОТ ОНО" ⇒ выводим offset
 *
 * Запуск:
 *   echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/frida_probe_player_go.js
 *
 * Выход: либо 🚀 PROBE HIT с конкретным offset, либо таблица всех probe-кандидатов
 *        чтобы вручную выбрать правильный.
 */

const TARGET_IDS = [533, 1, 100, 1000, 10000];
const PROBE_CANDIDATES = [
    { arr: 0x28, cnt: 0x30, stride: 8, label: 'arr@0x28 cnt@0x30 u8-stride' },
    { arr: 0x28, cnt: 0x30, stride: 16, label: 'arr@0x28 cnt@0x30 pair-stride' },
    { arr: 0x30, cnt: 0x38, stride: 8, label: 'arr@0x30 cnt@0x38 u8-stride' },
    { arr: 0x30, cnt: 0x38, stride: 16, label: 'arr@0x30 cnt@0x38 pair-stride' },
    { arr: 0x38, cnt: 0x40, stride: 8, label: 'arr@0x38 cnt@0x40 u8-stride' },
    { arr: 0x40, cnt: 0x48, stride: 8, label: 'arr@0x40 cnt@0x48 u8-stride' },
    { arr: 0x48, cnt: 0x50, stride: 8, label: 'arr@0x48 cnt@0x50 u8-stride' },
    { arr: 0x50, cnt: 0x58, stride: 8, label: 'arr@0x50 cnt@0x58 u8-stride' },
    { arr: 0x58, cnt: 0x60, stride: 8, label: 'arr@0x58 cnt@0x60 u8-stride' },
];

const WATCHDOG_MS = 30 * 1000;

function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }

function findGoById(targetId, sInstAddr) {
    var gom = safe(function(){ return sInstAddr.readPointer(); }, null);
    if (!gom || gom.isNull()) return null;
    var start = safe(function(){ return gom.add(0x18).readPointer(); }, null);
    if (!start || start.isNull()) return null;
    var node = start;
    for (var i = 0; i < 65536; i++) {
        if (i > 0 && node.equals(start)) break;
        if (!node || node.isNull()) break;
        var next = null;
        try { next = node.readPointer(); } catch (e) { return null; }
        var goPtr = null;
        try { goPtr = node.sub(0x68); } catch (e) {}
        if (goPtr && !goPtr.isNull()) {
            try {
                var id = goPtr.add(0x10).readS32();
                if (id === targetId) return { go: goPtr, id: id };
            } catch (e) {}
        }
        if (!next) return null;
        node = next;
    }
    return null;
}

function probeComponents(goPtr) {
    var hits = [];
    for (var p = 0; p < PROBE_CANDIDATES.length; p++) {
        var probe = PROBE_CANDIDATES[p];
        var arrPtr = null, cnt = -1, ok = false, firstPtr = null, secondPtr = null;
        try { arrPtr = goPtr.add(probe.arr).readPointer(); } catch (e) { arrPtr = null; }
        try { cnt = goPtr.add(probe.cnt).readS32(); } catch (e) { cnt = -1; }
        if (!arrPtr || arrPtr.isNull()) continue;
        if (!(cnt > 0 && cnt < 100)) continue;
        try { firstPtr = arrPtr.readPointer(); } catch (e) {}
        try { secondPtr = arrPtr.add(probe.stride).readPointer(); } catch (e) {}
        if (firstPtr && !firstPtr.isNull() && secondPtr && !secondPtr.isNull()) {
            ok = true;
            hits.push({ probe: probe, arrPtr: arrPtr, cnt: cnt, firstPtr: firstPtr, secondPtr: secondPtr });
        }
    }
    return hits;
}

Il2Cpp.perform(function () {
    console.log('[*] === FRIDA_PROBE_PLAYER_GO ===\n');
    var unityBase = safe(function(){ var m = Process.findModuleByName('UnityPlayer.so'); return m ? m.base : null; }, null);
    if (!unityBase) { console.log('[!] UnityPlayer.so not found'); return; }
    var sInstAddr = unityBase.add(0x20EAAC0);
    console.log('[*] UnityPlayer.so base=' + hp(unityBase) + '  s_Instance@' + hp(sInstAddr));

    var foundAny = false;
    for (var ti = 0; ti < TARGET_IDS.length; ti++) {
        var tid = TARGET_IDS[ti];
        var hit = safe(function(){ return findGoById(tid, sInstAddr); }, null);
        if (!hit) { console.log('   ID=' + tid + ': not found in GOM'); continue; }
        foundAny = true;
        console.log('\n[+] FOUND GO id=' + tid + '  ptr=' + hp(hit.go) + '\n');

        // 1. HEXDUMP
        console.log('=== HEXDUMP 256 bytes around GO pointer (@0..+0xFF) ===');
        var rawBytes = null;
        try { rawBytes = hit.go.readByteArray(0x100); } catch (e) {}
        if (rawBytes) {
            console.log(hexdump(rawBytes, { offset: 0, length: 0x100, header: true, ansi: true }));
        }

        // 2. PROBE m_Components
        console.log('\n=== PROBE candidate m_Components offsets ===');
        var hits = probeComponents(hit.go);
        if (hits.length === 0) {
            console.log('   (no probe matched — try larger range; raw dump above)');
        } else {
            hits.forEach(function (h) {
                console.log('   🚀 PROBE HIT: ' + h.probe.label + '  arr=' + hp(h.arrPtr) + ' cnt=' + h.cnt + ' first=' + hp(h.firstPtr) + ' second=' + hp(h.secondPtr));
                // show 5 sequential reads
                for (var i = 0; i < 5; i++) {
                    try {
                        var p = h.arrPtr.add(i * h.probe.stride).readPointer();
                        console.log('      [' + i + '] @' + hp(h.arrPtr.add(i * h.probe.stride)) + ' = ' + hp(p) + (p.isNull() ? ' [null]' : ''));
                    } catch (e) {}
                }
            });
        }
    }

    if (!foundAny) console.log('\n[!] None of target IDs found in GOM walk — game may not have local player entity yet');
});

setTimeout(function () {
    console.log('\n[*] === watchdog detach ===');
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);
