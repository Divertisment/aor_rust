var unityPlayer = Process.findModuleByName("UnityPlayer.so");
var getGOM_Ptr = unityPlayer.base.add(0x009ECE20);
var GetGameObjectManager = new NativeFunction(getGOM_Ptr, 'pointer', []);
var getTaggedNodesPtr = unityPlayer.base.add(0x00849F40);
var GetTaggedNodes = new NativeFunction(getTaggedNodesPtr, 'pointer', ['pointer', 'int']);

var gom = GetGameObjectManager();
console.log("GOM: " + gom);

// Check what GetTaggedNodes returns for tag 5
var head5 = GetTaggedNodes(gom, 5);
console.log("Tag 5 head: " + head5);
console.log("Head5 dump:");
console.log(hexdump(head5.readByteArray(128), {
    offset: 0, length: 128, header: true, ansi: true
}));

// Our known node
var myNode = ptr("0x74aab7489868");
console.log("\nMy node dump:");
console.log(hexdump(myNode.readByteArray(64), {
    offset: 0, length: 64, header: true, ansi: true
}));

// Maybe the head is a container object, not a raw node
// Let's try reading +0x00, +0x08, +0x10, +0x18 from it
console.log("\nReading head5 as different structures:");
for (var off = 0; off < 64; off += 8) {
    var val = head5.add(off).readPointer();
    console.log("  +" + off.toString(16) + ": " + val);
}

// Maybe GetTaggedNodes returns a list object with first/last/count
// Let's also check if it returns a pointer to the first NODE directly
// and the node structure is: [next=+0x00] [prev=+0x08] [gameObject=+0x10]

// Let's try: walk tag 5 list differently - maybe prev is at +0x08 and next at +0x00
// and the head itself IS the first node (not a container)
console.log("\n=== Trying different traversal for tag 5 ===");
var node = head5;
var seen = {};
for (var i = 0; i < 10; i++) {
    var addr = node.toString();
    if (seen[addr]) {
        console.log("  CYCLE at " + addr);
        break;
    }
    seen[addr] = true;
    
    // Try reading next from different offsets
    var next00 = node.readPointer();
    var next08 = node.add(8).readPointer();
    var next10 = node.add(0x10).readPointer();
    
    console.log("  [" + i + "] " + node + " next@+0=" + next00 + " next@+8=" + next08 + " val@+0x10=" + next10);
    
    // Follow +0x00
    node = next00;
}
