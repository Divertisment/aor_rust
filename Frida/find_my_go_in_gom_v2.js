var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var gameAssembly = Process.getModuleByName("GameAssembly.so");

// Функция GetGameObjectManager
// 48 8b 05 99 dc 6f 01  = mov rax, [rip + 0x016FDC99]
//                      c3 = ret
var funcAddr = unityPlayer.base.add(0x9ECE20);
var instructionLen = 7; // 48 8b 05 + 4 байта disp
var rip = funcAddr.add(instructionLen);
var disp = funcAddr.add(3).readS32();  // disp starts at offset 3
var globalAddr = rip.add(disp);

console.log(`[+] GetGameObjectManager @ ${funcAddr}`);
console.log(`[+] RIP (after instruction) = ${rip}`);
console.log(`[+] Displacement = 0x${disp.toString(16)} (${disp})`);
console.log(`[+] Global var @ ${globalAddr}`);

// Читаем глобальную переменную
var gomInstance = globalAddr.readPointer();
console.log(`[+] GameObjectManager instance = ${gomInstance}`);

if (!gomInstance.isNull()) {
    var sentinel = gomInstance.add(0x18);
    var first = sentinel.readPointer();
    console.log(`[+] Sentinel node @ ${sentinel}`);
    console.log(`[+] First node @ ${first}`);
    
    // Ищем наш известный GameObject
    var knownGO = ptr("0x74aab7489800");
    console.log(`[+] Ищем GameObject: ${knownGO}`);
    
    var current = first;
    var count = 0;
    var found = false;
    
    while (!current.equals(sentinel) && count < 200) {
        // Пробуем разные смещения для gameObject внутри ноды
        // В Unity, нода выглядит как:
        // +0x00: next
        // +0x08: prev  
        // +0x10: gameObject*
        // Или:
        // +0x00: gameObject*
        // +0x08: next
        // +0x10: prev
        
        var patterns = [
            { nextOff: 0x00, prevOff: 0x08, goOff: 0x10 },
            { nextOff: 0x08, prevOff: 0x10, goOff: 0x00 },
            { nextOff: 0x00, prevOff: 0x08, goOff: 0x18 },
            { nextOff: 0x00, prevOff: 0x08, goOff: 0x20 },
        ];
        
        for (var pi = 0; pi < patterns.length && !found; pi++) {
            try {
                var goAtNode = current.add(patterns[pi].goOff).readPointer();
                if (!goAtNode.isNull() && goAtNode.equals(knownGO)) {
                    console.log(`\n[***] НАЙДЕН В НОДЕ #${count}`);
                    console.log(`[***] Node @ ${current}`);
                    console.log(`[***] Смещение gameObject в ноде: +0x${patterns[pi].goOff.toString(16)}`);
                    console.log(`[***] Смещение next: +0x${patterns[pi].nextOff.toString(16)}`);
                    console.log(`[***] Смещение prev: +0x${patterns[pi].prevOff.toString(16)}`);
                    
                    // Дамп ноды
                    console.log(hexdump(current.readByteArray(48), {
                        offset: 0, length: 48, header: true, ansi: true
                    }));
                    
                    found = true;
                    break;
                }
            } catch(e) {}
        }
        
        if (found) break;
        
        // Идём к следующей ноде
        // По умолчанию +0x00 - next
        var next = current.readPointer();
        if (next.isNull() || next.equals(current)) break;
        
        current = next;
        count++;
    }
    
    if (!found) {
        console.log(`\n[!] Обход завершён. Всего нод: ${count}. Не нашли.`);
        console.log("[!] Дамп первой ноды для анализа:");
        console.log(hexdump(first.readByteArray(48), {
            offset: 0, length: 48, header: true, ansi: true
        }));
        
        // Также выведем адреса 5 первых нод и gameObject на +0x10
        current = first;
        for (var i = 0; i < Math.min(5, count); i++) {
            if (current.equals(sentinel)) break;
            try {
                var go = current.add(0x10).readPointer();
                var next2 = current.readPointer();
                var prev2 = current.add(0x08).readPointer();
                console.log(`  [${i}] Node=${current} next=${next2} prev=${prev2} go@+0x10=${go}`);
            } catch(e) {
                console.log(`  [${i}] Node=${current} ERROR: ${e}`);
            }
            current = current.readPointer();
        }
    }
}

setTimeout(function(){}, 2000);
