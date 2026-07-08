// Используем точные координаты пользователя и адрес Transform
var targetZ = 12.0;
var myX = 172.368576;
var myY = 84.74668884;

// Адрес начала блока координат Transform
var coordBlockStart = ptr("0x74AA798EDB70");

// Адрес самого Transform (координаты в +0xF0, значит Transform начинается раньше)
var transformBase = coordBlockStart.sub(0xF0);

console.log("[+] Сканирую память в поисках объектов рядом с:");
console.log(`  X=${myX.toFixed(4)}, Y=${myY.toFixed(4)}, Z=${targetZ.toFixed(4)}`);

// Диапазон памяти для сканирования (вокруг твоих адресов)
var start = ptr("0x74aa00000000");
var end = ptr("0x74ab00000000");
var size = end.sub(start).toInt32();

// Ищем Z = 12.0 (float) = 0x41400000 (hex: 00 00 40 41)
Memory.scan(start, size, "00 00 40 41", {
    onMatch: function(address, size) {
        // address - это Z-координата
        try {
            var z = address.readFloat();
            var y = address.sub(4).readFloat();
            var x = address.sub(8).readFloat();
            
            // Проверяем: Z≈12, и XY в радиусе 2 метров от тебя
            if (Math.abs(z - targetZ) < 0.2 && 
                Math.abs(x - myX) < 2.0 && 
                Math.abs(y - myY) < 2.0) {
                
                var tfBase = address.sub(0xF8); // Начало Transform
                console.log("\n[FOUND] Нашел объект рядом!");
                console.log("  Pos: X=" + x.toFixed(4) + " Y=" + y.toFixed(4) + " Z=" + z.toFixed(4));
                console.log("  Transform Base: " + tfBase);
                
                // Пытаемся получить GameObject
                var go = tfBase.add(0x18).readPointer();
                console.log("  GameObject: " + go);
                
                // Посмотрим на GameObject, чтобы понять, что это
                try {
                    var iid = go.add(0x10).readU32();
                    console.log("    GameObject InstanceID: " + iid);
                    // Дампим компоненты GameObject, чтобы понять, что это за объект
                    // Проверим ключевые компоненты, например, Renderer или Name
                    console.log("    GameObject Components Dump (first 64 bytes):");
                    console.log(hexdump(go.add(0x68).readByteArray(64), {
                        offset: 0x68, length: 64, header: true, ansi: true
                    }));
                } catch(e) {
                    console.log("    Ошибка чтения GameObject: " + e);
                }
            }
        } catch(e) {}
    },
    onComplete: function() {
        console.log("\n[+] Сканирование завершено.");
    }
});

// Чтобы скрипт не завершился сразу, подождем
setTimeout(function(){}, 10000);
