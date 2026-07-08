import frida, time

PID = 10994
SCRIPT = """
console.log("[*] Checking vtable candidate @ 0x79933c7980b0");
var natTf = ptr("0x79933c7980d0");
var cand = natTf.add(-0x20);  // 0x79933c7980b0

var vt = cand.readPointer();
console.log("  VTable: " + vt);
var vtMod = Process.findModuleByAddress(vt);
if (vtMod) console.log("  Module: " + vtMod.name + " base=" + vtMod.base + " size=" + vtMod.size);

// Read first 16 bytes of vtable (the first 2 virtual functions)
console.log("  vtable[0]: " + vt.readPointer());
console.log("  vtable[1]: " + vt.add(8).readPointer());

// What module is the potential GameObject at +0x08?
var goPtr = cand.add(8).readPointer();
console.log("  +0x08 (GameObject?): " + goPtr);
var goMod = Process.findModuleByAddress(goPtr);
if (goMod) console.log("    Module: " + goMod.name);

// What's at +0x10 (TransformHierarchy?)
var thPtr = cand.add(0x10).readPointer();
console.log("  +0x10 (TransformHierarchy?): " + thPtr);
var thMod = Process.findModuleByAddress(thPtr);
if (thMod) console.log("    Module: " + thMod.name);

// What's at +0x18?
var idxData = cand.add(0x18).readPointer();
console.log("  +0x18 (m_TransformIndex+Parent?): " + idxData);
console.log("    +0x18 as s32: " + cand.add(0x18).readS32());
console.log("    +0x1C as s32: " + cand.add(0x1C).readS32());

// Check if +0x08 actually points to a GameObject (try reading klass at -0x10)
var go = cand.add(8).readPointer();
if (go > 0x100000000000) {
    console.log("");
    console.log("--- Checking GameObject candidate @ +0x08 ---");
    console.log("  goPtr = " + go);
    try {
        var goBytes = go.readByteArray(0x40);
        var arr = new Uint8Array(goBytes);
        var hex = "";
        for (var i = 0; i < 0x40; i++) {
            if (i % 16 === 0) hex += "\\n  +" + i.toString(16).padStart(4,"0") + ": ";
            hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
        }
        console.log(hex);
    } catch(e) { console.log("  read error: " + e.message); }
    
    // Check for klass at goPtr-0x10
    try {
        var k = go.add(-0x10).readPointer();
        console.log("  klass at -0x10: " + k);
        if (k > 0x100000000000) {
            for (var co = 0; co < 0x100; co += 8) {
                try {
                    var p = k.add(co).readPointer();
                    if (p && !p.isNull()) {
                        try {
                            var s = p.readCString();
                            if (s && s.length > 2 && s.length < 80 && s.charCodeAt(0) >= 65) {
                                console.log("    klass+" + co.toString(16) + " string: '" + s + "'");
                            }
                        } catch(e) {}
                    }
                } catch(e) {}
            }
        }
    } catch(e) { console.log("  klass error: " + e.message); }
}

// Read full 0x60 bytes from candidate
console.log("");
console.log("--- Full dump from 0x79933c7980b0 (0x60 bytes) ---");
var bytes = cand.readByteArray(0x60);
var arr = new Uint8Array(bytes);
var hex = "";
for (var i = 0; i < 0x60; i++) {
    if (i % 16 === 0) hex += "\\n  +" + i.toString(16).padStart(4,"0") + ": ";
    hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
}
console.log(hex);
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
