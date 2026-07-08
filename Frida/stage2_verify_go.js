// =====================================================================
// AOR Core — Stage 2: GameObject Verification (Rotation/Pos)
// =====================================================================
// Usage: frida -p <PID> -l ./stage2_verify_go.js
// 
// Verifies GameObject health/status using specific offsets provided.
// GO address should be updated if the object pointer changes.
// =====================================================================

// --- CONFIG ---
const GO_PTR = ptr("0x7CCB40F96000");
// --- END CONFIG ---

const ANGLE_OFFSET = 0x38;
const X_OFFSET = 0x3C;
const Y_OFFSET = 0x40;

function verifyGameObject(goAddr) {
    const id = goAddr.add(0x10).readS32();
    const angle = goAddr.add(ANGLE_OFFSET).readFloat();
    const x = goAddr.add(X_OFFSET).readFloat();
    const y = goAddr.add(Y_OFFSET).readFloat();
    return { id, angle, x, y };
}

try {
    const data = verifyGameObject(GO_PTR);

    console.log("");
    console.log("========================================");
    console.log("  AOR Core — Stage 2: GameObject Check");
    console.log("========================================");
    console.log("");
    console.log(`  GameObject: ${GO_PTR}`);
    console.log("");
    console.log(`  InstanceID: ${data.id}`);
    console.log(`  Angle:      ${data.angle.toFixed(2)}°`);
    console.log(`  X (GO):     ${data.x.toFixed(4)}`);
    console.log(`  Y (GO):     ${data.y.toFixed(4)}`);
    console.log("");
    console.log("========================================");

} catch (err) {
    console.error(`[ERROR] ${err.message}`);
}
