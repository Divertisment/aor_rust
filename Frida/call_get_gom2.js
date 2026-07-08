var base = Process.findModuleByName("GameAssembly.so").base;
var getGOM = base.add(0x9ECE20);

console.log(`[!] GetGameObjectManager функция: ${getGOM}`);

// Создаем NativeFunction
var GetGameObjectManager = new NativeFunction(getGOM, 'pointer', []);

// Вызываем
var gomInstance = GetGameObjectManager();
console.log(`[+] GameObjectManager instance: ${gomInstance}`);

if (!gomInstance.isNull()) {
    console.log(`[+] Дамп памяти GameObjectManager (256 байт):`);
    console.log(hexdump(gomInstance.readByteArray(256), {
        offset: 0,
        length: 256,
        header: true,
        ansi: true
    }));
    
    // Проверяем s_Instance + 24 (linked list head от UpdateActiveGONode)
    var listSentinel = gomInstance.add(24);
    console.log(`\n[+] s_Instance + 24 (linked list): ${listSentinel}`);
    console.log(hexdump(listSentinel.readByteArray(32), {
        offset: 0,
        length: 32,
        header: true,
        ansi: true
    }));
} else {
    console.log("[-] GameObjectManager instance is NULL!");
}
