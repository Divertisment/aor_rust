// ============================================================================
// gom_klass_stats.js — plain Frida, NO il2cpp-bridge (bridge has TypeErrors)
//
// Walks the Unity GameObjectManager (GOM) linked list at:
//     GameAssembly.so + 0x20EAAC0 (s_Instance static)
//     sentinel at GOM+0x18, intrusive linked list
//     each ListNode is embedded in GameObject at +0x68, so node - 0x68 = go
//
// Reads for each GO:
//     klass@0x18          (m_CachedPtr-style pointer)
//     cachedX @ 0xF0      (same offsets as scan_entities.js + EntityListFinder)
//     cachedY @ 0xF4
//
// Reports:
//   - total GOM entries
//   - top-20 Klass pointers (frequency)
//   - per-Klass: how many entries with valid X/Y in world range
// ============================================================================
'use strict';

const GASM_SINSTANCE = 0x20EAAC0;             // OFFSET (not absolute ptr) — hardcoded from walk_gom.py / dump_gom.py
const LISTNODE_OFFSET_IN_GO = 0x68;           // node lives at GO+0x68
// Node-relative: prev=+0x00, next=+0x08  (per walk_gom.py: gob[0x68]=ln.prev, gob[0x70]=ln.next)
const NODE_NEXT_OFFSET = 0x08;

// Canonical Klass magic the brute-force scanner already trusts
const TYPE_MC_KLASS_LO = 0x18f98ae0;
const TYPE_MC_KLASS_HI = 0x00000000;

// World bounds for "real entity" (matches scan_entities.js + EntityListFinder)
const X_MIN = 3, X_MAX = 500;
const Y_MIN = 3, Y_MAX = 500;

function fmtPtr(p) {
    if (p.isNull()) return 'NULL';
    var s = p.toString(16);
    return '0x' + s;
}

function isFiniteCoord(x) {
    return typeof x === 'number' && isFinite(x);
}

function readFloat(goPtr, off) {
    try { return Memory.readFloat(goPtr.add(off)); }
    catch (e) { return NaN; }
}

setTimeout(function () {
    var out = ['[gom_klass_stats] start'];

    // ---------- 1. GameAssembly.so base -----------------------------------
    var gasm = Process.findModuleByName('GameAssembly.so');
    if (!gasm) {
        console.log('[-] GameAssembly.so not loaded — wrong module layout. abort.');
        return;
    }
    out.push('[+] GameAssembly.so base = ' + fmtPtr(gasm.base));

    // ---------- 2. s_Instance pointer --------------------------------------
    var sInstanceGasm = gasm.base.add(GASM_SINSTANCE);
    var gom;
    try {
        gom = Memory.readPointer(sInstanceGasm);
    } catch (e) {
        console.log('[-] cannot read s_Instance @ ' + fmtPtr(sInstanceGasm) + ' : ' + e.message);
        return;
    }
    out.push('[+] s_Instance @ ' + fmtPtr(sInstanceGasm) + ' → GOM = ' + fmtPtr(gom));
    if (gom.compare(ptr('0x100000')) < 0 || gom.compare(ptr('0x800000000000')) >= 0) {
        out.push('[-] aborting — GOM not initialized yet (try again after login)');
        console.log(out.join('\n'));
        return;
    }

    // ---------- 3. Walk linked list ----------------------------------------
    var sentinelAddr = gom.add(0x18);
    var sentinelNext;
    try {
        sentinelNext = Memory.readPointer(sentinelAddr);    // sentinel's "first"
    } catch (e) {
        console.log('[-] cannot read sentinel.next @ ' + fmtPtr(sentinelAddr) + ' : ' + e.message);
        return;
    }
    out.push('[+] sentinel @ ' + fmtPtr(sentinelAddr) + ', first = ' + fmtPtr(sentinelNext));

    var klassCounts = {};        // klassHexString (slot=0x10) → count
    var klassCounts18 = {};     // klassHexString (slot=0x18) → count
    var klassWithPos = {};      // klassHexString (slot=0x10) → count of GOs with valid X/Y
    var klassWPosCoordSum = {}; // klassHexString (slot=0x10) → {n,sumX,sumY}
    var typeMcAt10 = 0;
    var typeMcAt18 = 0;
    var total = 0;
    var node = sentinelNext;
    // Hardcoded 5000: keeps memory pressure safe under tight MemAvailable.
    // (Full GOM walk can be 50K..200K entries and stresses OOM-killer.
    // 5000 samples still surface the dominant UI/world Klass frequencies.)
    var safetyLimit = 5000;

    while (!node.equals(sentinelAddr) && total < safetyLimit) {
        total++;
        // ListNode.next is at node +0x08 (LN layout: next=+8, prev=+0)
        var next;
        try { next = Memory.readPointer(node.add(NODE_NEXT_OFFSET)); } catch (e) { break; }
        // GameObject = node - 0x68
        var go = node.sub(LISTNODE_OFFSET_IN_GO);
        // Try TWO candidate Klass slots: +0x10 (Unity m_CachedPtr) and +0x18 (alternate)
        var klassAt10 = Memory.readPointer(go.add(0x10));
        var klassAt18 = Memory.readPointer(go.add(0x18));
        var key10 = klassAt10.toString();
        var key18 = klassAt18.toString();
        klassCounts[key10] = (klassCounts[key10] || 0) + 1;
        klassCounts18[key18] = (klassCounts18[key18] || 0) + 1;

        // Match against TYPE_MC magic (lo 32 bits; hi bits usually 0)
        var lo10 = klassAt10.compare(ptr('0x100000000')) >= 0 ? klassAt10.and(ptr('0xffffffff')).toInt32() : klassAt10.toInt32();
        if (lo10 === TYPE_MC_KLASS_LO) typeMcAt10++;
        var lo18 = klassAt18.compare(ptr('0x100000000')) >= 0 ? klassAt18.and(ptr('0xffffffff')).toInt32() : klassAt18.toInt32();
        if (lo18 === TYPE_MC_KLASS_LO) typeMcAt18++;

        // coords (only for slot+0x10 to avoid double-counting)
        var x = readFloat(go, 0xF0);
        var y = readFloat(go, 0xF4);
        if (isFiniteCoord(x) && isFiniteCoord(y) && x >= X_MIN && x <= X_MAX && y >= Y_MIN && y <= Y_MAX) {
            klassWithPos[key10] = (klassWithPos[key10] || 0) + 1;
            if (!klassWPosCoordSum[key10]) klassWPosCoordSum[key10] = { n: 0, sumX: 0, sumY: 0 };
            klassWPosCoordSum[key10].n++;
            klassWPosCoordSum[key10].sumX += x;
            klassWPosCoordSum[key10].sumY += y;
        }

        node = next;
        if (total > safetyLimit) break;
    }

    out.push('');
    out.push('[=] TYPE_MC (0x18f98ae0u) match counts:');
    out.push('    at GO+0x10: ' + typeMcAt10 + '   (Unity m_CachedPtr slot)');
    out.push('    at GO+0x18: ' + typeMcAt18 + '   (alternate slot)');

    out.push('');
    out.push('[=] total GOM entries walked: ' + total);
    out.push('[=] unique Klass IDs: ' + Object.keys(klassCounts).length);
    out.push('');

    // ---------- 4. Top-20 most frequent Klass -----------------------------
    var sorted = Object.keys(klassCounts).sort(function (a, b) {
        return klassCounts[b] - klassCounts[a];
    }).slice(0, 30);
    out.push('==== Top-30 most frequent Klass (freq / with-valid-pos / avg-X / avg-Y) ====');
    out.push(String('klass').padEnd(18) + ' string'.padEnd(22) + 'freq'.padStart(8) + '  pos'.padStart(6) + '   avgX     avgY     klass-name');
    out.push(new Array(86).join('-'));
    var klassNamesKnown = {
        '0x18f98ae0': 'TYPE_MC (the magic we use)',
        '0x1be2d40':  'CharacterSelection3dRoot-ish',
    };
    for (var i = 0; i < sorted.length; i++) {
        var k = sorted[i];
        var cnt = klassCounts[k];
        var pos = klassWithPos[k] || 0;
        var sum = klassWPosCoordSum[k];
        var avgX = sum ? (sum.sumX / sum.n).toFixed(2).padStart(7) : '  -   ';
        var avgY = sum ? (sum.sumY / sum.n).toFixed(2).padStart(7) : '  -   ';
        var hex = '0x' + k.padStart(16, '0');
        var lbl = klassNamesKnown[k] || '';
        out.push(hex.padEnd(18) + ' ' + k.padEnd(22) + String(cnt).padStart(8) + '  ' + String(pos).padStart(4) + '   ' + avgX + '  ' + avgY + '   ' + lbl);
    }

    out.push('');
    out.push('==== Per-Klass summary (text-sink-friendly) ====');
    for (var j = 0; j < sorted.length; j++) {
        var k2 = sorted[j];
        out.push('  klass 0x' + k2 + ' | total=' + klassCounts[k2] + ' with_pos=' + (klassWithPos[k2] || 0));
    }

    var summary = out.join('\n');
    console.log(summary);
    // File persistence: handled by shell `tee` (avoid frida-running-as-root file perm issues)
}, 100);
