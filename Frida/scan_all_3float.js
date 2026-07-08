const F1_MIN = 176, F1_MAX = 186;
const F2_MIN = 72, F2_MAX = 82;
const CHUNK_SZ = 0x100000;

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

const ALL = [];
const protections = ['r--', 'rw-', 'r-x'];
let done = 0, total = 0;

for (const p of protections) {
    const ranges = Process.enumerateRanges(p);
    total += ranges.length;
    for (const r of ranges) {
        const found = scanRange(r.base, r.size);
        for (const f of found) ALL.push(f);
        done++;
        if (done % 500 === 0) console.log('Progress: ' + done + '/' + total + ' found: ' + ALL.length);
    }
}

console.log('\nTotal matches: ' + ALL.length);
for (const m of ALL) {
    console.log('0x' + m.addr + ' -> f1=' + m.f1 + ' f2=' + m.f2 + ' f3=' + m.f3);
}
