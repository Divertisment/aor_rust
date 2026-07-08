var gom = ptr("0x74acb0088b20");
var myNode = ptr("0x74aab7489868");
var myGO = ptr("0x74aab7489800");

console.log("=== GOM Structure Analysis ===");
console.log("GOM: " + gom);

// Dump first 256 bytes
console.log("\nGOM raw dump:");
for (var off = 0; off < 0x100; off += 8) {
    var val = gom.add(off).readPointer();
    var isPtr = Process.findRangeByAddress(val) !== null;
    console.log("  +" + off.toString(16).padStart(2, '0') + ": " + val + (isPtr ? " [PTR]" : " [INT=" + val + "]"));
}

// GOM+0x18 points to 0x74aa62b0b048 - let's check if it's a bucket array
var bucketArray = gom.add(0x18).readPointer();
console.log("\n=== Bucket array at " + bucketArray + " ===");

// Read 10 pointers from bucketArray (bucket_count was 6)
for (var i = 0; i < 10; i++) {
    try {
        var bucket = bucketArray.add(i * 8).readPointer();
        console.log("  bucket[" + i + "]: " + bucket);
    } catch(e) {
        console.log("  bucket[" + i + "]: ERROR " + e);
        break;
    }
}

// Also check GOM+0x20 as another potential pointer
var alt = gom.add(0x20).readPointer();
console.log("\nGOM+0x20: " + alt);
if (Process.findRangeByAddress(alt) !== null) {
    console.log("  [PTR] Reading as potential list...");
    for (var i = 0; i < 5; i++) {
        try {
            var val = alt.add(i * 8).readPointer();
            console.log("  +" + (i*8).toString(16) + ": " + val);
        } catch(e) { break; }
    }
}
