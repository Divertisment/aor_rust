const TYPE_MC = 0x18f98ae0;
const PX = 179.84, PY = 59.62;
const results = [];
const scanned = new Set();
const pattern = 'e0 8a f9 18';
const ranges = Process.enumerateRanges('rw-');

for (const r of ranges) {
    const base = r.base;
    // Only scan heap ranges (0x7C...)
    if (base.compare(ptr('0x700000000000')) < 0) continue;
    if (r.size > 300000000) continue;
    
    try {
        const matches = Memory.scanSync(base, r.size, pattern);
        for (const m of matches) {
            const a = m.address;
            const go = a.add(0x18).readU64();
            if (go < 0x700000000000) continue;
            
            const x = a.add(0xF0).readFloat();
            const y = a.add(0xF4).readFloat();
            const z = a.add(0xF8).readFloat();
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
            if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) continue;
            
            let id;
            try { id = ptr(go).add(0x10).readS32(); } catch(e) { continue; }
            if (id <= 0 || id > 5000000) continue;
            if (scanned.has(id)) continue;
            scanned.add(id);
            
            const dx = x - PX, dy = y - PY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            // Only entities within ±3 meters
            // if (dist > 3) continue;
            
            const angle = ptr(go).add(0x38).readFloat();
            results.push({
                addr: a.toString(16).padStart(12,'0'),
                id, x, y, z, dist,
                go: go.toString(16).padStart(12,'0'),
                angle: isFinite(angle) ? angle.toFixed(2) : '?'
            });
        }
    } catch(e) {}
}

results.sort((a,b) => a.dist - b.dist);
for (const m of results) {
    const near = m.dist <= 3 ? ' <<<' : '';
    console.log(m.addr + ' | ID=' + m.id + ' | X=' + m.x.toFixed(2) + ' Y=' + m.y.toFixed(2) +
        ' Z=' + m.z.toFixed(2) + ' | dist=' + m.dist.toFixed(2) + near);
}
