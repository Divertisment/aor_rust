'use strict';
/*
 * frida_gom_poll.js
 *
 * Каждые 2 с обходит GameObjectManager:
 *   *(UnityPlayer+0x20EAAC0) → GOM
 *   GOM+0x18                 → startNode
 *   startNode.next           → Node (C++)
 *   GameObject = Node - 0x68 (или auto-discovered NODE_TO_GO)
 *   m_InstanceID @ go+0x08/0x10 (auto-discovered)
 *   m_Components @ go+? stride=? (auto-discovered, fallback к списку probes)
 *
 * Для каждого нового GameObject с m_InstanceID != 0 находит компоненты,
 * сканирует их на klass-pointer, ища CollisionTester / CGA / a7h. Если
 * нашла — через parent-chain ищет Byte[] массивы подходящего размера
 * и автоматически дампит в /tmp/aor_gom_*.bin.
 *
 * Требует предварительно загруженный lib_offsets_discovery.js:
 *   frida ... -l lib_offsets_discovery.js -l frida_gom_poll.js
 */

const TARGET_SIZES = [656100, 10497600, 2624400, 1312200];
const DUMP_DIR = '/tmp';
const POLL_MS = 2000;
const MAX_DUMPS = 8;
const MAX_NODES_PER_POLL = 65536;
const WATCHDOG_MS = 120 * 1000;  // FIX: было 180s — уменьшил по просьбе пользователя

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before the bridge dispatches any native work). Without this,
//     the bottom-of-file setTimeout never fires if setInterval holds the loop).
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    console.log('[*] seen GO=' + seenGoIds.size + '  managed=' + seenManaged.size + '  dumps=' + dumpCount + '/' + MAX_DUMPS);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

// ─── Fallback constants (перезаписывают значения из lib, чтобы override здесь) ───
var FALLBACK_GO_ID_OFF  = 0x10;
var FALLBACK_NODE_TO_GO = 0x68;
var FALLBACK_COMP_PROBES = [
    { arr: 0x28, cnt: 0x30, s: 8 }, { arr: 0x30, cnt: 0x38, s: 8 },
    { arr: 0x38, cnt: 0x40, s: 8 }, { arr: 0x40, cnt: 0x48, s: 8 },
    { arr: 0x48, cnt: 0x50, s: 8 }, { arr: 0x30, cnt: 0x38, s: 16 },
    { arr: 0x38, cnt: 0x40, s: 16 }, { arr: 0x40, cnt: 0x48, s: 16 },
];

// ─── helpers ──────────────────────────────────────
function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }
function cname(k){ try { var ns = k.namespace || ''; var n = k.name || '?'; return ns ? ns + '.' + n : n; } catch (e) { return '?'; } }

// State
const seenManaged = new Set();
const seenGoIds = new Set();
let dumpCount = 0;

function tryAutoDump(handle, length, label) {
    if (dumpCount >= MAX_DUMPS) return;
    if (!handle || handle.isNull() || length <= 0 || length > 16 * 1024 * 1024) return;
    try {
        var n = Math.min(length, 12 * 1024 * 1024);
        var bytes = handle.add(0x20).readByteArray(n);
        if (!bytes) return;
        var fname = DUMP_DIR + '/aor_gom_' + label.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + length + '.bin';
        var f = new File(fname, 'wb'); f.write(bytes); f.close();
        dumpCount++;
        console.log('   ★ dumped ' + n + ' B → ' + fname + (n < length ? '  [TRUNCATED from ' + length + ' B]' : ''));
    } catch (e) { console.log('   [!] dump failed: ' + e.message); }
}

// Walk parent-chain, для каждого Byte[] поля читаем длину через +0x18.
function scanParentChainByteArrays(instanceHandle, klass, prefix) {
    var cur = klass, depth = 0;
    while (cur && depth < 8) {
        try {
            var fields = cur.fields;
            if (fields && fields.length) {
                for (var i = 0; i < fields.length; i++) {
                    var f = fields[i];
                    var tn = safe(function(){ return f.type && f.type.name || ''; }, '');
                    if (!(tn === 'byte[]' || tn === 'Byte[]' || /^Il2CppArray.+(byte|Byte)/i.test(tn))) continue;
                    var off = safe(function(){ return f.offset; }, null);
                    if (off == null) continue;
                    try {
                        var ptr = instanceHandle.add(off).readPointer();
                        if (!ptr || ptr.isNull()) continue;
                        var len = ptr.add(0x18).readS32();
                        var star = TARGET_SIZES.indexOf(len) >= 0 ? ' ★★★ HIT ★★★' : '';
                        console.log('   [LEN] depth=' + depth + ' ' + cname(cur) + '.' + (f.name||'?') + ' @+0x' + off.toString(16) + ' len=' + len + star);
                        if (TARGET_SIZES.indexOf(len) >= 0) {
                            tryAutoDump(ptr, len, prefix + '_' + depth + '_' + (f.name||'?'));
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
        var nx = safe(function(){ return cur.parent; }, null);
        if (!nx) break;
        cur = nx; depth++;
    }
}

// Ищем managed-обёртку компонента: сканируем probe-офсеты в C++ Component, ища указатель,
// чей klass-pointer совпадает с одним из targetKlasses.
function scanComponentForManagedPtr(componentPtr, targetKlasses) {
    for (var off = 0x10; off <= 0xA0; off += 8) {
        try {
            var possibleManaged = componentPtr.add(off).readPointer();
            if (!possibleManaged || possibleManaged.isNull()) continue;
            var klassStar = possibleManaged.readPointer();
            for (var k = 0; k < targetKlasses.length; k++) {
                try {
                    var targetKlass = targetKlasses[k];
                    if (!targetKlass || !targetKlass.handle) continue;
                    if (klassStar.equals(targetKlass.handle)) {
                        return { managedPtr: possibleManaged, klass: targetKlass };
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }
    return null;
}

// Пробинг m_Components на одном GO. Использует discovered compArr/compStride.
// Если discovery не нашёл — fallback на hardcoded probes.
function findComponentsOnGO(goPtr, offsets) {
    if (offsets.compArrOff !== null) {
        try {
            var arr = goPtr.add(offsets.compArrOff).readPointer();
            if (!arr || arr.isNull()) return null;
            var cnt = -1;
            for (var dc = 0x08; dc <= 0x18; dc += 8) {
                try {
                    var c = goPtr.add(offsets.compArrOff + dc).readS32();
                    if (c > 0 && c < 256) { cnt = c; break; }
                } catch (e) {}
            }
            if (cnt > 0) return { arr: arr, cnt: cnt, stride: offsets.compStride };
        } catch (e) {}
        return null;
    }
    for (var pi = 0; pi < FALLBACK_COMP_PROBES.length; pi++) {
        var p = FALLBACK_COMP_PROBES[pi];
        try {
            var ap = goPtr.add(p.arr).readPointer();
            var cp = goPtr.add(p.cnt).readS32();
            if (ap && !ap.isNull() && cp > 0 && cp < 256) {
                return { arr: ap, cnt: cp, stride: p.s };
            }
        } catch (e) {}
    }
    return null;
}

// ─── initialization ───────────────────────────────
function init() {
    var unityBase = (function () {
        try { var m = Process.findModuleByName('UnityPlayer.so'); return m ? m.base : null; } catch (e) { return null; }
    })();
    if (!unityBase) { console.log('[!] UnityPlayer.so not found — abort'); return; }
    var sInstAddr = unityBase.add(0x20EAAC0);
    console.log('[*] UnityPlayer.so base=' + hp(unityBase) + '  s_Instance@' + hp(sInstAddr));

    // === Auto-discovery (из lib_offsets_discovery.js) ===
    if (typeof discoverGameObjectOffsets !== 'function') {
        console.log('[!] discoverGameObjectOffsets() не найден — lib_offsets_discovery.js должен быть в -l chain раньше');
    }
    console.log('[*] Discovering C++ GameObject offsets via Camera.main...');
    var offsets = discoverGameObjectOffsets();
    console.log('[*] Discovery result: instanceIdOff=+0x' + offsets.instanceIdOff.toString(16) +
                ' m_Components=+0x' + (offsets.compArrOff !== null ? offsets.compArrOff.toString(16) : '??') +
                ' stride=' + (offsets.compArrOff !== null ? offsets.compStride : '??') +
                ' nodeToGo=+0x' + offsets.nodeToGo.toString(16));

    var targetKlasses = [];
    var asmCSharp = safe(function(){ return Il2Cpp.domain.assembly('Assembly-CSharp'); }, null);
    if (asmCSharp) {
        var ct  = safe(function(){ return asmCSharp.image.class('CollisionTester'); }, null);
        var cga = safe(function(){ return asmCSharp.image.class('CollisionGridAtlasGenerator'); }, null);
        if (ct)  targetKlasses.push(ct);
        if (cga) targetKlasses.push(cga);
    }
    var asmCommon = safe(function(){ return Il2Cpp.domain.assembly('Albion.Common'); }, null);
    if (asmCommon) {
        var a7h = safe(function(){ return asmCommon.image.class('a7h'); }, null);
        if (a7h) targetKlasses.push(a7h);
    }

    if (!targetKlasses.length) {
        console.log('[!] NO target klasses found (CollisionTester, CollisionGridAtlasGenerator, a7h) — abort');
        return;
    }
    console.log('[*] Target klasses:');
    targetKlasses.forEach(function (k) {
        console.log('   ' + cname(k) + '  handle=' + hp(safe(function(){return k.handle;}, null)) + '  instanceSize=' + (k.instanceSize||'?'));
    });

    // FIX: если discovery не нашёл m_InstanceID (Camera.main null), brute-force'им по 6 кандидатам.
    // Идемпотентно с dump_all_gos: те же offsets, тот же scoring.
    if (offsets.instanceIdOff === FALLBACK_GO_ID_OFF) {
        try {
            var gomTmp = sInstAddr.readPointer();
            var startTmp = gomTmp.add(0x18).readPointer();
            if (startTmp && !startTmp.isNull()) {
                var cands = [0x08, 0x0C, 0x10, 0x14, 0x18, 0x20];
                var bestOff = FALLBACK_GO_ID_OFF, bestScore = -1;
                for (var ci = 0; ci < cands.length; ci++) {
                    var off = cands[ci];
                    var score = 0, samples = 0;
                    var n = startTmp;
                    for (var si = 0; si < 80 && n && !n.isNull(); si++) {
                        try {
                            var g = n.sub(offsets.nodeToGo);
                            var id = g.add(off).readS32();
                            if (id > 0 && id < 0x3FFFFFFF) score++;
                        } catch (e) {}
                        samples++;
                        try { n = n.readPointer(); } catch (e) { break; }
                        if (n && !n.isNull() && n.equals(startTmp)) break;
                    }
                    console.log('[*]   probe +0x' + off.toString(16) + ': ' + score + '/' + samples + ' plausible ids');
                    if (score > bestScore) { bestScore = score; bestOff = off; }
                }
                if (bestScore > 0) {
                    console.log('[*] Brute-force: m_InstanceID @ +0x' + bestOff.toString(16) + ' (score=' + bestScore + ')');
                    offsets.instanceIdOff = bestOff;
                }
            }
        } catch (e) { console.log('[!] brute-force skipped: ' + e.message); }
    }

    // ─── Poll loop ─────────────────────────────
    var tickNum = 0;
    var intervalId = setInterval(function () {
        try {
            tickNum++;
            var gomPtr = sInstAddr.readPointer();
            if (!gomPtr || gomPtr.isNull()) return;
            var startNode = gomPtr.add(0x18).readPointer();
            if (!startNode || startNode.isNull()) return;
            var node = startNode;
            var nodesWalked = 0;
            var matchCount = 0;
            for (var i = 0; i < MAX_NODES_PER_POLL; i++) {
                if (i > 0 && node.equals(startNode)) break;
                if (!node || node.isNull()) break;
                var nextNode = (function () { try { return node.readPointer(); } catch (e) { return null; } })();
                var goPtr = node.sub(offsets.nodeToGo);
                if (goPtr && !goPtr.isNull()) {
                    var goId = 0;
                    try { goId = goPtr.add(offsets.instanceIdOff).readS32(); } catch (e) {}
                    // FIX: жёстче фильтруем — id 1..0x3FFFFFFF (Unity InstanceID range)
                    if (goId > 0 && goId < 0x40000000 && !seenGoIds.has(goId)) {
                        seenGoIds.add(goId);
                        var compInfo = findComponentsOnGO(goPtr, offsets);
                        if (compInfo) {
                            for (var c = 0; c < compInfo.cnt; c++) {
                                var compPtr = null;
                                try { compPtr = compInfo.arr.add(c * compInfo.stride).readPointer(); } catch (e) {}
                                if (!compPtr || compPtr.isNull()) continue;
                                var hit = scanComponentForManagedPtr(compPtr, targetKlasses);
                                if (hit) {
                                    var hStr = hit.managedPtr.toString();
                                    if (!seenManaged.has(hStr)) {
                                        seenManaged.add(hStr);
                                        matchCount++;
                                        console.log('\n[TICK#' + tickNum + '] GOM found ' + cname(hit.klass) + ' on GO#' + goId + '  managed=' + hp(hit.managedPtr));
                                        scanParentChainByteArrays(hit.managedPtr, hit.klass, 'GOM_' + cname(hit.klass) + '_GO' + goId);
                                    }
                                }
                            }
                        }
                    }
                }
                nodesWalked++;
                if (!nextNode || nextNode.isNull()) break;
                node = nextNode;
            }
            if (tickNum === 1 || matchCount > 0) {
                console.log('[*] tick#' + tickNum + ' walked ' + nodesWalked + ' GOs, ' + matchCount + ' new matches, total seen: GO=' + seenGoIds.size + ' managed=' + seenManaged.size + ' dumps=' + dumpCount + '/' + MAX_DUMPS);
            }
        } catch (e) {
            if (tickNum === 1) console.log('[!] tick#1 error: ' + e.message);
        }
    }, POLL_MS);

    console.log('[*] GOM poll started (every ' + POLL_MS + 'ms). Watchdog: ' + (WATCHDOG_MS/1000) + 's\n');
}

Il2Cpp.perform(function () {
    console.log('[*] === FRIDA_GOM_POLL ===\n');
    try { init(); }
    catch (e) { console.log('[!] init failed: ' + (e.message || e)); }
});

setTimeout(function () {
    console.log('\n[*] === watchdog detach ===');
    console.log('[*] dumps: ' + dumpCount + '/' + MAX_DUMPS + '  seen GO=' + seenGoIds.size + '  managed=' + seenManaged.size);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);
