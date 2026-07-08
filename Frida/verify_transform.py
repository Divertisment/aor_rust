import frida, sys

PID = 10994
ADDR = "0x79933c7980d0"

JS = r"""
const pid = %d;
const transformAddr = ptr("%s");

rpc.exports = {
    verifyTransform: function() {
        console.log("\n============================================================");
        console.log("VERIFY TRANSFORM");
        console.log("============================================================");

        const module = Process.findModuleByName("GameAssembly.so");
        if (!module) { console.log("[-] GameAssembly.so not found"); return; }
        console.log("[+] GASM base: " + module.base);

        // Just enumerate exports to find il2cpp_resolve_icall
        console.log("\n[*] Scanning exports for il2cpp_resolve_icall...");
        const exports = module.enumerateExports();
        var found = null;
        exports.forEach(function(e) {
            if (e.name.indexOf("il2cpp_resolve_icall") >= 0) {
                found = e;
                console.log("  FOUND: " + e.name + " @ " + e.address);
            }
        });
        if (!found) {
            console.log("[-] il2cpp_resolve_icall not found in exports");
            console.log("[*] Trying alternative: find export by name...");
            try {
                var alt = Module.findExportByName("GameAssembly.so", "il2cpp_resolve_icall");
                console.log("  findExportByName result: " + alt + " (type: " + typeof(alt) + ")");
            } catch(e) {
                console.log("  findExportByName error: " + e.message);
            }
            return;
        }

        var resolve_icall = found.address;
        console.log("[+] resolve_icall: " + resolve_icall);

        var resolveFn = new NativeFunction(resolve_icall, 'pointer', ['pointer']);
        console.log("[+] NativeFunction created successfully");

        var methods = [
            "UnityEngine.Transform::get_position",
            "UnityEngine.Component::get_gameObject",
            "UnityEngine.Object::get_name"
        ];

        var fnPtrs = {};
        methods.forEach(function(name) {
            var cName = Memory.allocUtf8String(name);
            try {
                var ptr = resolveFn(cName);
                fnPtrs[name] = ptr;
                console.log("  " + name + " -> " + (ptr.isNull() ? "NULL" : ptr.toString()));
            } catch(e) {
                console.log("  " + name + " -> ERROR: " + e.message);
            }
        });

        var getPos = fnPtrs["UnityEngine.Transform::get_position"];
        if (getPos && !getPos.isNull()) {
            console.log("\n--- Testing get_position on E105 @ " + transformAddr + " ---");
            try {
                var f = new NativeFunction(getPos, 'pointer', ['pointer']);
                var r = f(transformAddr);
                var x = r.readFloat();
                var y = r.readFloat(4);
                var z = r.readFloat(8);
                console.log("  Position: (" + x.toFixed(2) + ", " + y.toFixed(2) + ", " + z.toFixed(2) + ")");
            } catch(e) {
                console.log("  get_position FAILED: " + e.message);
            }
        } else {
            console.log("[!] get_position not available or NULL");
        }

        var getGO = fnPtrs["UnityEngine.Component::get_gameObject"];
        if (getGO && !getGO.isNull()) {
            console.log("\n--- Testing get_gameObject on E105 ---");
            try {
                var f2 = new NativeFunction(getGO, 'pointer', ['pointer']);
                var go = f2(transformAddr);
                console.log("  GameObject: " + go);
                if (go && !go.isNull()) {
                    var getName = fnPtrs["UnityEngine.Object::get_name"];
                    if (getName && !getName.isNull()) {
                        var f3 = new NativeFunction(getName, 'pointer', ['pointer']);
                        var ns = f3(go);
                        if (ns && !ns.isNull()) {
                            var len = ns.readU32();
                            if (len > 0 && len < 200) {
                                var nameStr = ns.add(4).readUtf8String(len);
                                console.log("  Name: '" + nameStr + "'");
                            }
                        }
                    }
                }
            } catch(e) {
                console.log("  get_gameObject FAILED: " + e.message);
            }
        } else {
            console.log("[!] get_gameObject not available or NULL");
        }

        console.log("\n============================================================");
        return "DONE";
    }
};
""" % (PID, ADDR)

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS)
    script.load()
    print("[*] Verifying Transform...")
    output = script.exports_sync.verify_transform()
    print("output:", output)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}")
