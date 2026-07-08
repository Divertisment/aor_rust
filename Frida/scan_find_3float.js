'use strict';

const F1_MIN = 176, F1_MAX = 186;
const F2_MIN = 72, F2_MAX = 82;
const BATCH_SIZE = 500;
const MAX_REGION_SIZE = 8 * 1024 * 1024; // 8 MB

// r-- = все читаемые регионы (rw-, r-x тоже подходят)
const ranges = Process.enumerateRanges('r--')
    .filter(r => !(r.file && r.file.path && r.file.path.indexOf('.so') !== -1));

let idx = 0, batch = [], total = 0;

function scanRange(base, size) {
    if (size < 12 || size > MAX_REGION_SIZE) return [];
    const res = [];
    try {
        const bytes = base.readByteArray(size);
        if (!bytes) return [];
        const arr = new Float32Array(bytes);
        for (let i = 0; i < arr.length - 2; i++) {
            const f1 = arr[i], f2 = arr[i+1];
            if (f1 >= F1_MIN && f1 <= F1_MAX && f2 >= F2_MIN && f2 <= F2_MAX) {
                res.push([ptr(base).add(i*4).toString(), +f1.toFixed(3), +f2.toFixed(3), +arr[i+2].toFixed(3)]);
            }
        }
    } catch(e) {}
    return res;
}

function next() {
    if (idx >= ranges.length) {
        if (batch.length) send({ type: 'batch', m: batch });
        send({ type: 'done', count: total, scanned: ranges.length });
        return;
    }
    const r = ranges[idx++];
    const found = scanRange(r.base, r.size);
    total += found.length;
    for (let j = 0; j < found.length; j++) batch.push(found[j]);
    if (batch.length >= BATCH_SIZE) {
        send({ type: 'batch', m: batch });
        batch = [];
    }
    if (idx % 100 === 0 || idx === ranges.length)
        send({ type: 'prog', done: idx, total: ranges.length, found: total });

    setImmediate(next);
}

send({ type: 'start', ranges: ranges.length });
setImmediate(next);
