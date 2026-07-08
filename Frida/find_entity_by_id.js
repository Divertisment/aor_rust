// Find entity ID 551 in memory, extract coordinates
// frida -H 127.0.0.1:27042 -p PID -l find_entity_by_id.js -t 120

const TARGET_ID = 551;
const MAX_SCAN_MB = 64;

function tryXYZ(buf, off) {
    if (off + 12 > buf.byteLength) return null;
    let x = buf.getFloat32(off, true);
    let y = buf.getFloat32(off + 4, true);
    let z = buf.getFloat32(off + 8, true);
    if (isFinite(x) && isFinite(y) && isFinite(z) &&
        x > -20000 && x < 20000 && z > -20000 && z < 20000 &&
        y > -20000 && y < 20000 &&
        !(Math.abs(x) < 0.1 && Math.abs(y) < 0.1 && Math.abs(z) < 0.1)) {
        return [x, y, z];
    }
    return null;
}

function dumpContext(absAddr, buf, needleOff) {
    let start = needleOff >= 16 ? needleOff - 16 : 0;
    let len = Math.min(64, buf.byteLength - start);
    let slice = new Uint8Array(buf, start, len);
    let hex = Array.from(slice).map(b => ("0" + b.toString(16)).slice(-2)).join(' ');
    let line = `[MEM] ID ${TARGET_ID} @ ${absAddr}: ${hex}`;

    for (let delta of [0, 4, 8, 12, 16, 20, 24, 28, 32]) {
        let off = needleOff + 4 + delta;
        if (off + 12 > buf.byteLength) break;
        let dv = new DataView(buf, off, 12);
        let xyz = tryXYZ(dv, 0);
        if (xyz) {
            line += ` [XYZ d=${delta}] (${xyz[0].toFixed(2)}, ${xyz[1].toFixed(2)}, ${xyz[2].toFixed(2)})`;
            break;
        }
    }
    console.log(line);
}

// ---- Main ----
let ga = Process.findModuleByName("GameAssembly.so");
if (!ga) {
    console.log("[-] GameAssembly.so not found");
    Process.exit();
}
console.log(`[+] GA: ${ga.base}, size: 0x${ga.size.toString(16)}`);
console.log(`[+] Scanning for ID=${TARGET_ID} (KpAcuBa)...`);

let needle = new Uint8Array(4);
let dv = new DataView(needle.buffer);
dv.setInt32(0, TARGET_ID, true);

// 1st pass: GA writable ranges (data/bss — most likely for static entity data)
console.log(`[+] PASS 1: GA writable ranges`);
let gaRanges = ga.enumerateRanges('rw-') || [];
let totalFound = 0;
let totalScanned = 0;
let maxBytes = MAX_SCAN_MB * 1024 * 1024;

function scanRange(name, ranges) {
    for (let r of ranges) {
        if (totalFound >= 10 || totalScanned >= maxBytes) break;
        let size = r.size;
        if (size < 256 || size > 100 * 1024 * 1024) continue;

        let addr = r.base;
        let chunkSize = Math.min(512 * 1024, size);

        while (addr.toInt32() < r.base.add(size).toInt32() && totalFound < 10 && totalScanned < maxBytes) {
            let remaining = r.base.add(size).toInt32() - addr.toInt32();
            let readSize = Math.min(chunkSize, remaining);
            if (readSize < 4) break;

            try {
                let buf = addr.readByteArray(readSize);
                if (!buf) { addr = addr.add(chunkSize); continue; }
                let bytes = new Uint8Array(buf);

                let idx = 0;
                while ((idx = bytes.indexOf(TARGET_ID & 0xFF, idx)) !== -1) {
                    if (idx + 4 <= bytes.length) {
                        let val = (bytes[idx]) | (bytes[idx+1] << 8) | (bytes[idx+2] << 16) | (bytes[idx+3] << 24);
                        if (val === TARGET_ID) {
                            dumpContext(addr.add(idx), buf, idx);
                            totalFound++;
                            if (totalFound >= 10) break;
                        }
                    }
                    idx++;
                }
                totalScanned += readSize;
                addr = addr.add(readSize - 4);
            } catch(e) {
                addr = addr.add(0x10000);
            }
        }
    }
}

scanRange('GA', gaRanges);

// 2nd pass: anonymous ranges
if (totalFound < 5) {
    let all = Process.enumerateRanges('rw-');
    let anon = all.filter(r => !r.file && r.size >= 4096 && r.size <= 30*1024*1024);
    console.log(`[+] PASS 2: ${anon.length} anonymous ranges`);
    for (let r of anon) {
        if (totalFound >= 10 || totalScanned >= maxBytes) break;
        console.log(`[SCAN] ${r.base} size=${(r.size/1024/1024).toFixed(2)} MB`);
        scanRange('anon', [r]);
    }
}

console.log(`[+] Done. Scanned ${(totalScanned/1024/1024).toFixed(2)} MB, found ${totalFound} hits`);
