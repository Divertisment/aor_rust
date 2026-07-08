var gameAssembly = Process.findModuleByName("GameAssembly.so");
var base = gameAssembly.base;

// Сканируем rw- секции в поисках структур, похожих на GameObjectManager
// Зная, что s_Instance + 0x18 (24) - это linked list sentinel
console.log("[!] Сканирование rw-секций в поисках GameObjectManager...\n");

var rwRanges = Process.enumerateRanges('rw-').filter(r => 
    r.base >= base && r.base < base.add(gameAssembly.size)
);

rwRanges.forEach(function(range) {
    console.log(`Секция: ${range.base} - ${range.base.add(range.size)} (0x${range.size.toString(16)} bytes)`);
    
    // Сканируем по 8 байт, ищем указатели в пределах модуля или heap
    try {
        var results = Memory.scanSync(range.base, Math.min(range.size, 0x100000), "00 00 00 00 00 00 00 00");
        // Just check the first and last few hundred bytes
        var bytes = range.base.readByteArray(Math.min(range.size, 256));
        console.log(hexdump(bytes, {
            offset: 0,
            length: Math.min(range.size, 256),
            header: true,
            ansi: true
        }));
    } catch(e) {
        console.log(`  Ошибка: ${e.message}`);
    }
    console.log("");
});

// Теперь попробуем найти GetGameObjectManager через поиск функции
// Она проста: просто возвращает значение статической переменной
// "lea rax, [rip+offset]" или "mov rax, cs:s_Instance"
// Поищем все LEA/LDR в r-x секциях, которые ссылаются на адреса в data/bss

console.log("\n[!] Поиск GetGameObjectManager через системные вызовы...");

// Попробуем найти символ GetGameObjectManager
try {
    var getGOM = Module.findExportByName("GameAssembly.so", "GetGameObjectManager");
    if (getGOM) {
        console.log(`[+] GetGameObjectManager найден по экспорту: ${getGOM}`);
        var gom = new NativeFunction(getGOM, 'pointer', []);
        var result = gom();
        console.log(`[+] Результат вызова: ${result}`);
        console.log(hexdump(result.readByteArray(128), { offset: 0, length: 128, header: true, ansi: true }));
    } else {
        console.log("[-] Экспорт не найден. Пробуем паттерн...");
    }
} catch(e) {
    console.log(`[-] Ошибка: ${e.message}`);
}
