'use strict';

const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: true});
for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    console.log(`region ${i}: base=0x${r.base.toString(16)} size=${(r.size / 1024 / 1024).toFixed(2)}MB protection=${r.protection}`);
}
