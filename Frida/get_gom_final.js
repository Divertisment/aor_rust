// Адреса из UnityPlayer.so
var unityPlayer = Process.findModuleByName("UnityPlayer.so");
var ga = Process.findModuleByName("GameAssembly.so");

// GetGameObjectManager() в UnityPlayer.so
var getGOM = new NativeFunction(unityPlayer.base.add(0x9ECE20), 'pointer', []);
// GetTaggedNodes(GameObjectManager*, int) 
var getTaggedNodes = new NativeFunction(unityPlayer.base.add(0x849F40), 'pointer', ['pointer', 'int']);

console.log("[1] Вызов GetGameObjectManager()...");
var gom = getGOM();
console.log(`[+] GameObjectManager instance: ${gom}`);

if (!gom.isNull()) {
    console.log(`\n[2] Дамп GameObjectManager (128 байт):`);
    console.log(hexdump(gom.readByteArray(128), {
        offset: 0, length: 128, header: true, ansi: true
    }));
    
    // Проверяем sentinel листа по смещению +24 (как в UpdateActiveGONode)
    var sentinelAddr = gom.add(24);
    var sentinelNext = sentinelAddr.readPointer();
    var sentinelPrev = sentinelAddr.add(8).readPointer();
    console.log(`\n[3] Sentinel (GOM+24): ${sentinelAddr}`);
    console.log(`    Sentinel->next: ${sentinelNext}`);
    console.log(`    Sentinel->prev: ${sentinelPrev}`);
    
    // Пробуем GetTaggedNodes с тегом 1 (Player)
    console.log(`\n[4] Вызов GetTaggedNodes(GOM, тег=1)...`);
    try {
        var tag1List = getTaggedNodes(gom, 1);
        console.log(`    Результат: ${tag1List}`);
        if (!tag1List.isNull()) {
            console.log(hexdump(tag1List.readByteArray(64), {
                offset: 0, length: 64, header: true, ansi: true
            }));
        }
    } catch(e) {
        console.log(`    Ошибка: ${e.message}`);
    }
} else {
    console.log("[-] GameObjectManager is NULL!");
}
