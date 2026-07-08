// Find Unity GameObjectManager via s_Instance global
const unity = Module.findBaseAddress("UnityPlayer.so");
console.log("UnityPlayer.so base:", unity);

// GameObjectManager::s_Instance at unity + 0x20EAAC0
const s_instance_ptr = unity.add(0x20EAAC0);
console.log("s_Instance address:", s_instance_ptr);
console.log("s_Instance bytes:", hexdump(s_instance_ptr.readByteArray(8)));

const gomPtr = s_instance_ptr.readPointer();
console.log("GameObjectManager *s_Instance:", gomPtr);

if (!gomPtr.isNull()) {
    // GameObjectManager structure
    console.log("GOM bytes:", hexdump(gomPtr.readByteArray(0x80)));
    
    // Try to read tagged nodes
    // Typically DynamicArray of game objects stored in GOM
    // Need to figure out the exact offsets
    
    // Let's try some common offsets for the last active node tree
    // First 8 bytes often = some vtable or pointer
    console.log("GOM +0x00:", gomPtr.readPointer());
    console.log("GOM +0x08:", hexdump(gomPtr.add(0x08).readByteArray(0x38)));
    
    // Look for pointer-like values that could be arrays
    for (let off = 0; off < 0x100; off += 8) {
        try {
            const val = gomPtr.add(off).readPointer();
            if (!val.isNull() && val > unity && val < unity.add(0x4000000)) {
                console.log(`GOM+0x${off.toString(16)}: pointer ${val} (inside UnityPlayer)`);
            }
        } catch(e) {}
    }
    
    // Enumerate active GameObjects via Unity API if available
    // Try GameObject::GetTaggedNodes by scanning the binary
    const getTaggedNodes = unity.add(0x849F40);
    const gtn_bytes = getTaggedNodes.readByteArray(64);
    console.log("GetTaggedNodes bytes:", hexdump(gtn_bytes));
    
    // Try calling it as a function
    try {
        const gtn = new NativeFunction(getTaggedNodes, 'pointer', ['pointer', 'uint']);
        const nodes = gtn(gomPtr, 0);
        console.log("GetTaggedNodes(0) result:", nodes);
        if (!nodes.isNull()) {
            console.log("Nodes struct:", hexdump(nodes.readByteArray(0x30)));
        }
    } catch(e) {
        console.log("GetTaggedNodes call failed:", e.message);
    }
} else {
    console.log("GOM is null, trying alternate approaches");
    
    // Scan for the GOM pointer pattern
    Memory.scan(unity, 0x4000000, "48 8b 05 ?? ?? ?? ?? c3", {
        onMatch: function(address, size) {
            console.log("Found pattern at:", address);
            const rel = address.readS32();
            const target = address.add(7 + rel);
            console.log("  Target:", target);
            console.log("  Value at target:", target.readPointer());
        },
        onComplete: function() {
            console.log("Pattern scan complete");
        }
    });
}
