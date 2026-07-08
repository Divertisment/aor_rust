var knownGO = ptr("0x74aab7489800");

console.log("[+] Проверяем GameObject: " + knownGO);

// 1. Проверяем, существует ли он еще
try {
    var iid = knownGO.add(0x10).readU32();
    console.log("    InstanceID: " + iid);
    
    // 2. Ищем Transform (координаты) в компонентах
    var foundPos = false;
    var compOffsets = [0x48, 0x50, 0x58, 0x60, 0x78, 0x80, 0x88, 0x90, 0xA0, 0xA8];
    for (var ci = 0; ci < compOffsets.length; ci++) {
        var compAddr = knownGO.add(compOffsets[ci]).readPointer();
        if (compAddr.isNull()) continue;
        
        var x = compAddr.add(0xF0).readFloat();
        var y = compAddr.add(0xF4).readFloat();
        var z = compAddr.add(0xF8).readFloat();
        
        if (isFinite(x) && isFinite(y) && isFinite(z)) {
            console.log("    [Comp @" + compAddr + "] Pos: " + x.toFixed(2) + ", " + y.toFixed(2) + ", " + z.toFixed(2));
            foundPos = true;
        }
    }
    if (!foundPos) console.log("    Не удалось найти координаты.");
} catch(e) {
    console.log("    GameObject не найден или недоступен.");
}

// 3. Если старый объект не тот, дампим первые 10 объектов из GOM
console.log("\n[+] Дампим позиции первых 10 объектов из GOM для идентификации:");
var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var gom = rip.add(disp).readPointer();
var sentinel = gom.add(0x18);

var node = sentinel.readPointer();
for (var i = 0; i < 10 && !node.equals(sentinel); i++) {
    var goAddr = node.sub(0x68);
    var compAddr = goAddr.add(0x78).readPointer(); // Примерное смещение компонента
    try {
        var x = compAddr.add(0xF0).readFloat();
        var y = compAddr.add(0xF4).readFloat();
        var z = compAddr.add(0xF8).readFloat();
        console.log("    [" + i + "] GO: " + goAddr + " | Pos: " + x.toFixed(2) + ", " + y.toFixed(2) + ", " + z.toFixed(2));
    } catch(e) {}
    node = node.readPointer();
}
