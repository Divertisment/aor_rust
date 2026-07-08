console.log("[!] Сканирую память в поисках новых координат: X=172.11, Y=85.27...");

// float 172.11 -> 0x432c1c29
// float 85.27 -> 0x42aa147b
// Ищем последовательность: 29 1c 2c 43 7b 14 aa 42
var pattern = "29 1c 2c 43 7b 14 aa 42";

var ranges = Process.enumerateRanges('rw-');
var found = false;

ranges.forEach(function(range) {
    if (range.size > 0x05000000) return; // Пропускаем огромные регионы

    Memory.scan(range.base, range.size, pattern, {
        onMatch: function(address, size) {
            console.log("[+] НАЙДЕНО! Адрес координат: " + address);
            // Попробуем вычислить адрес Transform (предположим, адрес координат - 0xF0)
            console.log("[+] Предполагаемый адрес Transform: " + address.sub(0xF0));
            found = true;
        },
        onError: function(reason) {},
        onComplete: function() {}
    });
});

setTimeout(function() {
    if (!found) console.log("[-] Координаты не найдены в доступной памяти.");
}, 5000);
