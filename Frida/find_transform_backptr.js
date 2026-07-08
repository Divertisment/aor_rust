var unityPlayer = Process.getModuleByName("UnityPlayer.so");
var funcAddr = unityPlayer.base.add(0x9ECE20);
var rip = funcAddr.add(7);
var disp = funcAddr.add(3).readS32();
var globalAddr = rip.add(disp);
var gom = globalAddr.readPointer();
var sentinel = gom.add(0x18);

console.log("GOM: " + gom);
console.log("Sentinel: " + sentinel);

// First check our known Transform (from previous session)
var knownTransform = ptr("0x74AA798EDA80");
console.log("\n=== Checking known Transform ===");
try {
    var x = knownTransform.add(0xF0).readFloat();
    var y = knownTransform.add(0xF4).readFloat();
    var z = knownTransform.add(0xF8).readFloat();
    console.log("Position: X=" + x + " Y=" + y + " Z=" + z);
    
    var go = knownTransform.add(0x18).readPointer();
    console.log("GameObject: " + go);
    var iid = go.add(0x10).readU32();
    console.log("GameObject InstanceID: " + iid);
    
    console.log(hexdump(knownTransform.readByteArray(0x100), {
        offset: 0, length: 0x100, header: true, ansi: true
    }));
} catch(e) {
    console.log("ERROR: " + e);
}

// Now check the first few GOM nodes
console.log("\n=== First 10 GOM GameObjects ===");
var node = sentinel.readPointer();
for (var i = 0; i < 10 && !node.equals(sentinel); i++) {
    var goAddr = node.sub(0x68);
    try {
        var iid = goAddr.add(0x10).readU32();
        
        // Check all component-like offsets for back-pointer
        var backPtrFound = false;
        var compOffsets = [0x28, 0x30, 0x38, 0x40, 0x48, 0x50, 0x58, 0x60, 0x78, 0x80, 0x88, 0x90];
        
        for (var ci = 0; ci < compOffsets.length; ci++) {
            try {
                var compAddr = goAddr.add(compOffsets[ci]).readPointer();
                if (!compAddr.isNull()) {
                    // Check if +0x18 of component == goAddr (Component->GameObject back pointer)
                    var bp = compAddr.add(0x18).readPointer();
                    if (!bp.isNull() && bp.equals(goAddr)) {
                        if (!backPtrFound) {
                            console.log("GO[" + i + "] @" + goAddr + " iid=" + iid);
                            backPtrFound = true;
                        }
                        console.log("  Component[+" + compOffsets[ci].toString(16) + "] @" + compAddr + " [BACKPTR OK]");
                        
                        // Try reading position
                        try {
                            var px = compAddr.add(0xF0).readFloat();
                            var py = compAddr.add(0xF4).readFloat();
                            var pz = compAddr.add(0xF8).readFloat();
                            console.log("    Pos: X=" + px.toFixed(2) + " Y=" + py.toFixed(2) + " Z=" + pz.toFixed(2));
                        } catch(e) {}
                    }
                }
            } catch(e) {}
        }
        
        if (!backPtrFound) {
            console.log("GO[" + i + "] @" + goAddr + " iid=" + iid + " [no components with backptr]");
        }
    } catch(e) {
        console.log("GO[" + i + "] @" + goAddr + " ERROR: " + e);
    }
    
    node = node.readPointer();
}

setTimeout(function(){}, 3000);
