import frida, sys

PID = 10994
NATIVE_TF = 0x79933C7980D0

JS_CODE = """
const pid = %d;
const natTf = ptr("%s");

rpc.exports = {
    readgo: function() {
        console.log("============================================================");
        console.log("Read GameObject* from native Transform +0x20");
        console.log("============================================================");

        console.log("Native Transform @ " + natTf);
        console.log("");

        // Read full struct
        console.log("--- Full dump (0x60 bytes) ---");
        try {
            var bytes = natTf.readByteArray(0x60);
            var arr = new Uint8Array(bytes);
            var hex = "";
            for (var i = 0; i < 0x60; i++) {
                if (i % 16 === 0) hex += "\\n  +" + i.toString(16).padStart(4,"0") + ": ";
                hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
            }
            console.log(hex);
        } catch(e) { console.log("ERROR: " + e.message); }

        // Read specific fields
        console.log("");
        console.log("--- Fields ---");
        console.log("  +0x00 X: " + natTf.readFloat().toFixed(2));
        console.log("  +0x04 Y: " + natTf.add(4).readFloat().toFixed(2));
        console.log("  +0x08 Z: " + natTf.add(8).readFloat().toFixed(2));
        try {
            var th = natTf.add(0x10).readPointer();
            console.log("  +0x10 TransformHierarchy*: " + th);
        } catch(e) {}
        console.log("  +0x18 m_TransformIndex: " + natTf.add(0x18).readS32());
        console.log("  +0x1C m_ParentIndex: " + natTf.add(0x1C).readS32());

        var goPtr = null;
        try {
            goPtr = natTf.add(0x20).readPointer();
            console.log("  +0x20 GameObject*: " + goPtr);
        } catch(e) { console.log("  +0x20 ERROR: " + e.message); }

        // Also try reading at natTf - 0x28 (where native Object might start)
        var objStart = natTf.add(-0x28);
        console.log("");
        console.log("--- Native Object candidate @ natTf-0x28 = " + objStart + " ---");
        try {
            var objBytes = objStart.readByteArray(0x60);
            var arr = new Uint8Array(objBytes);
            var hex = "";
            for (var i = 0; i < 0x60; i++) {
                if (i % 16 === 0) hex += "\\n  +" + i.toString(16).padStart(4,"0") + ": ";
                hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
            }
            console.log(hex);
        } catch(e) { console.log("  ERROR: " + e.message); }

        // Check vtable at +0x00
        try {
            var vt = objStart.readPointer();
            console.log("  +0x00 vtable: " + vt);
            // Check if vtable looks valid (points to GASM or UnityPlayer)
            var vtMod = Process.findModuleByAddress(vt);
            if (vtMod) console.log("  vtable module: " + vtMod.name);
        } catch(e) {}
        console.log("  +0x08 m_InstanceID: " + objStart.add(8).readS32());
        console.log("  +0x0C m_Bits: " + objStart.add(0xC).readU32());
        var tfH = null;
        try { tfH = objStart.add(0x10).readPointer(); } catch(e) {}
        if (tfH) console.log("  +0x10 TransformHierarchy*: " + tfH);
        console.log("  +0x18 m_TransformIndex: " + objStart.add(0x18).readS32());
        console.log("  +0x1C m_ParentIndex: " + objStart.add(0x1C).readS32());
        var goPtr2 = null;
        try { goPtr2 = objStart.add(0x20).readPointer(); } catch(e) {}
        if (goPtr2) console.log("  +0x20 GameObject*: " + goPtr2);

        // If GameObject path works through objStart, use it
        if (goPtr2 && !goPtr2.isNull() && goPtr2 > 0x100000000000) {
            goPtr = goPtr2;
            console.log("  -> Using GameObject from objStart+0x20");
        }

        // If GameObject is valid, read some fields
        if (goPtr && !goPtr.isNull() && goPtr > 0x100000000000) {
            console.log("");
            console.log("--- GameObject @ " + goPtr + " ---");
            try {
                var goBytes = goPtr.readByteArray(0x40);
                var arr = new Uint8Array(goBytes);
                var hex = "";
                for (var i = 0; i < 0x40; i++) {
                    if (i % 16 === 0) hex += "\\n  +" + i.toString(16).padStart(4,"0") + ": ";
                    hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
                }
                console.log(hex);
            } catch(e) { console.log("  ERROR: " + e.message); }

            // Find klass from GameObject (il2cpp object at goPtr or goPtr-0x10)
            for (var off = 0; off <= 0x10; off += 8) {
                try {
                    var k = goPtr.add(-off).readPointer();
                    if (k && !k.isNull() && k.toString().length >= 14) {
                        // Check if it has a vtable
                        try {
                            var vt = k.readPointer();
                            if (vt && !vt.isNull()) {
                                console.log("  Klass candidate at go-0x" + off.toString(16) + ": " + k);
                                // Find class name
                                for (var co = 0; co < 0x100; co += 8) {
                                    try {
                                        var p = k.add(co).readPointer();
                                        if (p && !p.isNull()) {
                                            var s = p.readCString();
                                            if (s && s.length > 2 && s.length < 80) {
                                                var fc = s.charCodeAt(0);
                                                if ((fc >= 65 && fc <= 90) || (fc >= 97 && fc <= 122)) {
                                                    console.log("    -> klass+0x" + co.toString(16) + " string: '" + s + "'");
                                                }
                                            }
                                        }
                                    } catch(e) {}
                                }
                                break;
                            }
                        } catch(e) {}
                    }
                } catch(e) {}
            }
        } else {
            console.log("  +0x20 is NOT a valid heap pointer (value= " + (goPtr ? goPtr.toString() : "null") + ")");
            // Try alternative offsets for GameObject ptr
            console.log("");
            console.log("--- Scanning for GameObject ptr at other offsets ---");
            for (var off = 0x28; off <= 0x60; off += 8) {
                try {
                    var p = natTf.add(off).readPointer();
                    if (p && !p.isNull() && p > 0x100000000000) {
                        console.log("  +0x" + off.toString(16) + " -> " + p);
                        // Check if it has klass at -0x10
                        try {
                            var k = p.add(-0x10).readPointer();
                            if (k && !k.isNull() && k > 0x100000000000) {
                                console.log("    has klass candidate at -0x10: " + k);
                            }
                        } catch(e) {}
                        // Check if it has VTable at -0x00
                        try {
                            var vt = p.readPointer();
                            if (vt && !vt.isNull() && vt > 0x100000000000) {
                                console.log("    first 8 bytes (vtable?): " + vt);
                            }
                        } catch(e) {}
                    }
                } catch(e) {}
            }
        }

        console.log("");
        console.log("============================================================");
        return "DONE";
    }
};
""" % (PID, hex(NATIVE_TF))

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS_CODE)
    script.load()
    print("[*] Reading...")
    output = script.exports_sync.readgo()
    print(output)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}")
