import frida, time, sys

PID = 10994

JS_CODE = """
var icallAddr = ptr("0x79956301bfc0");
console.log("[*] Hooking Component::get_gameObject @ " + icallAddr);

try {
    Interceptor.attach(icallAddr, {
        onEnter: function(args) {
            console.log("\\n[get_gameObject] args[0] = " + args[0] + " args[1] = " + args[1]);
            
            // Check if args[0] is an Il2CppObject (has klass pointer)
            try {
                var klass = args[0].readPointer();
                if (klass > 0x100000000000) {
                    console.log("  klass = " + klass);
                    // Find class name
                    for (var co = 0; co < 0x100; co += 8) {
                        try {
                            var p = klass.add(co).readPointer();
                            if (p && !p.isNull()) {
                                var s = p.readCString();
                                if (s && s.length > 2 && s.length < 60) {
                                    var fc = s.charCodeAt(0);
                                    if ((fc >= 65 && fc <= 90) || (fc >= 97 && fc <= 122)) {
                                        console.log("    klass+" + co.toString(16) + ": '" + s + "'");
                                    }
                                }
                            }
                        } catch(e) {}
                    }
                }
            } catch(e) {}
            
            // Try m_CachedPtr at +0x10 (native ptr)
            try {
                var cachedPtr = args[0].add(0x10).readPointer();
                console.log("  m_CachedPtr(+0x10) = " + cachedPtr);
                if (cachedPtr > 0x100000000000) {
                    var vt = cachedPtr.readPointer();
                    console.log("  native->vtable = " + vt);
                    var vtMod = Process.findModuleByAddress(vt);
                    if (vtMod) console.log("  native vtable module: " + vtMod.name);
                    console.log("  native->+0x08 InstanceID = " + cachedPtr.add(8).readS32());
                    console.log("  native->+0x0C Bits = " + cachedPtr.add(0xC).readU32());
                    console.log("  native->+0x10 ptr = " + cachedPtr.add(0x10).readPointer());
                    console.log("  native->+0x18 ptr = " + cachedPtr.add(0x18).readPointer());
                    console.log("  native->+0x20 s32 = " + cachedPtr.add(0x20).readS32());
                    console.log("  native->+0x24 s32 = " + cachedPtr.add(0x24).readS32());
                    console.log("  native->+0x28 f = " + cachedPtr.add(0x28).readFloat().toFixed(2));
                    console.log("  native->+0x2C f = " + cachedPtr.add(0x2C).readFloat().toFixed(2));
                    console.log("  native->+0x30 f = " + cachedPtr.add(0x30).readFloat().toFixed(2));
                    console.log("  native->+0x34 f = " + cachedPtr.add(0x34).readFloat().toFixed(2));
                    console.log("  native->+0x38 f = " + cachedPtr.add(0x38).readFloat().toFixed(2));
                }
            } catch(e) {}
            
            // Also try args[1] as native this
            try {
                if (args[1] > 0x100000000000) {
                    var vt = args[1].readPointer();
                    if (vt > 0x100000000000) {
                        console.log("  args[1] vtable = " + vt);
                        console.log("  args[1]+0x08 = " + args[1].add(8).readS32());
                        console.log("  args[1]+0x0C = " + args[1].add(0xC).readU32());
                    }
                }
            } catch(e) {}
        },
        onLeave: function(retval) {
            console.log("  returned: " + retval);
        }
    });
    console.log("[*] Hook installed!");
} catch(e) {
    console.log("[*] Hook error: " + e);
}
console.log("[*] Waiting for calls...");
"""

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS_CODE)
    script.load()
    print("[*] Hook running...", flush=True)
    time.sleep(15)
    session.detach()
    print("[*] Done")
except Exception as e:
    print(f"[-] Error: {e}", file=sys.stderr)
