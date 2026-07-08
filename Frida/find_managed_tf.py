import frida, sys

PID = 10994

JS = """
const pid = %d;

rpc.exports = {
    findtransform: function() {
        console.log("============================================================");
        console.log("Find managed Transform via get_gameObject + m_CachedPtr");
        console.log("============================================================");

        var module = Process.findModuleByName("GameAssembly.so");
        var exports = module.enumerateExports();
        var resolve_icall = null;
        for (var i = 0; i < exports.length; i++) {
            if (exports[i].name.indexOf("il2cpp_resolve_icall") >= 0) {
                resolve_icall = exports[i].address;
                break;
            }
        }
        if (!resolve_icall) return;
        var resolveFn = new NativeFunction(resolve_icall, 'pointer', ['pointer']);

        var getGO = resolveFn(Memory.allocUtf8String("UnityEngine.Component::get_gameObject"));
        if (getGO.isNull()) return;
        console.log("[+] get_gameObject @ " + getGO);

        var seen = {};
        Interceptor.attach(getGO, {
            onEnter: function(args) {
                this.thisAddr = args[0];
            },
            onLeave: function(retval) {
                if (retval.isNull()) return;

                var managedComp = this.thisAddr;
                if (seen[managedComp.toString()]) return;
                seen[managedComp.toString()] = true;

                var mCachedPtr = null;
                try {
                    mCachedPtr = managedComp.add(0x10).readPointer();
                } catch(e) {}

                if (!mCachedPtr || mCachedPtr.isNull()) return;

                // Check if m_CachedPtr looks valid (high address)
                var addrStr = mCachedPtr.toString();
                if (addrStr.length < 14) return; // not a real pointer

                // Check for position at +0x00 (our known offset)
                try {
                    var x = mCachedPtr.readFloat();
                    var y = mCachedPtr.add(4).readFloat();
                    if (x > 50 && x < 500 && y > 50 && y < 500) {
                        var z = mCachedPtr.add(8).readFloat();
                        console.log("\\n=== CANDIDATE @ " + managedComp + " ===");
                        console.log("  m_CachedPtr: " + mCachedPtr);
                        console.log("  pos +0x00: (" + x.toFixed(2) + ", " + y.toFixed(2) + ", " + z.toFixed(2) + ")");
                        console.log("  GameObject: " + retval);

                        // Try to get name from GameObject klass
                        for (var o = 8; o <= 32; o += 8) {
                            try {
                                var k = retval.add(-o).readPointer();
                                if (k && !k.isNull() && k.toString().length >= 14) {
                                    for (var co = 0; co < 0x100; co += 8) {
                                        try {
                                            var p = k.add(co).readPointer();
                                            if (p && !p.isNull()) {
                                                var s = p.readCString();
                                                if (s && s.length > 2 && s.length < 80) {
                                                    var fc = s.charCodeAt(0);
                                                    if ((fc >= 65 && fc <= 90) || (fc >= 97 && fc <= 122)) {
                                                        console.log("  go-0x" + o.toString(16) + ".klass+0x" + co.toString(16) + " -> \\"" + s + "\\"");
                                                    }
                                                }
                                            }
                                        } catch(e) {}
                                    }
                                }
                            } catch(e) {}
                        }

                        // entity_id in GameObject
                        console.log("\\n  entity_id scan (GameObject):");
                        for (var off = 0; off < 0x200; off += 4) {
                            try {
                                var val = retval.add(off).readS32();
                                if (val > 10000 && val < 9999999) {
                                    console.log("    @ +0x" + off.toString(16) + " = " + val);
                                }
                            } catch(e) {}
                        }
                        // entity_id in managed Component
                        console.log("\\n  entity_id scan (Component):");
                        for (var off = 0; off < 0x100; off += 4) {
                            try {
                                var val = managedComp.add(off).readS32();
                                if (val > 10000 && val < 9999999) {
                                    console.log("    @ +0x" + off.toString(16) + " = " + val);
                                }
                            } catch(e) {}
                        }

                        console.log("\\n---");
                    }
                } catch(e) {}
            }
        });

        console.log("[*] Hook active, waiting 30s...");
        return "HOOKED";
    }
};
""" % PID

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS)
    script.load()
    print("[*] Starting...")
    output = script.exports_sync.findtransform()
    print(output)
    import time
    time.sleep(30)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}")
