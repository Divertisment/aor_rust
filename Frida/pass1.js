'use strict';

const F1_MIN = 176.0, F1_MAX = 186.0;
const F2_MIN = 72.0, F2_MAX = 82.0;

const scanLib = new CModule(`
typedef unsigned long uintptr;
typedef int int32;

void scan_mem(void* base, uintptr size, void* out, int32* pcount, int32 max) {
    int32 count = 0;
    uintptr i;
    for (i = 0; i <= size - 12; i += 8) {
        float f1 = *(float*)((char*)base + i);
        float f2 = *(float*)((char*)base + i + 4);
        float f3 = *(float*)((char*)base + i + 8);
        if (f1 >= 176.0f && f1 <= 186.0f && f2 >= 72.0f && f2 <= 82.0f) {
            if (count >= max) break;
            ((uintptr*)((char*)out + count * 24))[0] = (uintptr)((char*)base + i);
            ((float*)((char*)out + count * 24 + 8))[0] = f1;
            ((float*)((char*)out + count * 24 + 12))[0] = f2;
            ((float*)((char*)out + count * 24 + 16))[0] = f3;
            count++;
        }
    }
    *pcount = count;
}
`);

const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: true});
const MAX = 10000;
const out = Memory.alloc(MAX * 24);
const pcount = Memory.alloc(4);
const results = {};

for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.size > 512 * 1024 * 1024) continue;

    pcount.writeInt(MAX);
    try {
        scanLib.scan_mem(r.base, r.size, out, pcount, MAX);
        const count = pcount.readInt();
        for (let j = 0; j < count; j++) {
            const base = out.add(j * 24);
            const addr = base.readPointer();
            const f1 = base.add(8).readFloat();
            const f2 = base.add(12).readFloat();
            const f3 = base.add(16).readFloat();
            results[addr.toString()] = [f1.toFixed(4), f2.toFixed(4), f3.toFixed(4)];
        }
    } catch (e) {
        console.log('ERR region ' + i + ': ' + e);
    }
}

const keys = Object.keys(results);
for (let i = 0; i < keys.length; i++) {
    const v = results[keys[i]];
    console.log(keys[i] + ' ' + v[0] + ' ' + v[1] + ' ' + v[2]);
}
if (keys.length === 0) console.log('NOTHING');
console.log('DONE');
