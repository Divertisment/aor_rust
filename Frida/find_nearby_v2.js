const BASE_COMPONENT_PTR = ptr("0x74AA798EDB70");

console.log("[!] Извлекаем точные координаты по логике Cheat Engine (Base - 0xF0)...");

try {
    var coordsPtr = BASE_COMPONENT_PTR.sub(0xF0);
    
    var myCurrentX = coordsPtr.readFloat();
    var myCurrentY = coordsPtr.add(4).readFloat();

    console.log(`[ЭТАЛОН] Твоя позиция из памяти: X = ${myCurrentX.toFixed(6)}, Y = ${myCurrentY.toFixed(6)}`);
    console.log(`[!] Ищем лошадь в куче в радиусе +-2.0 метров от этой точки...`);

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

                        var posX = potentialGo.add(0x3C).readFloat();
                        var posY = potentialGo.add(0x40).readFloat();

                        if (isNaN(posX) || isNaN(posY)) continue;

                        var diffX = Math.abs(posX - myCurrentX);
                        var diffY = Math.abs(posY - myCurrentY);

                        if (diffX <= 2.0 && diffY <= 2.0) {
                            var rotation = potentialGo.add(0x38).readFloat();
                            if (isNaN(rotation) || rotation < 0.0 || rotation > 360.0) continue;

                            foundObjects++;
                            var isMe = (diffX < 0.0001 && diffY < 0.0001);
                            var label = isMe ? "ТЫ (GameObject)" : "ЛОШАДЬ / ОБЪЕКТ РЯДОМ";

                            console.log(`[НАЙДЕНО #${foundObjects}] [${label}]`);
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

        console.log(`[!] Проверка завершена. Всего найдено целей рядом: ${foundObjects}`);
    }, 10);

} catch (err) {
    console.log(`[-] Ошибка чтения эталонных координат: ${err.message}`);
}
