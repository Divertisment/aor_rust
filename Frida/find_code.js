var base = Process.findModuleByName("GameAssembly.so").base;

// Найдём все диапазоны памяти модуля с их защитой
console.log("[!] Все диапазоны памяти GameAssembly.so:\n");

// Для получения всех диапазонов перечислим их по типам
var protections = ['r--', 'r-x', 'rw-', 'rwx', '---'];
protections.forEach(function(prot) {
    var ranges = Process.enumerateRanges(prot).filter(r => 
        r.base >= base && r.base < base.add(0x7780888)
    );
    if (ranges.length > 0) {
        console.log(`\n=== Защита: ${prot} ===`);
        ranges.forEach(function(r) {
            var offset = r.base.sub(base);
            console.log(`    [${offset.toString(16)}] ${r.base} - ${r.base.add(r.size)} (0x${r.size.toString(16)})`);
        });
    }
});

// Теперь найдём все r-x секции и поищем там GetGameObjectManager
// Паттерн: mov rax, [rip+off]; ret (8 байт, заканчивается на C3)
// или: lea rax, [rip+off]; ret

console.log("\n\n[!] Поиск GetGameObjectManager по сигнатуре в r-x секциях...");

var execRanges = Process.enumerateRanges('r-x').filter(r => 
    r.base >= base && r.base < base.add(0x7780888)
);

var foundCount = 0;
execRanges.forEach(function(range) {
    try {
        // Сканируем: последний байт C3 (ret), первые 2 байта 48 8B (mov rax,...)
        var matches48 = Memory.scanSync(range.base, range.size, "48 8B 05");
        matches48.forEach(function(m) {
            var fullFunc = m.address.readByteArray(8);
            if (fullFunc) {
                var bytes = Array.from(new Uint8Array(fullFunc));
                if (bytes[7] === 0xC3) { // заканчивается на ret
                    console.log(`    ${m.address.sub(base)}: ${m.address}`);
                    console.log(hexdump(fullFunc, { offset: 0, length: 8, header: true, ansi: true }));
                    foundCount++;
                }
            }
        });
        
        // Также ищем lea rax, [rip+off]; ret
        var matches48d = Memory.scanSync(range.base, range.size, "48 8D 05");
        matches48d.forEach(function(m) {
            var fullFunc = m.address.readByteArray(8);
            if (fullFunc) {
                var bytes = Array.from(new Uint8Array(fullFunc));
                if (bytes[7] === 0xC3) {
                    console.log(`    ${m.address.sub(base)}: ${m.address}`);
                    console.log(hexdump(fullFunc, { offset: 0, length: 8, header: true, ansi: true }));
                    foundCount++;
                }
            }
        });
    } catch(e) {}
});

console.log(`\n[+] Найдено подозрительных функций: ${foundCount}`);
