const HORSE_MOVEMENT_BASE = ptr("0x7CCB0210F540");
const SCAN_SIZE = 0x2000; 

console.log("[*] Скрипт запущен. Анализируем адрес лошади: " + HORSE_MOVEMENT_BASE);

function dumpStringsFromComponent(baseAddr, size) {
    console.log("\n[+] --- СКАНИРОВАНИЕ СТРОК В КОМПОНЕНТЕ ЛОШАДИ ---");
    
    try {
        const memoryBuffer = baseAddr.readByteArray(size);
        const dataView = new DataView(memoryBuffer);

        for (let offset = 0; offset < size; offset += 8) {
            try {
                const potentialPtr = baseAddr.add(offset).readPointer();
                
                if (!potentialPtr.isNull()) {
                    let resolvedString = null;
                    
                    try {
                        resolvedString = potentialPtr.readUtf8String();
                    } catch (e) {
                        try {
                            resolvedString = potentialPtr.add(0x14).readUtf16String();
                        } catch (e2) {}
                    }

                    if (resolvedString && resolvedString.length > 2 && /^[a-zA-Z0-9_]+$/.test(resolvedString)) {
                        console.log(`[Смещение +0x${offset.toString(16).toUpperCase()}] -> Найдена строка: "${resolvedString}" (Адрес ссылки: ${potentialPtr})`);
                    }
                }
            } catch (err) {}
        }
    } catch (globalErr) {
        console.log("[-] Не удалось прочитать память по этому адресу.");
    }
    console.log("[+] --- КОНЕЦ ДАМПА СТРОК ---\n");
}

dumpStringsFromComponent(HORSE_MOVEMENT_BASE, SCAN_SIZE);

try {
    MemoryAccessMonitor.attach({
        address: HORSE_MOVEMENT_BASE,
        size: 0x100
    }, {
        onAccess: function (details) {
            console.log(`\n[!] ТРИГГЕР: Игра обратилась к памяти компонента лошади!`);
            console.log(`    Тип операции: ${details.operation}`);
            console.log(`    Адрес инструкции в коде: ${details.from}`);
            console.log(`    Конкретный адрес памяти: ${details.address}`);
            dumpStringsFromComponent(HORSE_MOVEMENT_BASE, SCAN_SIZE);
        }
    });
    console.log("[*] MemoryAccessMonitor установлен.");
} catch (e) {
    console.log("[-] Ошибка монитора: " + e.message);
}
