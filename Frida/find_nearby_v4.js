const STATIC_COMPONENT_PTR = ptr("0x74AA798EDA80");

console.log("[!] Извлекаем точные координаты: Компонент - 0xF0...");

try {
    var coordsPtr = STATIC_COMPONENT_PTR.sub(0xF0);
    
    var myCurrentX = coordsPtr.readFloat();
    var myCurrentY = coordsPtr.add(4).readFloat();

    console.log(`[ЭТАЛОН] Твоя позиция во Фриде: X = ${myCurrentX.toFixed(2)}, Y = ${myCurrentY.toFixed(2)}`);
    console.log(`[!] Запуск сканирования кучи... Ищем лошадь в радиусе +-2.0 метров...`);

    setTimeout(function() {
        var ranges = Process.enumerateRanges('rw-');
        var foundObjects = 0;

        ranges.forEach(function(range) {
            if (range.size > 0x00800000 || range.size < 0x00001000) return; 

            try {
                var base = range.base;
                var size = range.size;

                for (var offset = 0; offset < size - 0x100; offset += 4) {
                    var potentialGo = base.add(offset);

                    try {
                        var posX = potentialGo.add(0x3C).readFloat();
                        var posY = potentialGo.add(0x40).readFloat();
                        
                        if (isNaN(posX) || isNaN(posY) || (posX === 0.0 && posY === 0.0)) continue;

                        var diffX = Math.abs(posX - myCurrentX);
                        var diffY = Math.abs(posY - myCurrentY);

                        if (diffX <= 2.0 && diffY <= 2.0) {
                            var instanceID = potentialGo.add(0x10).readS32();
                            if (instanceID <= 0 || instanceID > 2000000000) continue;

                            var rotation = potentialGo.add(0x38).readFloat();
                            if (isNaN(rotation) || rotation < 0.0 || rotation > 360.0) continue;

                            foundObjects++;
                            var isMe = (diffX < 0.01 && diffY < 0.01);
                            var label = isMe ? "ТЫ (GameObject)" : "ЛОШАДЬ / ОБЪЕКТ РЯДОМ";

                            console.log(`\n[НАЙДЕНО #${foundObjects}] [${label}]`);
                            console.log(` -> Адрес GO: ${potentialGo}`);
                            console.log(` -> ID (+0x10): ${instanceID}`);
                            console.log(` -> Поворот (+0x38): ${rotation.toFixed(2)}°`);
                            console.log(` -> Позиция: X = ${posX.toFixed(6)} | Y = ${posY.toFixed(6)}`);
                            console.log(` -> dX = ${diffX.toFixed(4)}, dY = ${diffY.toFixed(4)}`);
                            console.log(`--------------------------------------------------`);
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        });
        console.log(`\n[!] Сканирование завершено. Найдено реальных целей рядом: ${foundObjects}`);
    }, 10);

} catch (err) {
    console.log(`[-] Ошибка чтения координат: ${err.message}`);
}
