// Find player ID via GameObjectManager
// Usage: frida -p PID -l IDA_FindPlayerIdByGOM.js

const PLAYER_NAME = "KpAcuBa";
const unity = Module.findBaseAddress("UnityPlayer.so");
const ga = Module.findBaseAddress("GameAssembly.so");

if (!unity || !ga) {
    console.log("ERROR: Modules not found");
    Process.exit();
}

console.log("Unity:", unity);
console.log("GA:", ga);

// Get GameObjectManager
const gomPtr = unity.add(0x20EAAC0).readPointer();
console.log("GOM ptr:", gomPtr);

if (gomPtr.isNull()) {
    console.log("ERROR: GOM is null");
    Process.exit();
}

const getTaggedNodes = new NativeFunction(unity.add(0x849F40), 'pointer', ['pointer', 'uint32']);
const tag0 = getTaggedNodes(gomPtr, 0);
console.log("TaggedNodes(0):", tag0);

if (tag0.isNull()) {
    console.log("ERROR: No tagged nodes");
    Process.exit();
}

const arrStart = tag0.readPointer();
const arrEnd = tag0.add(8).readPointer();
const count = arrEnd.sub(arrStart).toInt32() / 8;
console.log("GameObjects:", count);

const getName = new NativeFunction(unity.add(0x9F1900), 'pointer', ['pointer']);

// Search for our player
let found = false;
for (let i = 0; i < count; i++) {
    const objPtr = arrStart.add(i * 8).readPointer();
    if (!objPtr || objPtr.isNull()) continue;
    
    try {
        const namePtr = getName(objPtr);
        const name = namePtr.readCString();
        if (!name || name.length === 0) continue;
        
        if (name.includes(PLAYER_NAME)) {
            console.log("\n=== FOUND PLAYER ===");
            console.log("Index:", i, "GameObject:", objPtr, "Name:", name);
            
            // GameObject layout:
            // +0x18: Component (MonoBehaviour)
            const component = objPtr.add(0x18).readPointer();
            console.log("Component:", component);
            
            // For a Character/Player object:
            // Component -> Transform -> etc
            // Dump nearby memory
            console.log("\nGameObject dump:");
            console.log(hexdump(objPtr, { offset: 0, length: 64, ansi: true }));
            
            if (!component.isNull()) {
                console.log("\nComponent dump:");
                console.log(hexdump(component, { offset: 0, length: 128, ansi: true }));
            }
            
            found = true;
        }
    } catch(e) {}
}

if (!found) {
    console.log("Player", PLAYER_NAME, "not found by name in GameObjects");
    // Fallback: dump all player-like objects
    console.log("\nSearching for Character/MonoBehaviour objects...");
    for (let i = 0; i < count; i++) {
        const objPtr = arrStart.add(i * 8).readPointer();
        if (!objPtr || objPtr.isNull()) continue;
        try {
            const namePtr = getName(objPtr);
            const name = namePtr.readCString();
            if (name && (name.includes("Character") || name.includes("Player") || name.includes("Local"))) {
                console.log("[" + i + "]", name, objPtr);
            }
        } catch(e) {}
    }
}
