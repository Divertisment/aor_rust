// Find player entity by character name via GameObjectManager
// frida -H 127.0.0.1:27042 -n "Albion-Online" -l find_player_by_name.js

const PLAYER_NAME = "KpAcuBa";

let ga = Process.findModuleByName("GameAssembly.so");
let unity = Process.findModuleByName("UnityPlayer.so");
if (!ga || !unity) {
    console.log("[-] Modules not found");
    Process.exit();
}
console.log(`[+] GA: ${ga.base}, Unity: ${unity.base}`);

// --- Read GameObjectManager ---
const gomPtr = unity.base.add(0x20EAAC0).readPointer();
console.log(`[+] GOM: ${gomPtr}`);

if (gomPtr.isNull()) {
    console.log("[-] GOM is null");
    Process.exit();
}

// GetTaggedNodes(0) at unity+0x849F40
const getTaggedNodes = new NativeFunction(unity.base.add(0x849F40), 'pointer', ['pointer', 'uint32']);
const tag0 = getTaggedNodes(gomPtr, 0);
console.log(`[+] TaggedNodes(0): ${tag0}`);

if (tag0.isNull()) {
    console.log("[-] No tagged nodes");
    Process.exit();
}

const arrStart = tag0.readPointer();
const arrEnd = tag0.add(8).readPointer();
const count = arrEnd.sub(arrStart).toInt32() / 8;
console.log(`[+] GameObjects: ${count}`);

const getName = new NativeFunction(unity.base.add(0x9F1900), 'pointer', ['pointer']);

// Search by name
let found = false;
for (let i = 0; i < count && i < 5000; i++) {
    const objPtr = arrStart.add(i * 8).readPointer();
    if (!objPtr || objPtr.isNull()) continue;

    try {
        const namePtr = getName(objPtr);
        const name = namePtr.readCString();
        if (!name) continue;

        // Look for player-like objects
        if (name.includes("LocalPlayer") || name.includes(PLAYER_NAME) ||
            name.includes("_Entity") || name.includes("_Player") ||
            name.includes("Character") || name.includes("Actor")) {

            console.log(`[GO] [${i}] ${name} @ ${objPtr}`);

            // GameObject: +0x18 = Component array pointer
            let compPtr = objPtr.add(0x18).readPointer();
            if (compPtr && !compPtr.isNull()) {
                // First component often has entity data
                console.log(`[COMP] ${compPtr}`);
                let dump = compPtr.readByteArray(64);
                let hex = Array.from(new Uint8Array(dump)).map(b => ("0"+b.toString(16)).slice(-2)).join(' ');
                console.log(`  data: ${hex}`);

                // Try reading nearby memory for entity ID (i32) and floats
                for (let off = 0; off < 256; off += 4) {
                    try {
                        let val = compPtr.add(off).readS32();
                        if (val > 0 && val < 99999) {
                            // Check if followed by plausible XYZ floats
                            let x = compPtr.add(off + 4).readFloat();
                            let y = compPtr.add(off + 8).readFloat();
                            let z = compPtr.add(off + 12).readFloat();
                            if (isFinite(x) && isFinite(y) && isFinite(z) &&
                                x > -20000 && x < 20000 && z > -20000 && z < 20000) {
                                console.log(`  >>> ID=${val} @ +0x${off.toString(16)} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
                                found = true;
                            } else {
                                // Just ID without plausible coords
                                let after = compPtr.add(off + 4).readByteArray(16);
                                let h = Array.from(new Uint8Array(after)).map(b => ("0"+b.toString(16)).slice(-2)).join(' ');
                                console.log(`  ID=${val} @ +0x${off.toString(16)} ctx: ${h}`);
                                found = true;
                            }
                        }
                    } catch(e) { break; }
                }
            }

            // Dump Transform
            let transform = objPtr.add(0x10).readPointer();
            if (transform && !transform.isNull()) {
                for (let off = 0x30; off <= 0xA0; off += 4) {
                    try {
                        let f = transform.add(off).readFloat();
                        if (isFinite(f) && f > -50000 && f < 50000) {
                            let f2 = transform.add(off+4).readFloat();
                            let f3 = transform.add(off+8).readFloat();
                            if (isFinite(f2) && isFinite(f3)) {
                                console.log(`  [POS] @ transform+0x${off.toString(16)}: (${f.toFixed(2)}, ${f2.toFixed(2)}, ${f3.toFixed(2)})`);
                            }
                        }
                    } catch(e) { break; }
                }
            }
        }
    } catch(e) { /* skip invalid */ }
}

if (!found) {
    console.log(`[-] Player "${PLAYER_NAME}" not found by name`);
}
console.log("[+] Done");
