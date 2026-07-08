var playerX = 179.97;
var playerY = 62.47;
var playerZ = 8.00;

console.log("[ПОИСК] Сканирую Transform-объекты с Z≈8.0 и проверяю близость к игроку...");

var ranges = Process.enumerateRanges('rw-');
var count = 0;
var found = [];

ranges.forEach(function(r) {
    if (r.size > 0x03000000 || r.size < 0x10000) return;
    try {
        var base = r.base;
        for (var off = 0; off < r.size - 0x100; off += 4) {
            var addr = base.add(off);
            try {
                // Quick check: Z coordinate at +0xF8
                var z = addr.add(0xF8).readFloat();
                if (isNaN(z) || Math.abs(z - playerZ) > 0.1) continue;
                
                // Check +0xF0 (X) and +0xF4 (Y)
                var x = addr.add(0xF0).readFloat();
                var y = addr.add(0xF4).readFloat();
                if (isNaN(x) || isNaN(y)) continue;
                
                // Filter by distance
                var dx = Math.abs(x - playerX);
                var dy = Math.abs(y - playerY);
                if (dx > 3.0 || dy > 3.0) continue;
                
                // Validate: +0x18 must be a valid GO pointer
                var go = addr.add(0x18).readPointer();
                if (go.isNull() || !Process.findRangeByAddress(go)) continue;
                
                // Validate: +0x80 must be small (childCount)
                var cc = addr.add(0x80).readS32();
                if (cc < 0 || cc > 20) continue;
                
                // Get InstanceID
                var id = go.add(0x10).readS32();
                if (id <= 0 || id > 10000000) continue;
                
                found.push({addr: addr, go: go, id: id, x: x, y: y, z: z, cc: cc, dx: dx, dy: dy});
            } catch(e) {}
        }
    } catch(e) {}
});

console.log("[РЕЗУЛЬТАТ] Найдено Transform рядом: " + found.length);
found.forEach(function(f, i) {
    var tag = (f.dx < 0.01 && f.dy < 0.01) ? "ТЫ" : "ЦЕЛЬ";
    console.log("  #" + (i+1) + " [" + tag + "] TF=" + f.addr + " GO=" + f.go + " ID=" + f.id +
        " children=" + f.cc + " X=" + f.x.toFixed(2) + " Y=" + f.y.toFixed(2) + " Z=" + f.z.toFixed(2));
});
