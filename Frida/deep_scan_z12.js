// Сканер: ищем Z=12.0, затем проверяем XY рядом
var targetZ = 12.0;
var knownX = 180.32; // Твоя позиция
var knownY = 61.90;  // Твоя позиция

console.log("Сканируем память в поисках Z=" + targetZ + "...");

var start = ptr("0x74aa00000000");
var end = ptr("0x74ab00000000");

var size = end.sub(start).toInt32(); // Надеюсь, размер памяти влезет в 32 бита, иначе Frida может ругаться

// Ищем float 12.0 (hex: 00 00 40 41)
Memory.scan(start, size, "00 00 40 41", {
    onMatch: function(address, size) {
        // address - это Z-координата (если это Transform+0xF8)
        // Тогда X=addr-8, Y=addr-4
        try {
            var z = address.readFloat();
            var y = address.sub(4).readFloat();
            var x = address.sub(8).readFloat();
            
            // Проверяем: Z=12, и XY рядом с тобой
            if (Math.abs(z - targetZ) < 0.1 && 
                Math.abs(x - knownX) < 10.0 && 
                Math.abs(y - knownY) < 10.0) {
                
                var transformAddr = address.sub(8); // Примерное начало блока координат
                console.log("\n[!!!] НАЙДЕН КАНДИДАТ:");
                console.log("  Адрес блока: " + transformAddr);
                console.log("  Pos: X=" + x.toFixed(2) + " Y=" + y.toFixed(2) + " Z=" + z.toFixed(2));
                
                // Проверяем, есть ли тут ссылка на GameObject (попробуем смещение +0x18 от блока - 0xF0)
                // Если адресTransform=transformAddr, то GameObject=transformAddr+0x18
                // Но нам нужно найти начало Transform, а не только блок координат.
                // Обычно координаты в +0xF0, значит начало трансформа = transformAddr - 0xF0
                var tStart = transformAddr.sub(0xF0);
                console.log("  Возможное начало Transform: " + tStart);
                var go = tStart.add(0x18).readPointer();
                console.log("  GameObject: " + go);
            }
        } catch(e) {}
    },
    onComplete: function() {
        console.log("\nСканирование завершено.");
    }
});

setTimeout(function(){}, 10000);
