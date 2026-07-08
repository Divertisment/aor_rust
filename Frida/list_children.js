var baseAddr = ptr("0x74AA798EDA80");
var listPtr = baseAddr.add(0x20).readPointer();
var childCount = baseAddr.add(0x80).readS32();

console.log(`[!] Сканирование детей для группы: ${baseAddr}`);
console.log(`[+] Количество детей: ${childCount}`);
console.log(`[+] Адрес списка: ${listPtr}`);

for (var i = 0; i < childCount; i++) {
    // Читаем по 16 байт (0x10) как показал дамп
    var childTransform = listPtr.add(i * 0x10).readPointer();
    
    if (!childTransform.isNull()) {
        var childGO = childTransform.add(0x18).readPointer();
        var childID = !childGO.isNull() ? childGO.add(0x10).readS32() : "Null";
        console.log(`    [${i}] Transform: ${childTransform} | GO: ${childGO} | ID: ${childID}`);
    } else {
        console.log(`    [${i}] Transform: NULL`);
    }
}
