var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var globalAddr = rip.add(disp);
var gom = globalAddr.readPointer();
var sentinel = gom.add(0x18);

var node = sentinel.readPointer();
var count = 0;

console.log("[+] Сканируем компоненты 100 GameObject-ов на Z=12.0...");

while (!node.equals(sentinel) && count < 100) {
    var goAddr = node.sub(0x68);
    var compOffsets = [0x48, 0x50, 0x58, 0x60, 0x78, 0x80, 0x88, 0x90, 0xA0, 0xA8];
    
    for (var ci = 0; ci < compOffsets.length; ci++) {
        try {
            var compAddr = goAddr.add(compOffsets[ci]).readPointer();
            if (compAddr.isNull() || compAddr.equals(ptr("0"))) continue;
            
            // Сканируем 512 байт самого компонента
            for (var off = 0; off < 512; off += 4) {
                var val = compAddr.add(off).readFloat();
                if (val > 11.9 && val < 12.1) {
                    console.log("\n[FOUND] GO: " + goAddr + " | Comp: " + compAddr + " | Off: +0x" + off.toString(16) + " | Val: " + val.toFixed(4));
                }
            }
        } catch(e) {}
    }
    node = node.readPointer();
    count++;
}
console.log("[+] Сканирование завершено.");
