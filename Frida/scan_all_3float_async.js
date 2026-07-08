const F1_MIN = 176, F1_MAX = 186;
const F2_MIN = 72, F2_MAX = 82;
const CHUNK_SZ = 0x100000;
const BATCH = 10;

const ranges = Process.enumerateRanges('r--').concat(Process.enumerateRanges('rw-')).concat(Process.enumerateRanges('r-x'));
let idx = 0, total = 0, all = [];

function scanRange(base, size) {
    if (size < 12 || size > 10*1024*1024) return [];
    const res = [];
    let off = 0;
    while (off < size) {
        const chunk = Math.min(CHUNK_SZ, size - off);
        try {
            const bytes = base.add(off).readByteArray(chunk);
            if (!bytes) { off += chunk; continue; }
            const arr = new Float32Array(bytes);
            for (let i = 0; i < arr.length - 2; i++) {
                const f1 = arr[i], f2 = arr[i+1];
                if (f1 >= F1_MIN && f1 <= F1_MAX && f2 >= F2_MIN && f2 <= F2_MAX) {
                    res.push({addr: ptr(base).add(off + i*4).toString(), f1: +f1.toFixed(3), f2: +f2.toFixed(3), f3: +arr[i+2].toFixed(3)});
                }
            }
        } catch(e) {}
        off += chunk;
    }
    return res;
}

function next() {
    if (idx >= ranges.length) {
        console.log('\n=== TOTAL: ' + all.length + ' matches ===');
        for (const m of all) console.log('0x' + m.addr + ' f1=' + m.f1 + ' f2=' + m.f2 + ' f3=' + m.f3);
        return;
    }
    const r = ranges[idx++];
    const found = scanRange(r.base, r.size);
    total += found.length;
    for (const f of found) all.push(f);
    if (idx % 1000 === 0) console.log('progress: ' + idx + '/' + ranges.length + ' found: ' + total);
    setImmediate(next);
}

console.log('scanning ' + ranges.length + ' ranges...');
setImmediate(next);
