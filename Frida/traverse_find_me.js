var gom = ptr("0x74acb0088b20");
var myNode = ptr("0x74aab7489868");
var sentinel = gom.add(0x18);
var head = sentinel.readPointer();

console.log("GOM: " + gom);
console.log("Sentinel: " + sentinel);
console.log("First node: " + head);

var node = head;
var count = 0;
var found = false;
var visited = {};

while (count < 2000) {
    var addr = node.toString();
    if (visited[addr]) {
        console.log("Cycle back to " + addr + " at count=" + count);
        break;
    }
    visited[addr] = true;

    // GameObject = node - 0x68
    var go = node.sub(0x68);

    // Check if this is our node
    if (node.equals(myNode)) {
        console.log("\n[!!!] FOUND MY NODE at #" + count + "!");
        console.log("  Node: " + node);
        console.log("  GameObject: " + go);
        found = true;
        
        // Read info about this GO
        var id = go.add(0x10).readS32();
        var posX = go.add(0x3C).readFloat();
        var posY = go.add(0x40).readFloat();
        var rot = go.add(0x38).readFloat();
        console.log("  ID: " + id);
        console.log("  PosX: " + posX.toFixed(2));
        console.log("  PosY: " + posY.toFixed(2));
        console.log("  Rotation: " + rot.toFixed(2));
        break;
    }

    var next = node.readPointer();
    if (next.equals(sentinel)) {
        console.log("Reached sentinel at #" + count + ". My node NOT found.");
        break;
    }
    if (next.isNull()) {
        console.log("Null next at #" + count);
        break;
    }
    node = next;
    count++;
}
