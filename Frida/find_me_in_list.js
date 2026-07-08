var gom = ptr("0x74acb0088b20");
var myNode = ptr("0x74aab7489868");
var myGO = ptr("0x74aab7489800");

console.log("GOM: " + gom);
console.log("My node: " + myNode);
console.log("My GO: " + myGO);

// GOM+0x18 — head of linked list (confirmed by earlier traversal)
var head = gom.add(0x18).readPointer();
console.log("List head (GOM+0x18): " + head);

// Traverse the list looking for my node
var node = head;
var count = 0;
var found = false;
var visited = {};

while (!node.isNull() && count < 2000) {
    var addr = node.toString();
    if (visited[addr]) {
        console.log("Cycle detected at " + addr + " after " + count + " nodes");
        break;
    }
    visited[addr] = true;

    if (node.equals(myNode)) {
        console.log("\n[!!!] FOUND MY NODE at position " + count + "!");
        found = true;
        break;
    }

    // Also check if node - 0x68 == myGO (alternative: maybe node IS at +0x68)
    var maybeGO = node.sub(0x68);
    if (maybeGO.equals(myGO)) {
        console.log("\n[!!!] FOUND MY GO via node-0x68 at position " + count + "!");
        found = true;
        break;
    }

    var next = node.readPointer();
    if (next.isNull() || next.equals(node)) {
        console.log("End of list at node " + addr);
        break;
    }
    node = next;
    count++;
}

console.log("Traversed " + count + " nodes. Found: " + found);

// If not found in main list, let's also check what's at GOM+0x00, GOM+0x10, GOM+0x20
console.log("\n=== Checking other GOM offsets for list heads ===");
for (var off = 0; off < 0x40; off += 8) {
    try {
        var val = gom.add(off).readPointer();
        if (!val.isNull() && val != gom) {
            // Check if it looks like a linked list node (has valid next pointer)
            var next = val.readPointer();
            if (!next.isNull() && next != val) {
                console.log("GOM+" + off.toString(16) + " = " + val + " -> next=" + next);
            }
        }
    } catch(e) {}
}

setTimeout(function(){}, 2000);
