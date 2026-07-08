// От известного GameObject ищем Transform
var gameObject = ptr("0x74aab7489800"); // известный GameObject (ID 546)
var knownTransform = ptr("0x74AA798EDA80"); // известный Transform

console.log(`[!] GameObject: ${gameObject}`);
console.log(`[!] Известный Transform: ${knownTransform}`);

// Сканируем 512 байт GameObject в поисках указателя на известный Transform
console.log(`\n[1] Поиск указателя на Transform внутри GameObject:`);
for (var i = 0; i < 0x200; i += 8) {
    try {
        var val = gameObject.add(i).readPointer();
        if (val.equals(knownTransform)) {
            console.log(`[+] НАЙДЕНО! Смещение +0x${i.toString(16)}: ${val}`);
        }
    } catch(e) {}
}

// Также дампим GameObject чтобы посмотреть на структуру
console.log(`\n[2] Дамп GameObject (256 байт):`);
console.log(hexdump(gameObject.readByteArray(256), {
    offset: 0, length: 256, header: true, ansi: true
}));

// Проверим что в списке объектов из GameObjectManager есть этот GameObject
var unityPlayer = Process.findModuleByName("UnityPlayer.so");
var getGOM = new NativeFunction(unityPlayer.base.add(0x9ECE20), 'pointer', []);
var gom = getGOM();
var sentinel = gom.add(24);
var current = sentinel.readPointer();

while (!current.isNull() && !current.equals(sentinel)) {
    var candidateGO = current.sub(0x68);
    if (candidateGO.equals(gameObject)) {
        console.log(`\n[3] Найден в списке GameObjectManager! Node: ${current}`);
    }
    var next = current.readPointer();
    if (next.equals(current) || next.isNull()) break;
    current = next;
}
