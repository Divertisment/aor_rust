var nativeGameObject = ptr("0x74aab7489800");
var nativeTransform = ptr("0x74AA798EDA80");

console.log("Native GameObject: " + nativeGameObject);
console.log("Native Transform: " + nativeTransform);
console.log("");

// Full dump of GameObject
console.log("=== Full GameObject dump (256 bytes) ===");
console.log(hexdump(nativeGameObject.readByteArray(256), {
    offset: 0, length: 256, header: true, ansi: true
}));

console.log("\n=== Full Transform dump (256 bytes) ===");
console.log(hexdump(nativeTransform.readByteArray(256), {
    offset: 0, length: 256, header: true, ansi: true
}));

// Check GameObject for back-pointer to Transform
console.log("\n=== GameObject: looking for native Transform pointer ===");
for (var off = 0; off < 256; off += 8) {
    try {
        var val = nativeGameObject.add(off).readPointer();
        if (!val.isNull() && val.equals(nativeTransform)) {
            console.log("[***] FOUND Transform pointer @ +0x" + off.toString(16));
        }
        // Also check if val points to something that could be a valid GameObject/Component
        // (val in the heap region 0x74aa...)
        var addrStr = val.toString();
        if (addrStr.startsWith("0x74aa") || addrStr.startsWith("0x74ab")) {
            // Interesting managed object reference
        }
    } catch(e) {}
}

// Check Transform for any self-identifying data
console.log("\n=== Transform: checking instance data ===");
try {
    var iid = nativeTransform.add(0x10).readS32();
    console.log("Transform +0x10 (instanceID?) = " + iid);
} catch(e) {}

// Check if there's a type marker or vtable
var vt = nativeTransform.readPointer();
console.log("Transform vtable @ " + vt);

// Check first few vt entries
for (var i = 0; i < 8; i++) {
    try {
        var entry = vt.add(i * 8).readPointer();
        console.log("  vtable[" + i + "] = " + entry);
    } catch(e) {}
}

// GO class pointer
var goVt = nativeGameObject.readPointer();
console.log("\nGameObject class ptr @ " + goVt);

setTimeout(function(){}, 2000);
