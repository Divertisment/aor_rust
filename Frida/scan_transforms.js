console.log("[!] Сканирование Transform объектов (childCount + Vector3 + GO ptr + ID)...");

setTimeout(function() {
    var ranges = Process.enumerateRanges('rw-');
    console.log("[+] Регионов: " + ranges.length);
    var found = 0;
    var seenGO = {};

    ranges.forEach(function(range) {
        if (range.size > 0x03000000) return;
        try {
            var base = range.base;
            var size = range.size;

            for (var off = 0; off < size - 0x100; off += 4) {
                var addr = base.add(off);
                try {
                    var childCount = addr.add(0x80).readS32();
                    if (childCount < 0 || childCount > 20) continue;

                    var x = addr.add(0xF0).readFloat();
                    var y = addr.add(0xF4).readFloat();
                    var z = addr.add(0xF8).readFloat();
                    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
                    if (Math.abs(x) > 10000 || Math.abs(y) > 10000 || Math.abs(z) > 1000) continue;
                    if (x === 0.0 && y === 0.0 && z === 0.0) continue;

                    var goPtr = addr.add(0x18).readPointer();
                    if (goPtr.isNull()) continue;
                    if (Process.findRangeByAddress(goPtr) === null) continue;

                    var instanceID = goPtr.add(0x10).readS32();
                    if (instanceID <= 0 || instanceID > 10000000) continue;

                    var goStr = goPtr.toString();
                    if (seenGO[goStr]) continue;
                    seenGO[goStr] = true;

                    found++;
                    console.log(`[#${found}] Transform=${addr} | GO=${goPtr} | ID=${instanceID} | children=${childCount} | X=${x.toFixed(2)} Y=${y.toFixed(2)} Z=${z.toFixed(2)}`);
                } catch(e) {}
            }
        } catch(e) {}
    });

    console.log(`[!] Готово. Найдено уникальных Transform: ${found}`);
}, 10);
