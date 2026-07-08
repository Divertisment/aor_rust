console.log("[!] Запуск тотального сканирования кучи на наличие GameObject (Tag 5)...");

var ranges = Process.enumerateRanges('rw-');
console.log("[+] Найдено регионов для анализа: " + ranges.length);

var foundObjects = 0;

ranges.forEach(function(range) {
    if (range.size > 0x05000000) return; 

    try {
        var base = range.base;
        var size = range.size;

        for (var offset = 0; offset < size - 0x100; offset += 8) {
            var potentialGo = base.add(offset);

            try {
                var tag = potentialGo.add(0x5C).readU16();
                var usedOffset = 0x5C;
                
                if (tag !== 5) {
                    tag = potentialGo.add(0x54).readU16();
                    usedOffset = 0x54;
                }

                if (tag === 5) {
                    var instanceID = potentialGo.add(0x10).readS32();
                    if (instanceID <= 0 || instanceID > 2000000000) continue;

                    var transformPtr = potentialGo.add(0x18).readPointer();
                    if (transformPtr.isNull() || Process.findRangeByAddress(transformPtr) === null) continue;

                    var x = transformPtr.add(0xF0).readFloat();
                    var y = transformPtr.add(0xF4).readFloat();
                    var z = transformPtr.add(0xF8).readFloat();

                    if (isNaN(x) || isNaN(y) || (x === 0.0 && y === 0.0)) continue;

                    foundObjects++;
                    console.log(`[УСПЕХ #${foundObjects}] GO=${potentialGo} (offset 0x${usedOffset.toString(16)}) | ID=${instanceID} | X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}, Z: ${z.toFixed(2)}`);
                }
            } catch (e) {
            }
        }
    } catch (e) {
    }
});

console.log(`[!] Сканирование кучи завершено. Всего обнаружено живых объектов: ${foundObjects}`);
