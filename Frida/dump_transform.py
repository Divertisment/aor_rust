import frida
import sys

PID = 10994
TRANSFORM_ADDR = 0x79933C7980D0
PTR_AT_50 = 0x79968BCFA0  # pointer found at +0x50

js_code = """
const pid = %d;
const transformAddr = ptr("%s");
const ptrAt50 = ptr("%s");

function dumpHex(addr, size) {
    try {
        const bytes = ptr(addr).readByteArray(size);
        if (!bytes) return "  [ERROR: read failed]";
        let out = "";
        const arr = new Uint8Array(bytes);
        for (let i = 0; i < arr.length; i += 16) {
            let hex = "", ascii = "";
            for (let j = 0; j < 16 && i + j < arr.length; j++) {
                const b = arr[i + j];
                hex += ("0" + b.toString(16)).slice(-2) + " ";
                ascii += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
            }
            out += "  +0x" + i.toString(16).padStart(4, "0") + ": " + hex.padEnd(48) + " |" + ascii + "|\\n";
        }
        return out;
    } catch (e) {
        return "  [ERROR: " + e.message + "]";
    }
}

function readPtr(addr) {
    try { return ptr(addr).readPointer(); }
    catch (e) { return null; }
}

function readS32(addr) {
    try { return ptr(addr).readS32(); }
    catch (e) { return -999; }
}

function readU32(addr) {
    try { return ptr(addr).readU32(); }
    catch (e) { return -1; }
}

function readFloat(addr) {
    try { return ptr(addr).readFloat(); }
    catch (e) { return NaN; }
}

function readStringAt(addr) {
    try {
        const len = readU32(addr);
        if (len <= 0 || len > 200) return null;
        return ptr(addr.add(4)).readUtf8String(len);
    } catch (e) { return null; }
}

function findEntityId(objAddr, label, maxOff) {
    if (!objAddr || objAddr.isNull()) return;
    for (let off = 0; off < maxOff; off += 4) {
        try {
            const val = readS32(objAddr.add(off));
            if (val > 10000 && val < 9999999) {
                const prev = readS32(objAddr.add(off - 4));
                const next = readS32(objAddr.add(off + 4));
                console.log("  [[" + label + "]] entity_id? @ +0x" + off.toString(16) + " = " + val + " (prev=" + prev + ", next=" + next + ")");
            }
        } catch (e) {}
    }
}

function findIl2cppClassName(klassAddr) {
    if (!klassAddr || klassAddr.isNull()) return;
    // In il2cpp, Il2CppClass has: name at various offsets depending on version
    // Try common patterns
    const offsets = [0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48, 0x50, 0x58, 0x60];
    for (let ci of offsets) {
        try {
            const maybeStrPtr = readPtr(klassAddr.add(ci));
            if (maybeStrPtr && !maybeStrPtr.isNull()) {
                // Try direct string read
                const direct = maybeStrPtr.readCString();
                if (direct && direct.length > 1 && direct.length < 80) {
                    console.log("  klass+0x" + ci.toString(16) + " (direct): \\"" + direct + "\\"");
                }
                // Try as pointer to pointer to string
                const maybeStrPtr2 = readPtr(maybeStrPtr);
                if (maybeStrPtr2 && !maybeStrPtr2.isNull()) {
                    const indirect = maybeStrPtr2.readCString();
                    if (indirect && indirect.length > 1 && indirect.length < 80 && indirect !== direct) {
                        console.log("  klass+0x" + ci.toString(16) + " (indirect): \\"" + indirect + "\\"");
                    }
                }
            }
        } catch (e) {}
    }
}

rpc.exports = {
    exploreTransform: function() {
        console.log("\\n" + "=".repeat(70));
        console.log("TRANSFORM EXPLORER v2");
        console.log("PID: " + pid);
        console.log("Transform data addr: " + transformAddr);
        console.log("=".repeat(70));

        // 1. Read backward for il2cpp object header
        console.log("\\n=== il2cpp Object Header ===");
        for (let off = 0x08; off <= 0x20; off += 8) {
            try {
                const testAddr = transformAddr.add(-off);
                console.log("\\n--- transformAddr - 0x" + off.toString(16) + " = " + testAddr + " ---");
                console.log(dumpHex(testAddr, 0x20));
                const klass = readPtr(testAddr);
                if (klass && !klass.isNull()) {
                    console.log("  [PTR at +0x00] = " + klass);
                    // Check if this looks like a klass pointer (would point to GASM or similar)
                    if (klass.toString().startsWith("0x79")) {
                        console.log("  -> Looks like a valid heap pointer. Checking for class name...");
                        findIl2cppClassName(klass);
                    }
                }
                const monitor = readPtr(testAddr.add(0x08));
                if (monitor && !monitor.isNull()) {
                    console.log("  [PTR at +0x08] = " + monitor);
                }
            } catch (e) {
                console.log("  Error at -0x" + off.toString(16) + ": " + e.message);
            }
        }

        // 2. Follow +0x50 pointer
        console.log("\\n=== Follow +0x50 -> " + ptrAt50 + " ===");
        console.log(dumpHex(ptrAt50, 0x80));

        // Check if this is a GameObject or similar
        console.log("\\n--- Scanning ptrAt50 structure ---");
        findEntityId(ptrAt50, "ptrAt50", 0x100);

        // Check klass at ptrAt50
        const klass50 = readPtr(ptrAt50);
        if (klass50 && !klass50.isNull()) {
            console.log("\\n--- ptrAt50 klass @ " + klass50 + " ---");
            console.log(dumpHex(klass50, 0x40));
            findIl2cppClassName(klass50);
        }

        // 3. Scan GameObject nearby structures
        // Check ptrAt50 - 0x10 (il2cpp object header)
        console.log("\\n=== ptrAt50 - il2cpp header scan ===");
        for (let off = 0x08; off <= 0x20; off += 8) {
            try {
                const testAddr = ptrAt50.add(-off);
                const klass = readPtr(testAddr);
                if (klass && !klass.isNull()) {
                    console.log("\\n--- ptrAt50 - 0x" + off.toString(16) + " = " + testAddr + " klass=" + klass + " ---");
                    console.log(dumpHex(testAddr, 0x30));
                    findIl2cppClassName(klass);
                }
            } catch (e) {}
        }

        // 4. Follow all non-null ptrs in the transform data
        console.log("\\n=== All pointers in transform data ===");
        for (let off = 0; off < 0x60; off += 8) {
            try {
                const ptrVal = readPtr(transformAddr.add(off));
                if (ptrVal && !ptrVal.isNull() && ptrVal > 0x1000) {
                    const hex = ptrVal.toString();
                    if (hex.startsWith("0x79") || hex.startsWith("0x7")) {
                        console.log("  +0x" + off.toString(16) + " -> " + ptrVal + " (heap)");
                    }
                }
            } catch (e) {}
        }

        // 5. Try to read the whole il2cpp object that contains our Vector3
        // In Unity Transform, the managed object has klass ptr at -0x10
        console.log("\\n=== Full Transform object dump (with klass header) ===");
        const objStart = transformAddr.add(-0x10);
        console.log("Object start @ " + objStart);
        console.log(dumpHex(objStart, 0x80));
        
        const kObj = readPtr(objStart);
        if (kObj && !kObj.isNull()) {
            console.log("\\n  Klass @ " + kObj);
            findIl2cppClassName(kObj);
        }
        findEntityId(objStart, "Transform_obj", 0x100);

        console.log("\\n" + "=".repeat(70) + "\\n");
        return "DONE";
    }
};
""" % (PID, hex(TRANSFORM_ADDR), hex(PTR_AT_50))

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(js_code)
    script.load()
    print("[*] Exploring Transform structure v2...")
    output = script.exports_sync.explore_transform()
    print(output)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}")
