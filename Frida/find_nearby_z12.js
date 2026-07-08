var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var globalAddr = rip.add(disp);
var gom = globalAddr.readPointer();
var sentinel = gom.add(0x18);

console.log("[+] Поиск объектов с Z ≈ 12.0...");

var node = sentinel.readPointer();
var count = 0;
var found = [];

while (!node.equals(sentinel) && count < 1000) {
    var goAddr = node.sub(0x68);
    
    // Проверяем компоненты на наличие обратной ссылки (Component+0x18 == goAddr)
    // и наличие координат (Transform)
    var compOffsets = [0x48, 0x50, 0x58, 0x60, 0x78, 0x80, 0x88, 0x90, 0xA0, 0xA8];
    
    for (var ci = 0; ci < compOffsets.length; ci++) {
        try {
            var compAddr = goAddr.add(compOffsets[ci]).readPointer();
            if (compAddr.isNull()) continue;
            
            // Проверка back-pointer (Component+0x18 == GameObject)
            var bp = compAddr.add(0x18).readPointer();
            if (bp.equals(goAddr)) {
                // Читаем координаты
                var x = compAddr.add(0xF0).readFloat();
                var y = compAddr.add(0xF4).readFloat();
                var z = compAddr.add(0xF8).readFloat();
                
                if (Math.abs(z - 12.0) < 0.5) {
                    found.push({
                        go: goAddr,
                        comp: compAddr,
                        x: x,
                        y: y,
                        z: z
                    });
                }
            }
        } catch(e) {}
    }
    
    node = node.readPointer();
    count++;
}

console.log("[+] Найдено объектов с Z≈12: " + found.length);
found.forEach(function(item, index) {
    console.log("  [" + index + "] GO: " + item.go + " | Pos: X=" + item.x.toFixed(2) + " Y=" + item.y.toFixed(2) + " Z=" + item.z.toFixed(2));
});
