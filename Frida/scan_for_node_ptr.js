var myNode = ptr("0x74aab7489868");

console.log("Ищу точный указатель на мою ноду " + myNode + " во всей памяти...");

var ranges = Process.enumerateRanges('r--');
console.log("Найдено диапазонов для сканирования: " + ranges.length);

var found = [];

ranges.forEach(function(range) {
    if (range.size > 0x20000000) return; 

    try {
        Memory.scan(range.base, range.size, "68 98 48 b7 aa 74 00 00", {
            onMatch: function(address, size) {
                console.log("[FOUND] Указатель найден по адресу: " + address + " в диапазоне " + range.base + "-" + range.base.add(range.size));
                found.push(address);
            },
            onError: function(reason) {},
            onComplete: function() {}
        });
    } catch(e) {}
});

setTimeout(function() {
    console.log("\nИтого найдено совпадений: " + found.length);
    found.forEach(function(addr) {
        console.log(" -> Вхождение в памяти: " + addr);
        
        try {
            var prevPtr = addr.sub(8).readPointer();
            var nextPtr = addr.add(8).readPointer();
            console.log("    [Окрестности] Пред. указатель: " + prevPtr + " | След. указатель: " + nextPtr);
        } catch(e) {}
    });
}, 15000);
