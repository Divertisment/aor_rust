// DIRECT APPROACH: Traverse GOM list and find Transforms with Z=12
var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var globalAddr = rip.add(disp);
var gom = globalAddr.readPointer();
var sentinel = gom.add(0x18);

console.log("=".repeat(70));
console.log("GameObjectManager: " + gom);
console.log("Sentinel: " + sentinel);
console.log("");

// Traverse GOM list
var node = sentinel.readPointer();
var count = 0;
var found = 0;

while (!node.equals(sentinel) && count < 500) {
    // GameObject = GOM node - 0x68
    var goAddr = node.sub(0x68);
    
    try {
        var goID = goAddr.add(0x10).readU32();
        
        // Check component slots for Transform candidates at various offsets
        // Component array can start at different offsets in different Unity versions
        var compOffsets = [0x40, 0x48, 0x58, 0x78, 0x80, 0x88, 0x90, 0xA0, 0xA8, 0x60];
        
        for (var ci = 0; ci < compOffsets.length; ci++) {
            var off = compOffsets[ci];
            try {
                var compAddr = goAddr.add(off).readPointer();
                if (compAddr.isNull() || compAddr.equals(ptr("0"))) continue;
                
                // Check if this component has valid position data at +0xF0
                var x = compAddr.add(0xF0).readFloat();
                var y = compAddr.add(0xF4).readFloat();
                var z = compAddr.add(0xF8).readFloat();
                
                // Valid coords should be finite and reasonable
                if (isFinite(x) && isFinite(y) && isFinite(z) && 
                    Math.abs(x) < 10000 && Math.abs(y) < 10000 && Math.abs(z) < 1000) {
                    
                    if (Math.abs(z - 12) < 0.1) {
                        console.log("[FOUND] Z=12! GameObject #" + count + " (ID:0x" + goID.toString(16) + ")");
                        console.log("  GameObject: " + goAddr);
                        console.log("  Component (Transform) @ " + compAddr + " (GO+" + off.toString(16) + ")");
                        console.log("  Position: X=" + x.toFixed(2) + " Y=" + y.toFixed(2) + " Z=" + z.toFixed(2));
                        
                        // Read GameObject name
                        console.log("  InstanceID: " + goAddr.add(0x10).readS32());
                        found++;
                    }
                }
            } catch(e) {
                // Skip if read fails
            }
        }
    } catch(e) {}
    
    node = node.readPointer();
    count++;
}

console.log("\nChecked " + count + " GameObjects. Found " + found + " Transforms with Z=12.");
console.log("=".repeat(70));

setTimeout(function(){}, 3000);
