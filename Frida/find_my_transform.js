// Поиск твоего Transform по примерным координатам X, Y (около 180, 61)
var start = ptr("0x74aa00000000");
var end = ptr("0x74ab00000000");
var size = end.sub(start).toInt32();

console.log("[+] Сканируем память в поисках твоего Transform (X~180, Y~61)...");

Memory.scan(start, size, "?? ?? 34 43 ?? ?? 77 42", {
    onMatch: function(address, size) {
        // address - это X-координата (если это Transform+0xF0)
        try {
            var x = address.readFloat();
            var y = address.add(4).readFloat();
            var z = address.add(8).readFloat();
            
            if (Math.abs(x - 180.32) < 5.0 && Math.abs(y - 61.90) < 5.0) {
                console.log("\n[!!!] Твой Transform найден!");
                console.log("  Адрес: " + address.sub(0xF0));
                console.log("  Pos: X=" + x.toFixed(2) + " Y=" + y.toFixed(2) + " Z=" + z.toFixed(4));
            }
        } catch(e) {}
    },
    onComplete: function() {
        console.log("\n[+] Сканирование завершено.");
    }
});
