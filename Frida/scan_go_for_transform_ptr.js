var knownGO = ptr("0x74aab7489800");
var nativeTransform = ptr("0x74AA798EDA80");

console.log("Managed GameObject: " + knownGO);
console.log("Native Transform: " + nativeTransform);
console.log("");

// Scan GO memory looking for cachedPtr
console.log("Scanning GameObject for native Transform pointer...");
for (var off = 0; off < 0x100; off += 8) {
    try {
        var val = knownGO.add(off).readPointer();
        if (!val.isNull() && val.equals(nativeTransform)) {
            console.log("[***] cachedPtr found at GO+" + off.toString(16));
        }
    } catch(e) {}
}

// Also scan all 6 component slots for cachedPtr
console.log("\nScanning component slots for cachedPtr...");
for (var ci = 0; ci < 6; ci++) {
    var compAddr = knownGO.add(0x78 + ci * 8).readPointer();
    if (compAddr.isNull()) continue;
    
    console.log("\nComponent[" + ci + "] @ " + compAddr);
    for (var off = 0; off < 0x80; off += 8) {
        try {
            var val = compAddr.add(off).readPointer();
            if (!val.isNull() && val.equals(nativeTransform)) {
                console.log("  [***] cachedPtr at +" + off.toString(16));
            }
        } catch(e) {}
    }
    
    // Full dump
    console.log(hexdump(compAddr.readByteArray(0x80), {
        offset: 0, length: 0x80, header: true, ansi: true
    }));
}

setTimeout(function(){}, 2000);
