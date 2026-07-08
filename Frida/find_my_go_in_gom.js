// Ищем наш известный GameObject в списке GameObjectManager
var knownGO = ptr("0x74aab7489800");
var unityBase = Module.findBaseAddress("UnityPlayer.so");
var gomAddr = new NativeFunction(unityBase.add(0x9ECE20), 'pointer', [])();

console.log(`[+] GameObjectManager @ ${gomAddr}`);
console.log(`[+] Ищем объект: ${knownGO}`);

var sentinel = gomAddr.add(0x18);
var current = sentinel.readPointer();

// Сначала прочитаем смещение: сколько байт до m_GameObject внутри ноды
// В разных версиях Unity может быть: нода = m_Next(8) + m_Prev(8) + m_GameObject(8) или по-другому
// Попробуем определить: у текущей ноды, где в ней лежит адрес нашего knownGO?

console.log("\n[!] Определяем смещение на GameObject внутри ноды...");
var node = current;
var found = false;

for (var attempt = 0; attempt < 2; attempt++) {
    node = current;
    var nodeCount = 0;
    var lastNode = null;
    
    console.log(`\n[!] Проход ${attempt+1}: прямой обход списка`);
    console.log("    Ищем наш GameObject...");
    
    while (!node.equals(sentinel)) {
        var goPtr = null;
        // Пробуем разные смещения
        var candidates = [0x00, 0x08, 0x10, 0x18, 0x20];
        for (var ci = 0; ci < candidates.length; ci++) {
            try {
                var p = node.add(candidates[ci]).readPointer();
                if (!p.isNull() && p.equals(knownGO)) {
                    console.log(`    [***] НАЙДЕНО! Смещение gameObject внутри ноды: +0x${candidates[ci].toString(16)}`);
                    console.log(`    Node адрес: ${node}`);
                    goPtr = p;
                    found = true;
                    break;
                }
            } catch(e) {}
        }
        
        if (goPtr && goPtr.equals(knownGO)) break;
        
        // Не нашли - идем к следующей ноде через +0x00 (next pointer)
        node = node.readPointer();
        nodeCount++;
        if (nodeCount > 200) { console.log("    Превышен лимит"); break; }
        if (node.isNull()) { console.log("    Null node!"); break; }
    }
    
    if (found) break;
    
    // Если не нашли, попробуем другую версию layout:
    // Может, сама нода это и есть GameObject, и в ней уже +0x00 = next ноды?
    console.log("    Не нашли через стандартный layout, пробуем прямой обход...");
}

if (!found) {
    console.log("\n[!] Не нашли через обход. Проверяем структуру вручную...");
    console.log("    Смотрим что лежит по смещениям у первой ноды:");
    node = current;
    console.log(hexdump(node.readByteArray(64), {
        offset: 0, length: 64, header: true, ansi: true
    }));
}
