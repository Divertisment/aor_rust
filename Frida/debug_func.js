var base = Process.findModuleByName("GameAssembly.so").base;
var funcAddr = base.add(0x9ECE20);

console.log(`[!] GetGameObjectManager адрес: ${funcAddr}`);

// Проверяем защиту страницы
var range = Process.findRangeByAddress(funcAddr);
if (range) {
    console.log(`[+] Страница: ${range.base} - ${range.base.add(range.size)}`);
    console.log(`[+] Защита: ${range.protection}`);
    console.log(`[+] Размер: 0x${range.size.toString(16)}`);
} else {
    console.log("[-] Страница не найдена (адрес вне отображённой памяти)");
}

// Пробуем читать сырые байты
try {
    var bytes = funcAddr.readByteArray(16);
    console.log(`[+] Содержимое функции (16 байт):`);
    console.log(hexdump(bytes, { offset: 0, length: 16, header: true, ansi: true }));
} catch(e) {
    console.log(`[-] Не удалось прочитать: ${e.message}`);
}

// Пробуем методом Module.findExportByName
try {
    var sym = Module.findExportByName("GameAssembly.so", "GetGameObjectManager");
    if (sym) {
        console.log(`[+] Экспорт GetGameObjectManager: ${sym}`);
        var bytes2 = sym.readByteArray(8);
        console.log(hexdump(bytes2, { offset: 0, length: 8, header: true, ansi: true }));
    } else {
        console.log("[-] Экспорт не найден");
    }
} catch(e) {
    console.log(`[-] Ошибка: ${e.message}`);
}

// Еще - попробуем найти символ с другим именем
try {
    var symbols = Module.enumerateSymbols("GameAssembly.so");
    var found = symbols.filter(s => s.name.includes("GetGameObject") || s.name.includes("GameObjectManager"));
    if (found.length > 0) {
        console.log(`[+] Найдено ${found.length} символов:`);
        found.forEach(s => console.log(`    ${s.name}: ${s.address}`));
    } else {
        console.log("[-] Символы не найдены через Module.enumerateSymbols (IL2CPP stripped)");
    }
} catch(e) {
    console.log(`[-] Ошибка enumerateSymbols: ${e.message}`);
}
