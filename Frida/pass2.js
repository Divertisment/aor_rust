'use strict';

const F1_MIN = 176.0, F1_MAX = 186.0;
const F2_MIN = 72.0, F2_MAX = 82.0;

function scan() {
    const results = {};
    const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: true});

    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const size = r.size;
        if (size > 8 * 1024 * 1024) continue;

        try {
            const buf = r.base.readByteArray(size);
            if (!buf) continue;
            const dv = new DataView(buf);

            for (let off = 0; off <= size - 12; off += 8) {
                const f1 = dv.getFloat32(off, true);
                const f2 = dv.getFloat32(off + 4, true);
                const f3 = dv.getFloat32(off + 8, true);
                if (f1 >= F1_MIN && f1 <= F1_MAX && f2 >= F2_MIN && f2 <= F2_MAX) {
                    const addr = r.base.add(off);
                    results[addr.toString()] = [f1, f2, f3];
                }
            }
        } catch (e) {}
    }
    return results;
}

const pass2 = scan();
console.log('PASS2_COUNT=' + Object.keys(pass2).length);
for (const [addr, v] of Object.entries(pass2)) {
    console.log(addr + ',' + v[0].toFixed(3) + ',' + v[1].toFixed(3) + ',' + v[2].toFixed(3));
}
