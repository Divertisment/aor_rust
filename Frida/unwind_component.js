// Unwind: find MC from unique string sequence
// Sequence: "GameObject\0LocalPosition\0LocalScale\0LocalRotation\0EditStonePrefabs"
// Chain: MC +0xA0 -> L1(0x182e0440) +0x40 -> L2(0x17458d18) +0x10 -> StringTable

const C = {
    SEQ_HEX: '47 61 6d 65 4f 62 6a 65 63 74 00 4c 6f 63 61 6c 50 6f 73 69 74 69 6f 6e 00 4c 6f 63 61 6c 53 63 61 6c 65 00 4c 6f 63 61 6c 52 6f 74 61 74 69 6f 6e 00',
    SEQ_LEN: 0x32,  // offset from seq start to "EditStonePrefabs"
    L1_TYPE: 0x182e0440,  L1_OFF: 0x40,
    L2_TYPE: 0x17458d18,  L2_OFF: 0x10,
    MC_TYPE: 0x18f98ae0,  MC_OFF: 0xA0,
};

function hex(p) { return '0x' + p.toString(16).padStart(12, '0'); }
function u32pat(v) {
    v >>>= 0;
    return ((v) & 0xFF).toString(16).padStart(2, '0') + ' ' +
           ((v >>> 8) & 0xFF).toString(16).padStart(2, '0') + ' ' +
           ((v >>> 16) & 0xFF).toString(16).padStart(2, '0') + ' ' +
           ((v >>> 24) & 0xFF).toString(16).padStart(2, '0');
}

function scanPat(pat, ranges, verifyFn) {
    for (const r of ranges) { try {
        const hits = Memory.scanSync(r.base, r.size, pat);
        for (const h of hits) { if (!verifyFn || verifyFn(h.address)) return h.address; }
    } catch(e) {} }
    return null;
}

function allRanges() { return Process.enumerateRanges('rw-').filter(r => r.size <= 300000000); }
function heapRanges() { return allRanges().filter(r => r.base.compare(ptr('0x700000000000')) >= 0); }

function main() {
    const all = allRanges();
    const heap = heapRanges();

    // Step 1: Find the string sequence
    console.log('[1] Scanning unique string sequence ...');
    const seqAddr = scanPat(C.SEQ_HEX, all);
    if (!seqAddr) { console.log('FAIL: string sequence not found'); return; }
    console.log('  Sequence at: ' + hex(seqAddr));
    console.log('  -> "' + seqAddr.readCString(10) + '"');

    // Step 2: find Level2 by type, verify +0x10 points to seqAddr (table base)
    console.log('[2] Level2 scan ...');
    const l2 = scanPat(u32pat(C.L2_TYPE), all, addr =>
        addr.add(C.L2_OFF).readU64().toString() === seqAddr.toString()
    );
    if (!l2) { console.log('FAIL: Level2 not found'); return; }
    console.log('  Level2: ' + hex(l2));

    // Step 3: find Level1 by type, verify +0x40 points to l2
    console.log('[3] Level1 scan ...');
    const l1 = scanPat(u32pat(C.L1_TYPE), all, addr =>
        addr.add(C.L1_OFF).readU64().toString() === l2.toString()
    );
    if (!l1) { console.log('FAIL: Level1 not found'); return; }
    console.log('  Level1: ' + hex(l1));

    // Step 4: find MC by type, verify +0xA0 -> l1, validate coords
    console.log('[4] MC scan ...');
    const mc = scanPat(u32pat(C.MC_TYPE), heap, addr => {
        if (addr.add(C.MC_OFF).readU64().toString() !== l1.toString()) return false;
        const x = addr.add(0xF0).readFloat();
        return isFinite(x) && Math.abs(x) < 10000 && Math.abs(x) > 0.01;
    });
    if (!mc) { console.log('FAIL: MC not found'); return; }

    const x = mc.add(0xF0).readFloat();
    const y = mc.add(0xF4).readFloat();
    const z = mc.add(0xF8).readFloat();
    console.log('\n=== COMPONENT: ' + hex(mc) + ' ===');
    console.log('Coords: X=' + x.toFixed(2) + ' Y=' + y.toFixed(2) + ' Z=' + z.toFixed(2));
    console.log('\nChain:');
    console.log('  ' + hex(mc) + ' +0xA0 -> ' + hex(l1) + ' +0x40 -> ' + hex(l2) + ' +0x10 -> ' + hex(seqAddr));
}

try { main(); } catch(e) { console.log('Error: ' + e.message); }
