var gom = ptr("0x74acb0088b20");
var myNode = ptr("0x74aab7489868");
var sentinel = gom.add(0x18);
var head = sentinel.readPointer();

var node = head;
var count = 0;
var found = false;

console.log("Traversing full GOM list from " + head);

while (count < 1000) {
    if (node.equals(myNode)) {
        console.log("[!!!] FOUND MY NODE at #" + count);
        found = true;
        break;
    }

    try {
        var next = node.readPointer();
        if (next.equals(sentinel) || next.isNull()) {
            console.log("End of list at #" + count + (next.equals(sentinel) ? " (sentinel)" : " (null)"));
            break;
        }
        node = next;
    } catch(e) {
        console.log("Error at #" + count + ": " + e);
        break;
    }
    count++;
}

if (!found) {
    console.log("My node NOT found in " + count + " nodes.");
    
    // Let's also check: maybe node offset is not 0x68
    // Try reading the first node and check what's at different offsets
    console.log("\nChecking first node structure:");
    var first = head;
    for (var off = 0; off < 0x80; off += 8) {
        var val = first.add(off).readPointer();
        if (val.equals(myNode)) {
            console.log("  [!!!] My node found at first_node+" + off.toString(16) + "!");
        }
        if (val.equals(ptr("0x74aab7489800"))) {
            console.log("  [!!!] My GO found at first_node+" + off.toString(16) + "!");
        }
    }
}

console.log("Done. Checked " + count + " nodes.");
