var myX = 172.368576;
var myY = 84.74668884;
var myZ = 12.0;

var baseAddr = ptr("0x74aa00000000");
var totalSize = 0x10000000; // 256 MB
var chunkSize = 0x100000;   // 1 МБ за раз
var results = [];

console.log("Сканирую всю память чанками по 1 МБ...");

var chunk = 0;
function scanNext() {
    if (chunk * chunkSize >= totalSize) {
        console.log("\n=== ГОТОВО ===");
        console.log("Найдено объектов с Z=12 рядом: " + results.length);
        results.forEach(function(r, i) {
            console.log("  [" + i + "] X=" + r.x.toFixed(2) + " Y=" + r.y.toFixed(2) + " Z=" + r.z.toFixed(2) + " dist=" + r.dist.toFixed(2) + " addr=" + r.addr);
        });
        return;
    }
    
    var start = baseAddr.add(chunk * chunkSize);
    
    Memory.scan(start, chunkSize, "00 00 40 41", {
        onMatch: function(address, size) {
            try {
                var z = address.readFloat();
                var y = address.sub(4).readFloat();
                var x = address.sub(8).readFloat();
                
                if (Math.abs(z - 12) < 0.5 && isFinite(x) && isFinite(y) && Math.abs(x) < 10000 && Math.abs(y) < 10000) {
                    var dist = Math.sqrt(Math.pow(x - myX, 2) + Math.pow(y - myY, 2));
                    // Пропускаем самого себя
                    if (dist > 0.5) {
                        results.push({x: x, y: y, z: z, dist: dist, addr: address.toString()});
                        console.log("  [!] Найден: X=" + x.toFixed(2) + " Y=" + y.toFixed(2) + " Z=" + z.toFixed(2) + " dist=" + dist.toFixed(2));
                    }
                }
            } catch(e) {}
        },
        onComplete: function() {
            chunk++;
            scanNext();
        }
    });
}

scanNext();
setTimeout(function(){}, 60000);
