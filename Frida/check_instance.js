var moduleBase = Process.findModuleByName("GameAssembly.so").base;
var staticFieldAddr = moduleBase.add(0x20EAAC0);

console.log(`[!] Адрес статического поля s_Instance: ${staticFieldAddr}`);

// Читаем сырые байты
var rawBytes = staticFieldAddr.readByteArray(16);
console.log("[+] Сырые байты по адресу s_Instance:");
console.log(hexdump(rawBytes, { offset: 0, length: 16, header: true, ansi: true }));

// Пробуем разные способы чтения
var asPtr = staticFieldAddr.readPointer();
console.log(`[+] Чтение как указатель (8 байт): ${asPtr}`);

var asU64 = staticFieldAddr.readU64();
console.log(`[+] Чтение как U64: 0x${asU64.toString(16)}`);

var asS32 = staticFieldAddr.readS32();
console.log(`[+] Чтение как S32 (4 байта): ${asS32} / 0x${asS32.toString(16)}`);
