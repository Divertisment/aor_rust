var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var globalAddr = rip.add(disp);
var gom = globalAddr.readPointer();
var sentinel = gom.add(0x18);

var node = sentinel.readPointer();
var count = 0;

console.log("[+] Сканируем первые 100 GameObject на наличие float значений 11.9-12.1...");

while (!node.equals(sentinel) && count < 100) {
    var goAddr = node.sub(0x68);
    
    // Сканируем 256 байт GameObject
    for (var off = 0; off < 256; off += 4) {
        try {
            var val = goAddr.add(off).readFloat();
            if (val > 11.9 && val < 12.1) {
                console.log("[FOUND] GO: " + goAddr + " | Off: +0x" + off.toString(16) + " | Val: " + val.toFixed(4));
            }
        } catch(e) {}
    }
    
    node = node.readPointer();
    count++;
}
console.log("[+] Сканирование завершено.");
