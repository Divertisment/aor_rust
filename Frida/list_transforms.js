var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var globalAddr = rip.add(disp);
var gom = globalAddr.readPointer();
var sentinel = gom.add(0x18);

var node = sentinel.readPointer();
var count = 0;

console.log("[+] Сканируем объекты (ищем Transform-компоненты)...");

while (!node.equals(sentinel) && count < 300) {
    var goAddr = node.sub(0x68);
    
    // Проверяем компоненты (ищем Transform, у которого координаты в +0xF0)
    var compOffsets = [0x48, 0x50, 0x58, 0x60, 0x78, 0x80, 0x88, 0x90, 0xA0, 0xA8];
    
    for (var ci = 0; ci < compOffsets.length; ci++) {
        try {
            var compAddr = goAddr.add(compOffsets[ci]).readPointer();
            if (compAddr.isNull()) continue;
            
            // Читаем координаты
            var x = compAddr.add(0xF0).readFloat();
            var y = compAddr.add(0xF4).readFloat();
            var z = compAddr.add(0xF8).readFloat();
            
            // Если координаты выглядят валидно (Z близко к 12, или X/Y вменяемые)
            if (isFinite(x) && isFinite(y) && isFinite(z) && Math.abs(z) > 0.1) {
                console.log("GO: " + goAddr + " | Transform: " + compAddr + " | Pos: " + x.toFixed(2) + ", " + y.toFixed(2) + ", " + z.toFixed(2));
            }
        } catch(e) {}
    }
    
    node = node.readPointer();
    count++;
}
console.log("[+] Сканирование завершено.");
