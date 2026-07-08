var moduleBase = Process.findModuleByName("GameAssembly.so").base;
var instanceAddr = moduleBase.add(0x20EAAC0); 
var instance = instanceAddr.readPointer();

console.log(`[!] GameObjectManager Instance (Static): ${instanceAddr}`);
console.log(`[!] GameObjectManager Instance (Value): ${instance}`);

if (!instance.isNull()) {
    console.log("[+] Дамп структуры GameObjectManager (первые 256 байт):");
    console.log(hexdump(instance.readByteArray(256), {
        offset: 0,
        length: 256,
        header: true,
        ansi: true
    }));
} else {
    console.log("[-] Инстанс GameObjectManager равен NULL");
}
