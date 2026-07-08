var unityPlayer = Process.findModuleByName("UnityPlayer.so");

var getGOM_Ptr = unityPlayer.base.add(0x009ECE20);
var GetGameObjectManager = new NativeFunction(getGOM_Ptr, 'pointer', []);

var getTaggedNodesPtr = unityPlayer.base.add(0x00849F40);
var GetTaggedNodes = new NativeFunction(getTaggedNodesPtr, 'pointer', ['pointer', 'int']);

console.log("[+] GetGameObjectManager: " + getGOM_Ptr);
console.log("[+] GetTaggedNodes: " + getTaggedNodesPtr);

var gomInstance = GetGameObjectManager();
console.log("[+] GOM: " + gomInstance);

for (var tag = 0; tag <= 5; tag++) {
    var head = GetTaggedNodes(gomInstance, tag);
    if (head.isNull()) {
        console.log("Tag " + tag + ": NULL");
        continue;
    }
    console.log("\n=== Tag " + tag + " head: " + head + " ===");

    var node = head;
    var count = 0;
    while (!node.isNull() && count < 100) {
        try {
            var goPtr = node.add(0x10).readPointer();
            if (!goPtr.isNull()) {
                var iid = goPtr.add(0x10).readS32();
                var name = "";
                try {
                    // Try reading name string (IL2CPP string)
                    var namePtr = goPtr.add(0x00).readPointer();
                    if (!namePtr.isNull()) {
                        var strLen = namePtr.add(0x10).readS32();
                        if (strLen > 0 && strLen < 100) {
                            name = namePtr.add(0x14).readUtf16String(strLen);
                        }
                    }
                } catch(e) {}

                // Read position from GameObject+0x3C, +0x40
                var posX = goPtr.add(0x3C).readFloat();
                var posY = goPtr.add(0x40).readFloat();

                console.log("  [" + count + "] GO=" + goPtr + " ID=" + iid + " Name=" + name + " pos=(" + posX.toFixed(2) + ", " + posY.toFixed(2) + ")");
            }
        } catch(e) {}

        var next = node.readPointer();
        if (next.isNull() || next.equals(node)) break;
        node = next;
        count++;
    }
    console.log("  Total: " + count);
}
