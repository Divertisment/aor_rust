var gom = ptr("0x74acb0088b20");
var myNode = ptr("0x74aab7489868");
var myGO = ptr("0x74aab7489800");

console.log("=== Deep GOM scan ===");
console.log("GOM: " + gom);
console.log("My node: " + myNode);
console.log("My GO: " + myGO);

// 1) Dump GOM+0x00..0xF0 as 8-byte pointers, classify each
console.log("\n--- GOM fields ---");
for (var off = 0; off < 0x100; off += 8) {
    var val = gom.add(off).readPointer();
    var range = Process.findRangeByAddress(val);
    var tag = range ? range.protection + " (" + range.name + ")" : "NOT-IN-MEM";
    console.log("  +" + off.toString(16).padStart(2,'0') + ": " + val + "  [" + tag + "]");
}

// 2) Check GOM+0x18 = 0x74aa617314f8 — is this a bucket array?
// If it IS a bucket array, each entry should be a pointer to the first node in a chain
// Each node is at: GameObject + 0x68, so bucket entry points to GO+0x68
// Let's trace each bucket entry and see where it leads

console.log("\n--- Bucket walk from GOM+0x18 ---");
var bucketBase = gom.add(0x18).readPointer(); // 0x74aa617314f8
console.log("Bucket base: " + bucketBase);

// First, dump 32 entries from bucketBase to see what's there
for (var i = 0; i < 32; i++) {
    var addr = bucketBase.add(i * 8);
    var val = addr.readPointer();
    var inMem = Process.findRangeByAddress(val) !== null;
    console.log("  [" + i + "] " + addr + " => " + val + (inMem ? " [valid ptr]" : " [small/int]"));
}

// 3) Let's re-examine: maybe the list isn't at GOM+0x18
// Try scanning for the sentinel pattern: a node whose prev points to GOM+0x18
// We know sentinel is at GOM+0x18 = address 0x74acb0088b38
// A valid node has: node.prev == sentinel_addr => node.prev == GOM+0x18
var sentinelAddr = gom.add(0x18); // address = 0x74acb0088b38
console.log("\n--- Looking for nodes whose prev == GOM+0x18 ---");
// We already found: first node at 0x74aa617314f8 has prev = 0x74acb0088b38
// That IS the sentinel. So the list DOES start at 0x74aa617314f8.

// 4) Check if my node's neighbors (next/prev) appear anywhere in the list
console.log("\n--- My node links ---");
var myNext = myNode.readPointer();
var myPrev = myNode.add(8).readPointer();
console.log("My next: " + myNext);
console.log("My prev: " + myPrev);
console.log("My next == GOM+0x18? " + myNext.equals(sentinelAddr));
console.log("My prev == GOM+0x18? " + myPrev.equals(sentinelAddr));

// 5) Search backwards: who points to myNode?
console.log("\n--- Searching for pointers to myNode (0x74aab7489868) ---");
// Use Memory.scan in known ranges
var ranges = Process.enumerateRanges('r--');
var totalFound = 0;
ranges.forEach(function(r) {
    try {
        Memory.scan(r.base, r.size, '68 98 48 b7 aa 74 00', {
            onMatch: function(addr, size) {
                totalFound++;
                console.log("  Found at " + addr + " in " + r.base + "-" + r.base.add(r.size));
            },
            onError: function(reason) {},
            onComplete: function() {}
        });
    } catch(e) {}
});

// 6) Maybe my node is at a different offset in the GO structure
// The linked list node might NOT be at GO+0x68
// Let's check what's at myGO for every 8-byte offset, looking for next/prev that look like heap ptrs
console.log("\n--- Scanning myGO for linked-list-like fields ---");
for (var off = 0; off < 0x100; off += 8) {
    try {
        var val = myGO.add(off).readPointer();
        if (val.isNull()) continue;
        var range = Process.findRangeByAddress(val);
        if (range && range.protection.startsWith('r')) {
            // Is the value at val+0 or val+8 a pointer back to myGO or myNode?
            try {
                var check1 = val.readPointer();
                var check2 = val.add(8).readPointer();
                if (check1.equals(myGO) || check1.equals(myNode) || check2.equals(myGO) || check2.equals(myNode)) {
                    console.log("  +0x" + off.toString(16) + ": " + val + " -> (may link to GO/node)");
                }
            } catch(e) {}
        }
    } catch(e) {}
}
console.log("Done.");
