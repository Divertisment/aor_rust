'use strict';

const F1_MIN = 176, F1_MAX = 186;
const F2_MIN = 72,  F2_MAX = 82;
const STEP = 8;
const BATCH_SIZE = 500;
const CHUNK_SZ = 0x100000;

const ranges = Process.enumerateRanges('rw-').filter(r => {
    const p = r.file ? r.file.path : '';
    return p.indexOf('.so') === -1 && p.indexOf('[') === -1 && p.length < 2;
});

let idx = 0, batch = [], total = 0;

function scanRange(base, size) {
    const res = [];
    let off = 0;
    while (off + 12 <= size) {
        const chunk = Math.min(CHUNK_SZ, size - off);
        try {
            const bytes = base.add(off).readByteArray(chunk);
            if (!bytes) { off += chunk; continue; }
            const arr = new Float32Array(bytes);
            const lim = arr.length - 2;
            let i = 0;
            while (i < lim) {
                const x = arr[i], y = arr[i+1];
                if (x !== 0 && y !== 0 && x >= -2000 && x <= 2000 && y >= -2000 && y <= 2000 &&
                    x >= F1_MIN && x <= F1_MAX && y >= F2_MIN && y <= F2_MAX) {
                    res.push([ptr(base).add(off + i*4).toString(),
                              +x.toFixed(3), +y.toFixed(3), +arr[i+2].toFixed(3)]);
                }
                i += (STEP / 4);
            }
        } catch (e) {}
        off += chunk;
    }
    return res;
}

function next() {
    if (idx >= ranges.length) {
        if (batch.length) { send({ type: 'batch', matches: batch }); batch = []; }
        send({ type: 'done', count: total });
        return;
    }
    const r = ranges[idx++];
    const found = scanRange(r.base, r.size);
    total += found.length;
    for (let j = 0; j < found.length; j++) batch.push(found[j]);
    if (batch.length >= BATCH_SIZE) {
        send({ type: 'batch', matches: batch }); batch = [];
    }
    if (idx % 50 === 0 || idx === ranges.length)
        send({ type: 'prog', done: idx, total: ranges.length });
    setImmediate(next);
}

setImmediate(next);
