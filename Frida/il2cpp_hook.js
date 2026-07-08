const TARGET_ADDRESS = ptr("0x7ccb0210f540");

console.log("[*] Скрипт запущен. Анализируем адрес: " + TARGET_ADDRESS);

function deepDumpStrings(baseAddr, size = 0x500) {
    console.log("\n[+] --- ГЛУБОКОЕ СКАНИРОВАНИЕ СТРОК ---");
    try {
        for (let offset = 0; offset < size; offset += 8) {
            try {
                const val = baseAddr.add(offset).readPointer();
                if (val.isNull()) continue;

                let str = null;
                try { str = val.readUtf8String(); } catch(e) {}

                if (!str || str.length < 2) {
                    try { str = val.add(0x14).readUtf16String(); } catch(e) {}
                }

                if (str && str.length > 2 && /^[a-zA-Z0-9_.]+$/.test(str)) {
                    console.log(`[+0x${offset.toString(16).toUpperCase()}] Найдена строка: "${str}"`);
                }
            } catch(e) {}
        }
    } catch(err) {
        console.log("[-] Ошибка чтения региона памяти.");
    }
    console.log("[+] --- КОНЕЦ ДАМПА СТРОК ---\n");
}

deepDumpStrings(TARGET_ADDRESS);

if (Il2Cpp.available) {
    Il2Cpp.perform(() => {
        console.log("[*] IL2CPP среда обнаружена. Ставим перехватчики...");

        const assemblies = Il2Cpp.Domain.assemblies;
        let targetMethod = null;

        for (const assembly of assemblies) {
            const image = assembly.image;
            const classes = image.classes;
            for (const klass of classes) {
                if (klass.name.includes("Movement") || klass.name.includes("Transform")) {
                    const methods = klass.methods;
                    for (const m of methods) {
                        if (m.name === "DoProcess" || m.name === "SetCharacterMovementSpeed") {
                            console.log(`[+] Найдена функция для хука: ${klass.fullName}::${m.name}`);
                            
                            m.implementation = function (...args) {
                                const instancePtr = ptr(args[0]);
                                
                                if (instancePtr.toString() === TARGET_ADDRESS.toString()) {
                                    console.log(`\n[!] ХУК: Вызвана функция ${m.name} для нашего адреса!`);
                                    deepDumpStrings(instancePtr);
                                }
                                
                                return this.super(...args);
                            };
                        }
                    }
                }
            }
        }
    });
} else {
    console.log("[-] IL2CPP API недоступно.");
}
