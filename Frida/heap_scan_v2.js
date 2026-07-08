console.log("[!] Запуск тотального сканирования кучи строго по твоим офсетам (ID, Поворот, X, Y)...");

setTimeout(function() {
    var ranges = Process.enumerateRanges('rw-');
    console.log("[+] Найдено регионов для анализа: " + ranges.length);
    var foundObjects = 0;

    ranges.forEach(function(range) {
        if (range.size > 0x03000000) return; 

        try {
            var base = range.base;
            var size = range.size;

            for (var offset = 0; offset < size - 0x100; offset += 4) {
                var potentialGo = base.add(offset);

                try {
                    var instanceID = potentialGo.add(0x10).readS32();
                    if (instanceID <= 0 || instanceID > 2000000000) continue;

                    var rotation = potentialGo.add(0x38).readFloat();
                    if (isNaN(rotation) || rotation < 0.0 || rotation > 360.0) continue;

                    var posX = potentialGo.add(0x3C).readFloat();
                    var posY = potentialGo.add(0x40).readFloat();

                    if (isNaN(posX) || isNaN(posY) || (posX === 0.0 && posY === 0.0)) continue;
                    if (Math.abs(posX) > 50000.0 || Math.abs(posY) > 50000.0) continue;

                    foundObjects++;
                    
                    console.log(`[УСПЕХ #${foundObjects}] GO Address = ${potentialGo}`);
                    console.log(` -> ID (+0x10): ${instanceID}`);
                    console.log(` -> Поворот (+0x38): ${rotation.toFixed(2)}°`);
                    console.log(` -> Координаты: X = ${posX.toFixed(2)} | Y = ${posY.toFixed(2)}`);
                    console.log(`--------------------------------------------------`);

                } catch (e) {
                }
            }
        } catch (e) {}
    });

    console.log(`[!] Сканирование завершено. Успешно выведено объектов: ${foundObjects}`);
}, 10);
