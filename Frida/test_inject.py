import frida, sys, time

PID = 10994
SCRIPT = """
console.log("[*] Injected! Reading native Transform @ 0x79933c7980d0");
var natTf = ptr("0x79933c7980d0");

// Read raw bytes
var bytes = natTf.readByteArray(0x40);
var arr = new Uint8Array(bytes);
var hex = "";
for (var i = 0; i < 0x40; i++) {
    if (i % 16 === 0) hex += "\\n  +" + i.toString(16).padStart(4,"0") + ": ";
    hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
}
console.log(hex);

// XYZ
console.log("  X: " + natTf.readFloat().toFixed(2));
console.log("  Y: " + natTf.add(4).readFloat().toFixed(2));
console.log("  Z: " + natTf.add(8).readFloat().toFixed(2));

// Read -0x28 range
console.log("");
console.log("[*] Reading at natTf-0x28 = " + natTf.add(-0x28));
var preBytes = natTf.add(-0x28).readByteArray(0x68);
var preArr = new Uint8Array(preBytes);
var preHex = "";
for (var i = 0; i < 0x68; i++) {
    if (i % 16 === 0) preHex += "\\n  +" + i.toString(16).padStart(4,"0") + ": ";
    preHex += ("0" + preArr[i].toString(16)).slice(-2) + " ";
}
console.log(preHex);

// Potential vtable at -0x28
var vt = natTf.add(-0x28).readPointer();
console.log("  +0x00 (word): " + natTf.add(-0x28).readU32());  // first 4 bytes as u32
console.log("  +0x00 (ptr): " + vt);
var vtMod = Process.findModuleByAddress(vt);
if (vtMod) console.log("  vtable module: " + vtMod.name);

// Instance IDs
console.log("  +0x08 (s32): " + natTf.add(-0x28 + 8).readS32());
console.log("  +0x0C (u32): " + natTf.add(-0x28 + 0xC).readU32());

// Check at -0x20 (16 bytes back)
console.log("");
console.log("[*] Reading at natTf-0x20 = " + natTf.add(-0x20));
console.log("  +0x00 (ptr): " + natTf.add(-0x20).readPointer());

// Check at -0x30 (another alignment)
console.log("");
console.log("[*] Reading at natTf-0x30 = " + natTf.add(-0x30));
console.log("  +0x00 (ptr): " + natTf.add(-0x30).readPointer());

console.log("[*] Done");
"""

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(SCRIPT)
    script.load()
    time.sleep(5)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}")
