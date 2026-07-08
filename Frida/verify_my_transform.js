// Исходя из данных Cheat Engine: координаты начинаются с 0x74AA798EDB70
// Если координаты в Transform смещены на 0xF0, то Transform должен быть на 0xF0 раньше
var coordBlock = ptr("0x74AA798EDB70");
var transformBase = coordBlock.sub(0xF0);

console.log("[+] Потенциальный Transform: " + transformBase);
console.log("[+] Координаты (Cheat Engine): " + coordBlock.readFloat().toFixed(4) + ", " + coordBlock.add(4).readFloat().toFixed(4) + ", " + coordBlock.add(8).readFloat().toFixed(4));

try {
    // В структуре Transform по +0x18 обычно лежит GameObject
    var go = transformBase.add(0x18).readPointer();
    console.log("[+] GameObject, связанный с Transform: " + go);
    
    // Посмотрим, что внутри этого GameObject
    console.log("\n=== GameObject Dump (0x68-0x98) ===");
    console.log(hexdump(go.add(0x68).readByteArray(0x30), {
        offset: 0x68, length: 0x30, header: true, ansi: true
    }));
    
    // Проверим компоненты (ссылки)
    for (var off = 0x48; off < 0xA0; off += 8) {
        var comp = go.add(off).readPointer();
        if (!comp.isNull()) {
            console.log("  [+] Компонент/Ссылка @ " + go.add(off) + " -> " + comp);
        }
    }
} catch(e) {
    console.log("[-] Ошибка чтения: " + e);
}
