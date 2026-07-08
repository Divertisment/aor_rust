// Сканируем память на предмет соответствия координатам (180.32, 61.90)
// Предполагаем, что Transform лежит в диапазоне 0x74aa...
var start = ptr("0x74aa00000000");
var end = ptr("0x74ab00000000");

console.log("Сканируем память для поиска Transform...");

var found = [];
Memory.scan(start, end.sub(start), "?? ?? ?? 43 ?? ?? 77 42", {
    onMatch: function(address, size) {
        // Проверяем, похоже ли это на Transform (X, Y в +0xF0)
        // Если это X, Y, то X=180.32, Y=61.90. Значит адрес - это X-coord.
        // Transform должен быть на 0xF0 раньше.
        var transformAddr = address.sub(0xF0);
        try {
            var x = transformAddr.add(0xF0).readFloat();
            var y = transformAddr.add(0xF4).readFloat();
            
            if (Math.abs(x - 180.32) < 5.0 && Math.abs(y - 61.90) < 5.0) {
                console.log("[FOUND] Возможный Transform: " + transformAddr + " | Pos: " + x.toFixed(2) + ", " + y.toFixed(2));
                found.push(transformAddr);
            }
        } catch(e) {}
    },
    onComplete: function() {
        console.log("Сканирование завершено.");
    }
});
