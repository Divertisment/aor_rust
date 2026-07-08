// Targeted unwind: scan only specific memory regions
const C = {
    SEQ: '47 61 6d 65 4f 62 6a 65 63 74 00 4c 6f 63 61 6c 50 6f 73 69 74 69 6f 6e 00 4c 6f 63 61 6c 53 63 61 6c 65 00 4c 6f 63 61 6c 52 6f 74 61 74 69 6f 6e 00',
    L2_TYPE: '18 8d 45 17',  // 0x17458d18 LE
    L1_TYPE: '40 04 2e 18',  // 0x182e0440 LE
    MC_TYPE: 'e0 8a f9 18',  // 0x18f98ae0 LE
    L2_OFF: 0x10,
    L1_OFF: 0x40,
    MC_OFF: 0xA0,
};

function hex(p) { return '0x' + p.toString(16).padStart(12, '0'); }

function scanInRanges(pat, ranges, verifyFn) {
    for (const r of ranges) { try {
        const hits = Memory.scanSync(r.base, r.size, pat);
        for (const h of hits) { if (!verifyFn || verifyFn(h.address)) return h.address; }
    } catch(e) {} }
    return null;
}

function main() {
    // Get ranges we need
    const allRanges = Process.enumerateRanges('rw-').filter(r => r.size <= 300000000);

    // Step 1: String sequence - scan ALL readable memory
    console.log('[1] Scanning string sequence (unique 50-byte pattern) ...');
    const seqAddr = scanInRanges(C.SEQ, allRanges);
    if (!seqAddr) { console.log('FAIL: seq not found'); return; }
    console.log('  StringTable at: ' + hex(seqAddr) + ' -> "' + seqAddr.readCString(10) + '"');

    // Step 2: Level2 - scan ALL memory (Level2 is at low address 0x17xxxxxx)
    console.log('[2] Scanning Level2 ...');
    const l2 = scanInRanges(C.L2_TYPE, allRanges, addr =>
        addr.add(C.L2_OFF).readU64().toString() === seqAddr.toString()
    );
    if (!l2) { console.log('FAIL: L2 not found'); return; }
    console.log('  Level2: ' + hex(l2));

    // Step 3: All Level1s pointing to this Level2
    console.log('[3] Scanning ALL Level1s ...');
    const l1s = [];
    for (const r of allRanges) { try {
        const hits = Memory.scanSync(r.base, r.size, C.L1_TYPE);
        for (const h of hits) {
            if (h.address.add(C.L1_OFF).readU64().toString() === l2.toString())
                l1s.push(h.address);
        }
    } catch(e) {} }
    console.log('  Found ' + l1s.length + ' Level1 instances');
    for (const l1 of l1s) console.log('    ' + hex(l1));

    // Step 4: Find MCs for each Level1
    console.log('[4] Scanning MCs ...');
    const heap = allRanges.filter(r => r.base.compare(ptr('0x700000000000')) >= 0);
    for (const l1 of l1s) {
        const mc = scanInRanges(C.MC_TYPE, heap, addr => {
            if (addr.add(C.MC_OFF).readU64().toString() !== l1.toString()) return false;
            const x = addr.add(0xF0).readFloat();
            return isFinite(x) && Math.abs(x) < 10000 && Math.abs(x) > 0.01;
        });
        if (mc) {
            const x = mc.add(0xF0).readFloat();
            const y = mc.add(0xF4).readFloat();
            const z = mc.add(0xF8).readFloat();
            const type = mc.add(0x60).readU32();
            console.log('  ' + hex(mc) + ' -> L1=' + hex(l1) + ' X=' + x.toFixed(2) + ' Y=' + y.toFixed(2) + ' type=0x' + type.toString(16));
        }
    }
}

try { main(); } catch(e) { console.log('Error: ' + e.message); }
