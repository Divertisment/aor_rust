var myNodeBytes = [0x68, 0xb7, 0x48, 0xaa, 0x74, 0x00, 0x00, 0x00];
var myNode = ptr("0x74aab7489868");

console.log("Ищу указатель на мою ноду " + myNode + " во всей памяти...");

var ranges = Process.enumerateRanges('r--');
console.log("Найдено диапазонов: " + ranges.length);

var found = [];

ranges.forEach(function(range) {
    if (range.size > 0x10000000) return; // Пропускаем гигантские диапазоны
    
    try {
        Memory.scan(range.base, range.size, "68 b7 48 aa 74 00 00 00", {
            onMatch: function(address, size) {
                console.log("[FOUND] Указатель на ноду: " + address + " в диапазоне " + range.base + "-" + range.base.add(range.size));
                found.push(address);
            },
            onComplete: function() {}
        });
    } catch(e) {}
});

setTimeout(function() {
    console.log("\nИтого найдено: " + found.length);
    found.forEach(function(addr) {
        console.log("  " + addr);
    });
}, 30000);
