// Наш известный GameObject
var knownGO = ptr("0x74aab7489800");
console.log(`[+] Известный GameObject: ${knownGO}`);

// Нода GOM встроена в GameObject по смещению +0x68
var nodeAddr = knownGO.add(0x68);
console.log(`[+] Её GOM-нода @ ${nodeAddr}`);

// Читаем next/prev из ноды
var nextNode = nodeAddr.readPointer();
var prevNode = nodeAddr.add(0x8).readPointer();
console.log(`[+] next = ${nextNode}`);
console.log(`[+] prev = ${prevNode}`);

// Дамп ноды
console.log(hexdump(nodeAddr.readByteArray(32), {
    offset: 0, length: 32, header: true, ansi: true
}));

// Проверяем: если prev/next указывают на sentinel, то объект в списке
// Сначала получим GameObjectManager
var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var globalAddr = rip.add(disp);
var gom = globalAddr.readPointer();
var sentinel = gom.add(0x18);

console.log(`\n[+] GameObjectManager @ ${gom}`);
console.log(`[+] Sentinel @ ${sentinel}`);
console.log(`[+] nextNode == sentinel? ${nextNode.equals(sentinel)}`);
console.log(`[+] prevNode == sentinel? ${prevNode.equals(sentinel)}`);

// Проверим, есть ли наша нода в обходе от sentinel
console.log(`\n[!] Проходим список от sentinel...`);
var current = sentinel.readPointer();
var count = 0;
var found = false;

while (!current.equals(sentinel) && count < 500) {
    if (current.equals(nodeAddr)) {
        console.log(`[***] НАЙДЕНО! Нода @ ${current} на позиции ${count}`);
        found = true;
        break;
    }
    current = current.readPointer();
    count++;
    if (current.isNull()) { console.log("[!] NULL в списке"); break; }
}

if (!found) {
    console.log(`[!] Не нашли ноду после ${count} итераций. Объекта нет в этом списке.`);
    console.log(`[!] Возможно, объект лежит в другом bucket/cписке.`);
    
    // Проверим другие смещения внутри GOM
    // GOM может содержать несколько списков (active, inactive, tagged...)
    for (var off = 0; off < 0x60; off += 8) {
        try {
            var possibleSentinel = gom.add(off);
            var firstNode = possibleSentinel.readPointer();
            if (!firstNode.isNull() && !firstNode.equals(possibleSentinel)) {
                // Проверяем, может ли это быть sentinel (читаем prev = self)
                var prevOfFirst = firstNode.add(0x8).readPointer();
                if (prevOfFirst.equals(possibleSentinel)) {
                    console.log(`  Возможный sentinel @ GOM+0x${off.toString(16)} = ${possibleSentinel}`);
                }
            }
        } catch(e) {}
    }
}

setTimeout(function(){}, 2000);
