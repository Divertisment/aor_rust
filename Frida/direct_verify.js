// Прямо читаем твои координаты
var coordAddr = ptr("0x74AA798EDB70");
var x = coordAddr.readFloat();
var y = coordAddr.add(4).readFloat();
var z = coordAddr.add(8).readFloat();
console.log("Твои координаты: X=" + x + " Y=" + y + " Z=" + z);

// Проверяем: сканируем МАЛЕНЬКИЙ кусок памяти вокруг тебя (1000 байт)
var scanStart = coordAddr.sub(500);
var scanSize = 1000;

console.log("Сканирую маленький кусок: " + scanStart + " - " + scanStart.add(scanSize));

Memory.scan(scanStart, scanSize, "00 00 40 41", {
    onMatch: function(address, size) {
        var z2 = address.readFloat();
        var y2 = address.sub(4).readFloat();
        var x2 = address.sub(8).readFloat();
        console.log("  [MATCH] " + address + " -> X=" + x2 + " Y=" + y2 + " Z=" + z2);
    },
    onComplete: function() {
        console.log("Маленький скан завершен.");
    }
});

// Теперь сканируем чуть больший кусок (10 КБ вокруг)
var scanStart2 = coordAddr.sub(5000);
var scanSize2 = 10000;
console.log("\nСканирую 10 КБ вокруг: " + scanStart2);

Memory.scan(scanStart2, scanSize2, "00 00 40 41", {
    onMatch: function(address, size) {
        var z2 = address.readFloat();
        var y2 = address.sub(4).readFloat();
        var x2 = address.sub(8).readFloat();
        
        if (Math.abs(z2 - 12) < 0.2 && isFinite(x2) && isFinite(y2)) {
            var dist = Math.sqrt(Math.pow(x2 - x, 2) + Math.pow(y2 - y, 2));
            console.log("  [NEARBY] " + address + " -> X=" + x2.toFixed(2) + " Y=" + y2.toFixed(2) + " Z=" + z2.toFixed(2) + " dist=" + dist.toFixed(2));
        }
    },
    onComplete: function() {
        console.log("10 КБ скан завершен.");
    }
});

setTimeout(function(){}, 5000);
