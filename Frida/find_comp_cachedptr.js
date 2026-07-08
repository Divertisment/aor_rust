var gameObject = ptr("0x74aab7489800");
var nativeTransform = ptr("0x74AA798EDA80");

console.log(`[!] GameObject: ${gameObject}`);
console.log(`[!] Нативный Transform: ${nativeTransform}`);

// Проверяем все 6 компонентов на наличие cachedPtr = nativeTransform
for (var ci = 0; ci < 6; ci++) {
    var compPtr = gameObject.add(0x68 + ci * 8).readPointer();
    if (compPtr.isNull()) continue;
    
    console.log(`\n[${ci}] Менеджер компонент @ ${compPtr}`);
    console.log(hexdump(compPtr.readByteArray(64), {
        offset: 0, length: 64, header: true, ansi: true
    }));
    
    // Ищем cachedPtr (адрес нативного объекта) в первых 64 байтах
    for (var off = 0; off < 56; off += 8) {
        try {
            var val = compPtr.add(off).readPointer();
            if (val.equals(nativeTransform)) {
                console.log(`    [***] CACHEDPTR НАЙДЕН! Смещение +0x${off.toString(16)}`);
            }
        } catch(e) {}
    }
    
    // Также читаем как int (instance ID)
    try {
        var instanceID = compPtr.add(0x10).readS32();
        console.log(`    InstanceID (raw +0x10): ${instanceID}`);
    } catch(e) {}
}
