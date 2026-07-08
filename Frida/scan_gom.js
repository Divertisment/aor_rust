var gameAssembly = Process.findModuleByName("GameAssembly.so");
console.log(`[1] GameAssembly.so base: ${gameAssembly.base}`);
console.log(`[2] GameAssembly.so size: 0x${gameAssembly.size.toString(16)}`);
console.log(`[3] GameAssembly.so path: ${gameAssembly.path}`);

// Просканируем все страницы памяти модуля
console.log("\n[4] Секции памяти GameAssembly.so:");
var ranges = Process.enumerateRanges('rw-').filter(r => 
    r.base >= gameAssembly.base && r.base < gameAssembly.base.add(gameAssembly.size)
);
ranges.forEach(function(r) {
    console.log(`    ${r.base} - ${r.base.add(r.size)} (size: 0x${r.size.toString(16)}) protection: ${r.protection}`);
});

// Попробуем найти GetGameObjectManager через поиск паттерна
// Он просто загружает указатель из статической памяти
// В x64 это: lea rax, [rip+offset] или mov rax, [rip+offset]
// Попробуем по смещению xref

// Ищем s_Instance адрес
var sInstanceAddr = gameAssembly.base.add(0x20EAAC0);
console.log(`\n[5] s_Instance статический адрес: ${sInstanceAddr}`);

// Проверим все страницы, где может быть data/bss
console.log("\n[6] Поиск в .bss секции:");
var bssRange = ranges.filter(r => r.protection.indexOf('w') !== -1);
bssRange.forEach(function(r) {
    var val = r.base.readPointer();
    console.log(`    ${r.base}: first ptr = ${val}`);
});

// Попробуем найти по адресу s_Instance в других модулях
console.log("\n[7] Поиск ссылок на s_Instance в коде...");

// В функции GetGameObjectManager (которая просто ret s_Instance) 
// будет инструкция: lea rax, [rip+s_Instance_offset] или mov rax, [rip+s_Instance_offset]
// Поищем паттерн, который ссылается на наш адрес

var targetAddr = sInstanceAddr;
// В x64 LeA/LDR + RIP-relative: ищем 0x20EAAC0 как смещение
// lea rax, [rip+offset] или mov rax, [rip+offset]
// Ищем байты адреса (little-endian) C0 AA 0E 02 в секции .text

console.log(`\n[8] Поиск ссылок на 0x20EAAC0 в коде...`);
var textRanges = Process.enumerateRanges('r-x').filter(r => 
    r.base >= gameAssembly.base && r.base < gameAssembly.base.add(gameAssembly.size)
);

textRanges.forEach(function(range) {
    try {
        var matches = Memory.scanSync(range.base, range.size, "C0 AA 0E 02");
        matches.forEach(function(m) {
            console.log(`    [!] Найдена ссылка: ${m.address} (offset: 0x${m.address.sub(gameAssembly.base).toString(16)})`);
            console.log(hexdump(m.address.sub(4).readByteArray(12), {
                offset: 0,
                length: 12,
                header: true,
                ansi: true
            }));
        });
    } catch(e) {
        console.log(`    Ошибка сканирования: ${e.message}`);
    }
});
