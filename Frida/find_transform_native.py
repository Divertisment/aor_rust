import frida, sys

PID = 10994

JS = """
rpc.exports = {
    findTransformFuncs: function() {
        console.log("\\n============================================================");
        console.log("FIND TRANSFORM FUNCTIONS v2");
        console.log("============================================================");

        var module = Process.findModuleByName("GameAssembly.so");
        if (!module) { console.log("GASM not found"); return; }

        // Use enumerateExports to find il2cpp_resolve_icall (confirmed working)
        var exports = module.enumerateExports();
        var resolve_icall = null;
        for (var i = 0; i < exports.length; i++) {
            if (exports[i].name.indexOf("il2cpp_resolve_icall") >= 0) {
                resolve_icall = exports[i].address;
                console.log("[+] il2cpp_resolve_icall @ " + resolve_icall);
                break;
            }
        }
        if (!resolve_icall) { console.log("[-] Not found"); return; }

        var resolveFn = null;
        try {
            resolveFn = new NativeFunction(resolve_icall, 'pointer', ['pointer']);
            console.log("[+] NativeFunction OK");
        } catch(e) {
            console.log("[-] NativeFunction error: " + e.message);
            return;
        }

        // Try various method names to find position
        var names = [
            "UnityEngine.Transform::get_position",
            "UnityEngine.Transform::get_localPosition",
            "UnityEngine.Transform::INTERNAL_get_localPosition",
            "UnityEngine.Transform::INTERNAL_get_position",
            "UnityEngine.Transform::INTERNAL_get_localPosition_Injected",
            "UnityEngine.Transform::INTERNAL_get_position_Injected"
        ];

        for (var j = 0; j < names.length; j++) {
            var cName = Memory.allocUtf8String(names[j]);
            var ptr = resolveFn(cName);
            console.log(names[j] + " -> " + (ptr.isNull() ? "NULL" : ptr.toString()));
        }

        // Now hook get_gameObject which WAS found
        var goName = Memory.allocUtf8String("UnityEngine.Component::get_gameObject");
        var getGO = resolveFn(goName);
        console.log("\\n[+] Component::get_gameObject @ " + getGO);

        if (!getGO.isNull()) {
            console.log("[*] Hooking get_gameObject to capture this pointers...");
            Interceptor.attach(getGO, {
                onEnter: function(args) {
                    var thisAddr = args[0];
                    console.log("\\n[get_gameObject] this = " + thisAddr);
                    // Dump raw bytes at this pointer
                    try {
                        var klass = thisAddr.add(-0x10).readPointer();
                        console.log("  obj-0x10 (klass): " + klass);
                    } catch(e) {}
                    try {
                        var bytes = thisAddr.readByteArray(24);
                        var arr = new Uint8Array(bytes);
                        var hex = "";
                        for (var i = 0; i < 24; i++) {
                            hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
                        }
                        console.log("  bytes: " + hex);
                    } catch(e) {}
                },
                onLeave: function(retval) {
                    console.log("  -> retval: " + retval);
                    if (!retval.isNull()) {
                        try {
                            var nameMethod = Module.findExportByName("GameAssembly.so", "UnityEngine_Object_GetName");
                            if (!nameMethod) {
                                // Try il2cpp_resolve_icall for get_name
                                var getNameFn = resolveFn(Memory.allocUtf8String("UnityEngine.Object::get_name"));
                                if (!getNameFn.isNull()) {
                                    var f3 = new NativeFunction(getNameFn, 'pointer', ['pointer']);
                                    var ns = f3(retval);
                                    if (!ns.isNull()) {
                                        var len = ns.readU32();
                                        if (len > 0 && len < 200) {
                                            var nameStr = ns.add(4).readUtf8String(len);
                                            console.log("  Name: '" + nameStr + "'");
                                        }
                                    }
                                }
                            }
                        } catch(e) {
                            console.log("  get_name error: " + e.message);
                        }
                    }
                }
            });
            console.log("[*] Hook installed, waiting for calls...");
        }

        return "DONE - check console";
    }
};
"""

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS)
    script.load()
    print("[*] Finding and hooking Transform functions...")
    output = script.exports_sync.find_transform_funcs()
    print(output)
    time.sleep(15) if 'time' in dir() else None
    import time
    time.sleep(15)
    session.detach()
    print("[*] Done")
except Exception as e:
    print(f"[-] Error: {e}")
