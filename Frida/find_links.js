var baseAddr = ptr("0x74AA798EDA80");
console.log(`[!] Анализ соседей для: ${baseAddr}`);

// Сканируем область памяти от 0x0 до 0x200
for (var i = 0; i < 0x200; i += 8) {
    try {
        var ptrVal = baseAddr.add(i).readPointer();
        // Проверяем, похоже ли значение на валидный адрес (в диапазоне нашего модуля)
        if (ptrVal.toString().startsWith("0x74a")) {
            console.log(`    [+] Смещение +0x${i.toString(16)}: ${ptrVal}`);
        }
    } catch(e) {}
}
