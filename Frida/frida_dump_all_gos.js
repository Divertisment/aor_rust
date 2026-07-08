'use strict';
/*
 * frida_dump_all_gos.js
 *
 * Цель: обойти весь GOM, для каждого валидного GameObject сделать:
 *   - hexdump 256 байт
 *   - m_Name probe (multi-offset scan)
 *   - m_Components probe (auto-discovered или fallback list)
 *
 * Требует предварительно загруженный lib_offsets_discovery.js (через -l chain
 * раньше).
 */

const MODULE_NAME   = 'UnityPlayer.so';
const S_INSTANCE    = 0x20EAAC0;
const NODE_TO_GO    = 0x68;
const MAX_NODES     = 15000;
const MAX_GO_DUMP   = 30;const WATCHDOG_MS = 90 * 1000;  // FIX: bumped from 60s — gom walk needs >60s (8346 nodes reached in 60-90s)  // FIX: было 90s — уменьшил по просьбе пользователя

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before the bridge dispatches any native work). Without this,
//     the bottom-of-file setTimeout never fires if setInterval holds the loop.
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

// ─── Fallback constants (override значений из lib если нужно) ─────────
var FALLBACK_GO_ID_OFF = 0x10;
var FALLBACK_NODE_TO_GO = NODE_TO_GO;
var FALLBACK_NAME_PROBES = [0x48, 0x50, 0x58, 0x60, 0x68, 0x70, 0x78, 0x80];
var FALLBACK_COMP_PROBES = [
    { arr: 0x28, cnt: 0x30, s: 8 }, { arr: 0x30, cnt: 0x38, s: 8 },
    { arr: 0x38, cnt: 0x40, s: 8 }, { arr: 0x40, cnt: 0x48, s: 8 },
    { arr: 0x48, cnt: 0x50, s: 8 }, { arr: 0x50, cnt: 0x58, s: 8 },
    { arr: 0x58, cnt: 0x60, s: 8 }, { arr: 0x60, cnt: 0x68, s: 8 },
    { arr: 0x28, cnt: 0x30, s: 16 }, { arr: 0x30, cnt: 0x38, s: 16 },
    { arr: 0x38, cnt: 0x40, s: 16 }, { arr: 0x40, cnt: 0x48, s: 16 },
];

// ─── helpers ──────────────────────────────────────
function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }

// m_Name через Il2CppString header (length@+0x10, chars@+0x14)
function tryReadIl2CppString(ptr) {
    if (!ptr || ptr.isNull()) return null;
    var len = safe(function(){ return ptr.add(0x10).readS32(); }, -1);
    if (!(len > 0 && len < 200)) return null;
    var charsPtr = ptr.add(0x14);
    var s = safe(function(){ return charsPtr.readUtf16String(len); }, null);
    return s;
}

function probeName(goPtr, offsetsList) {
    for (var i = 0; i < offsetsList.length; i++) {
        var off = offsetsList[i];
        var pStr = safe(function(){ return goPtr.add(off).readPointer(); }, null);
        if (!pStr || pStr.isNull()) continue;
        var s = tryReadIl2CppString(pStr);
        if (s && s.length > 0 && s.length < 200) {
            return { offset: off, ptr: pStr, name: s };
        }
    }
    return null;
}

function probeComponents(goPtr, offsets) {
    if (offsets.compArrOff !== null) {
        try {
            var arr = goPtr.add(offsets.compArrOff).readPointer();
            if (!arr || arr.isNull()) return null;
            var cnt = -1;
            for (var dc = 0x08; dc <= 0x18; dc += 8) {
                try {
                    var c = goPtr.add(offsets.compArrOff + dc).readS32();
                    if (c >= 0 && c < 256) { cnt = c; break; }
                } catch (e) {}
            }
            if (cnt < 0) return null;
            var firstPtr = safe(function(){ return arr.readPointer(); }, null);
            if (!firstPtr || firstPtr.compare(0x10000) < 0) return null;
            return { probe: { arr: offsets.compArrOff, cnt: offsets.compArrOff + 0x08, s: offsets.compStride },
                     arr: arr, cnt: cnt, firstPtr: firstPtr };
        } catch (e) { return null; }
    }
    for (var pi = 0; pi < FALLBACK_COMP_PROBES.length; pi++) {
        var p = FALLBACK_COMP_PROBES[pi];
        var arr = null, cnt = -1, firstPtr = null;
        try { arr = goPtr.add(p.arr).readPointer(); } catch (e) {}
        try { cnt = goPtr.add(p.cnt).readS32(); } catch (e) {}
        if (!arr || arr.isNull()) continue;
        if (!(cnt > 0 && cnt < 256)) continue;
        try { firstPtr = arr.readPointer(); } catch (e) {}
        if (!firstPtr || firstPtr.isNull()) continue;
        if (firstPtr.compare(0x10000) < 0) continue;
        return { probe: p, arr: arr, cnt: cnt, firstPtr: firstPtr };
    }
    return null;
}

// ─── main ─────────────────────────────────────────
Il2Cpp.perform(function () {
    console.log('[*] === FRIDA_DUMP_ALL_GOS ===\n');
    var unityBase = safe(function(){
        var m = Process.findModuleByName(MODULE_NAME);
        return m ? m.base : null;
    }, null);
    if (!unityBase) { console.log('[!] UnityPlayer.so not found'); return; }
    var sInstAddr = unityBase.add(S_INSTANCE);
    console.log('[*] base=' + hp(unityBase) + '  s_Instance@' + hp(sInstAddr));

    if (typeof discoverGameObjectOffsets !== 'function') {
        console.log('[!] discoverGameObjectOffsets() не найден — lib_offsets_discovery.js должен быть в -l chain раньше');
        return;
    }
    console.log('[*] Auto-discovering offsets via Camera.main...');
    var offsets = discoverGameObjectOffsets();
    console.log('[*] Discovery: m_InstanceID @ +0x' + offsets.instanceIdOff.toString(16) +
                '  m_Components @ +0x' + (offsets.compArrOff !== null ? offsets.compArrOff.toString(16) : '??') +
                ' stride=' + (offsets.compArrOff !== null ? offsets.compStride : '??') +
                '  nodeToGo @ +0x' + offsets.nodeToGo.toString(16));

    var gom = safe(function(){ return sInstAddr.readPointer(); }, null);
    if (!gom || gom.isNull()) { console.log('[!] GOM is null (game not running?)'); return; }
    var startNode = safe(function(){ return gom.add(0x18).readPointer(); }, null);
    if (!startNode || startNode.isNull()) { console.log('[!] startNode is null'); return; }
    console.log('[*] GOM@' + hp(gom) + '  startNode@' + hp(startNode));

    // FIX: если discovery не нашёл m_InstanceID (Camera.main null), brute-force'им по 6 кандидатам.
    // Для каждого offset проходим первые ~80 узлов и считаем, сколько дают plausible id
    // (1 < id < 0x3FFFFFFF). Побеждает offset с максимальным score.
    if (offsets.instanceIdOff === FALLBACK_GO_ID_OFF) {
        var cands = [0x08, 0x0C, 0x10, 0x14, 0x18, 0x20];
        var bestOff = FALLBACK_GO_ID_OFF, bestScore = -1;
        for (var ci = 0; ci < cands.length; ci++) {
            var off = cands[ci];
            var score = 0, samples = 0;
            var n = startNode;
            for (var si = 0; si < 80 && n && !n.isNull(); si++) {
                try {
                    var g = n.sub(offsets.nodeToGo);
                    var id = g.add(off).readS32();
                    if (id > 0 && id < 0x3FFFFFFF) score++;
                } catch (e) {}
                samples++;
                try { n = n.readPointer(); } catch (e) { break; }
                if (n && !n.isNull() && n.equals(startNode)) break;
            }
            console.log('[*]   probe +0x' + off.toString(16) + ': ' + score + '/' + samples + ' plausible ids');
            if (score > bestScore) { bestScore = score; bestOff = off; }
        }
        if (bestScore > 0) {
            console.log('[*] Brute-force: m_InstanceID @ +0x' + bestOff.toString(16) + ' (score=' + bestScore + ')');
            offsets.instanceIdOff = bestOff;
        }
    }

    var stats = { nodes_walked: 0, valid_gos: 0, name_hits: 0, comp_hits: 0, aborts: 0 };
    var node = startNode;
    var keepGoing = true;

    for (var i = 0; i < MAX_NODES && keepGoing; i++) {
        if (i > 0 && node.equals(startNode)) break;
        if (!node || node.isNull()) break;
        stats.nodes_walked++;

        var nextNode = null;
        try { nextNode = node.readPointer(); } catch (e) { stats.aborts++; break; }

        if (nextNode && (nextNode.compare(0x10000) < 0 || nextNode.compare(0x800000000000) > 0)) {
            stats.aborts++;
            break;
        }

        var goPtr;
        try { goPtr = node.sub(offsets.nodeToGo); } catch (e) { goPtr = null; }
        if (goPtr && goPtr.compare(0x10000) >= 0) {
            var goId = -1;
            try { goId = goPtr.add(offsets.instanceIdOff).readS32(); } catch (e) {}
            // FIX: жёстче фильтруем — Unity InstanceID 1..0x3FFFFFFF. Если id похож на адрес
            // (>= 0x700000000000) или мусорный — пропускаем.
            if (goId > 0 && goId < 0x40000000) {
                stats.valid_gos++;
                if (stats.valid_gos <= MAX_GO_DUMP) {
                    console.log('\n========================================');
                    console.log('[GO #' + stats.valid_gos + '] id=' + goId + '  ptr=' + hp(goPtr));

                    var hexdBuf = safe(function(){ return goPtr.readByteArray(0x100); }, null);
                    if (hexdBuf) {
                        console.log('--- HEXDUMP 256B ---');
                        console.log(hexdump(hexdBuf, { offset: 0, length: 0x100, header: true, ansi: true }));
                    } else {
                        console.log('--- HEXDUMP FAILED ---');
                    }

                    var nameInfo = probeName(goPtr, FALLBACK_NAME_PROBES);
                    if (nameInfo) {
                        stats.name_hits++;
                        console.log('[NAME]  +0x' + nameInfo.offset.toString(16) + ' = "' + nameInfo.name + '"');
                    } else {
                        console.log('[NAME]  no probe matched (' + FALLBACK_NAME_PROBES.length + ' candidates)');
                    }

                    var compInfo = probeComponents(goPtr, offsets);
                    if (compInfo) {
                        stats.comp_hits++;
                        console.log('[COMPS] arr@+0x' + compInfo.probe.arr.toString(16) +
                                    ' cnt@+0x' + compInfo.probe.cnt.toString(16) +
                                    ' stride=' + compInfo.probe.s +
                                    ' count=' + compInfo.cnt +
                                    ' firstPtr=' + hp(compInfo.firstPtr) +
                                    (offsets.compArrOff !== null ? '  (auto-discovered)' : '  (fallback)'));
                    } else {
                        console.log('[COMPS] no probe matched');
                    }
                }
            }
        }

        if (!nextNode) break;
        node = nextNode;
    }

    console.log('\n=== SUMMARY ===');
    console.log('discovery       : instanceIdOff +0x' + offsets.instanceIdOff.toString(16) +
                ', compArrOff ' + (offsets.compArrOff !== null ? '+0x' + offsets.compArrOff.toString(16) : '??') +
                ', nodeToGo +0x' + offsets.nodeToGo.toString(16));
    console.log('nodes_walked    : ' + stats.nodes_walked);
    console.log('valid_gos       : ' + stats.valid_gos + (stats.valid_gos > MAX_GO_DUMP ? '  (only first '+MAX_GO_DUMP+' detailed)' : ''));
    console.log('name_hits       : ' + stats.name_hits);
    console.log('comp_hits       : ' + stats.comp_hits);
    console.log('abort(s)        : ' + stats.aborts);
    console.log('============================\n');
});

setTimeout(function () {
    console.log('[*] watchdog 90s — detach');
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);
