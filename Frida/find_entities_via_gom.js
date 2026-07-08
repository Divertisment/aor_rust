// Find entities via Unity GameObjectManager
const unity = Module.findBaseAddress("UnityPlayer.so");
const ga = Module.findBaseAddress("GameAssembly.so");

if (unity) {
    console.log("Unity:", unity, "GA:", ga);

    // Get GameObjectManager singleton
    const gomPtr = unity.add(0x20EAAC0).readPointer();
    console.log("GOM ptr:", gomPtr);

    if (!gomPtr.isNull()) {
        // Call GetTaggedNodes(0)
        const getTaggedNodes = new NativeFunction(unity.add(0x849F40), 'pointer', ['pointer', 'uint32']);
        const tag0 = getTaggedNodes(gomPtr, 0);
        console.log("GetTaggedNodes(0):", tag0);

        if (!tag0.isNull()) {
            const arrStart = tag0.readPointer();
            const arrEnd = tag0.add(8).readPointer();
            console.log("Array:", arrStart, "-", arrEnd);

            if (!arrStart.isNull() && !arrEnd.isNull() && arrEnd > arrStart) {
                const count = arrEnd.sub(arrStart).toInt32() / 8;
                console.log("Count:", count);

                // GameObject::GetName at unity + 0x9F1900
                const getName = new NativeFunction(unity.add(0x9F1900), 'pointer', ['pointer']);

                let entityCount = 0;
                let printed = 0;
                const maxIterate = count < 5000 ? count : 5000;

                for (let i = 0; i < maxIterate; i++) {
                    const objPtr = arrStart.add(i * 8).readPointer();
                    if (!objPtr || objPtr.isNull()) continue;

                    try {
                        const namePtr = getName(objPtr);
                        const name = namePtr.readCString();
                        if (!name || name.length === 0) continue;

                        if (name.includes("_Entity") || name.includes("_Mob") ||
                            name.includes("_Player") || name.includes("_NPC") ||
                            name.includes("Character") || name.includes("Actor") ||
                            name.includes("Agent") || name.includes("_Chr") ||
                            name.includes("Dummy") || name.includes("Local") ||
                            name.includes("Player") || name.includes("Mob")) {
                            console.log("[ENT]", i, name);
                            entityCount++;
                        } else if (printed < 10) {
                            console.log("[OBJ]", i, name);
                            printed++;
                        }
                    } catch(e) {
                        // skip invalid objects
                    }
                }
                console.log("Entity count:", entityCount);
            }
        }
    }
} else {
    console.error("UnityPlayer.so not found");
}
