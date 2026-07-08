var targetZ = 12.0;
var myX = 172.36;
var myY = 84.74;

// Диапазон памяти, где обычно лежат объекты (на основе твоих адресов)
var start = ptr("0x74aa00000000");
var end = ptr("0x74ab00000000");
var size = end.sub(start).toInt32();

console.log("[+] Сканирую память в радиусе вокруг: " + myX.toFixed(2) + ", " + myY.toFixed(2));

// Ищем значение 12.0 (float) = 0x41400000
Memory.scan(start, size, "00 00 40 41", {
    onMatch: function(address, size) {
        try {
            // Если это Z, то X и Y должны быть на 8 и 4 байта раньше
            var z = address.readFloat();
            var y = address.sub(4).readFloat();
            var x = address.sub(8).readFloat();
            
            // Проверяем: Z≈12, и XY в радиусе 2 метра от тебя
            if (Math.abs(z - targetZ) < 0.2 && 
                Math.abs(x - myX) < 2.0 && 
                Math.abs(y - myY) < 2.0) {
                
                var tfBase = address.sub(0xF8); // Примерное начало Transform
                console.log("\n[FOUND] Нашел объект рядом!");
                console.log("  Pos: X=" + x.toFixed(2) + " Y=" + y.toFixed(2) + " Z=" + z.toFixed(2));
                console.log("  Transform Base: " + tfBase);
                
                // Пробуем найти его GameObject
                var go = tfBase.add(0x18).readPointer();
                console.log("  GameObject: " + go);
            }
        } catch(e) {}
    },
    onComplete: function() {
        console.log("\n[+] Сканирование завершено.");
    }
});

setTimeout(function(){}, 10000);
