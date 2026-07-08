// =====================================================================
// AOR Core — Stage 1: Read Coordinates from Movement Component
// =====================================================================
// Usage: frida -p <PID> -l ./stage1_read_coords.js
// 
// Reads player coordinates from the known Movement Component address.
// Component address is hardcoded below — update on each game restart.
// =====================================================================

// --- CONFIG: Update this on each game restart ---
const COMPONENT_PTR = ptr("0x7CCB0210F540");
// --- END CONFIG ---

const COORDS_OFFSET = 0xF0;
const GO_OFFSET = 0x18;

function readCoords(componentAddr) {
    const coordsAddr = componentAddr.add(COORDS_OFFSET);
    const x = coordsAddr.readFloat();
    const y = coordsAddr.add(4).readFloat();
    const z = coordsAddr.add(8).readFloat();
    return { x, y, z };
}

function readGameObject(componentAddr) {
    return componentAddr.add(GO_OFFSET).readPointer();
}

function readInstanceID(goPtr) {
    return goPtr.add(0x10).readS32();
}

try {
    const coords = readCoords(COMPONENT_PTR);
    const goPtr = readGameObject(COMPONENT_PTR);
    const instanceID = readInstanceID(goPtr);

    console.log("");
    console.log("========================================");
    console.log("  AOR Core — Stage 1: Player Status");
    console.log("========================================");
    console.log("");
    console.log(`  Component (Movement): ${COMPONENT_PTR}`);
    console.log(`  GameObject:           ${goPtr}`);
    console.log(`  InstanceID:           ${instanceID}`);
    console.log("");
    console.log(`  Coordinates:`);
    console.log(`    X = ${coords.x.toFixed(4)}`);
    console.log(`    Y = ${coords.y.toFixed(4)}`);
    console.log(`    Z = ${coords.z.toFixed(4)}`);
    console.log("");
    console.log(`  Hex: ${COMPONENT_PTR.add(COORDS_OFFSET)}`);
    console.log(`  Raw: ${coords.x}  ${coords.y}  ${coords.z}`);
    console.log("");
    console.log("========================================");

} catch (err) {
    console.error(`[ERROR] ${err.message}`);
    console.error(`[ERROR] Component address ${COMPONENT_PTR} may be invalid.`);
}
