var gom = ptr("0x72dbb0088b20");
var userGO = ptr("0x72d9d3d6b000");
var userTransform = ptr("0x72D95646C540");

// Step 1: Read real player coords from Transform+0xF0
var playerX = userTransform.add(0xF0).readFloat();
var playerY = userTransform.add(0xF4).readFloat();
var playerZ = userTransform.add(0xF8).readFloat();
console.log("[ПОЗИЦИЯ] Твои реальные координаты: X=" + playerX.toFixed(2) + " Y=" + playerY.toFixed(2) + " Z=" + playerZ.toFixed(2));

// Step 2: Find user's node in GOM list
var sentinel = gom.add(0x18);
var head = sentinel.readPointer();
var node = head;
var userNode = null;
var count = 0;

console.log("\n[ПОИСК] Ищу твою ноду (ID=573) в GOM...");
while (count < 1000) {
    var go = node.sub(0x68);
    try {
        var id = go.add(0x10).readS32();
        if (id === 573) {
            userNode = node;
            console.log("[НАЙДЕНО] Твоя нода: " + node + " (GO: " + go + ") на позиции #" + count);
            break;
        }
    } catch(e) {}
    
    var next = node.readPointer();
    if (next.equals(sentinel) || next.isNull()) break;
    node = next;
    count++;
}

if (!userNode) {
    console.log("[-] Нода не найдена в списке!");
}

// Step 3: Scan entire GOM list for objects near player
console.log("\n[ПОИСК] Сканирую GOM список на объекты в радиусе ±3 метра...");
node = head;
count = 0;
var found = [];

while (count < 1000) {
    var go = node.sub(0x68);
    try {
        var id = go.add(0x10).readS32();
        if (id > 0 && id < 1000000) {
            // Need to get Transform from this GO
            // Transform* is at GO+0x18 based on our structure
            var tf = go.add(0x18).readPointer();
            if (Process.findRangeByAddress(tf) && !tf.isNull()) {
                var x = tf.add(0xF0).readFloat();
                var y = tf.add(0xF4).readFloat();
                var z = tf.add(0xF8).readFloat();
                
                var dx = Math.abs(x - playerX);
                var dy = Math.abs(y - playerY);
                
                if (dx <= 3.0 && dy <= 3.0 && !(dx < 0.01 && dy < 0.01)) {
                    found.push({node: node, go: go, id: id, tf: tf, x: x, y: y, z: z, dx: dx, dy: dy});
                }
            }
        }
    } catch(e) {}
    
    var next = node.readPointer();
    if (next.equals(sentinel) || next.isNull()) break;
    node = next;
    count++;
}

console.log("[РЕЗУЛЬТАТ] Проверено объектов: " + (count+1) + ", найдено рядом: " + found.length);
found.forEach(function(o, i) {
    console.log("  #" + (i+1) + " GO=" + o.go + " ID=" + o.id + " TF=" + o.tf +
        " X=" + o.x.toFixed(2) + " Y=" + o.y.toFixed(2) + " Z=" + o.z.toFixed(2) +
        " dX=" + o.dx.toFixed(2) + " dY=" + o.dy.toFixed(2));
});
