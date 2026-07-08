// Enumerate ALL MOVEMENT COMPONENTS: scan all memory, no size limit
const MC_TYPE = 'e0 8a f9 18';

console.log('Scanning ALL memory for MC type 0x18f98ae0 ...');
const results = [];
const seen = new Set();

const ranges = Process.enumerateRanges('rw-');
for (const r of ranges) {
    try {
        const hits = Memory.scanSync(r.base, r.size, MC_TYPE);
        for (const h of hits) {
            const a = h.address;
            const x = a.add(0xF0).readFloat();
            const y = a.add(0xF4).readFloat();
            const z = a.add(0xF8).readFloat();
            if (!isFinite(x) || Math.abs(x) > 10000) continue;
            if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) continue;
            
            const t60 = a.add(0x60).readU32();
            const go = a.add(0x18).readU64();
            let id = -1;
            if (go > 0x700000000000) {
                id = ptr(go).add(0x10).readS32();
            }
            const key = a.toString() + '-' + id;
            if (seen.has(key)) continue;
            seen.add(key);
            
            const l1 = a.add(0xA0).readPointer();
            results.push({ a, x, y, z, t60, go, id, l1 });
        }
    } catch(e) {}
}

console.log('Found ' + results.length + ' MCs:');
results.sort((a,b) => Math.sqrt(a.x*a.x + a.y*a.y) - Math.sqrt(b.x*b.x + b.y*b.y));
for (const r of results) {
    console.log(r.a + ' | ID=' + r.id + ' | X=' + r.x.toFixed(2) + ' Y=' + r.y.toFixed(2) +
        ' Z=' + r.z.toFixed(2) + ' | +0x60=' + r.t60 + ' | L1=' + r.l1);
}
