var baseAddr = ptr("0x74AA798EDA80"); // Ваш базовый Transform

// 1. Получаем указатель на GameObject (смещение 0x18 в Transform)
var gameObjectPtr = baseAddr.add(0x18).readPointer();
console.log(`[!] GameObject: ${gameObjectPtr}`);

if (!gameObjectPtr.isNull()) {
    // 2. Читаем координаты (смещение 0x38 в GameObject)
    var x = gameObjectPtr.add(0x38).readFloat();
    var y = gameObjectPtr.add(0x38 + 0x4).readFloat();
    var z = gameObjectPtr.add(0x38 + 0x8).readFloat();
    
    console.log(`[+] Координаты (GameObject + 0x38): X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Z=${z.toFixed(2)}`);
} else {
    console.log("[-] GameObject равен NULL");
}
