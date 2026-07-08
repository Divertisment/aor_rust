import frida, sys, time

PID = 10994

JS = """
rpc.exports = {
    find: function() {
        console.log("============================================================");
        console.log("FIND GAMEOBJECTS BY KLASS NAME + POSITION SCAN");
        console.log("============================================================");

        var module = Process.findModuleByName("GameAssembly.so");
        if (!module) return;
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

        // To find class info: il2cpp_class_get_name
        // Try resolving via icall
        var getClassName = resolveFn(Memory.allocUtf8String("il2cpp::vm::Class::GetName"));
        console.log("Class::GetName via icall: " + (getClassName.isNull() ? "NULL" : getClassName.toString()));

        // Try finding il2cpp exports directly
        exports.forEach(function(e) {
            var n = e.name.toLowerCase();
            if (n.indexOf("class_get_name") >= 0 || (n.indexOf("il2cpp") >= 0 && n.indexOf("class") >= 0 && n.indexOf("name") >= 0)) {
                console.log("  Export: " + e.name + " @ " + e.address);
            }
        });

        // Alternative: read class name directly from klass structure
        // In il2cpp, Il2CppClass has 'name' field at specific offset
        // For Unity 2021+ il2cpp, it's typically at klass+0x10 or klass+0x18 (const char*)
        // Let's look at the klass pointer we found: 0x7993238BAC80
        var knownKlass = ptr("0x7993238bac80");
        console.log("\\n--- Reading klass @ " + knownKlass + " ---");
        for (var off = 0; off < 0x100; off += 8) {
            try {
                var p = knownKlass.add(off).readPointer();
                if (p && !p.isNull()) {
                    // Try to read as C string
                    try {
                        var s = p.readCString();
                        if (s && s.length > 1 && s.length < 100 && s[0] !== '\\x00') {
                            // Check if it looks like a class name
                            console.log("  klass+0x" + off.toString(16) + " -> string: '" + s + "'");
                        }
                    } catch(e) {}
                    // Try as pointer to C string
                    try {
                        var p2 = p.add(0).readPointer();
                        if (p2) {
                            var s2 = p2.readCString();
                            if (s2 && s2.length > 1 && s2.length < 100 && s2[0] !== '\\x00') {
                                var first = s2.charCodeAt(0);
                                if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
                                    console.log("  klass+0x" + off.toString(16) + " -> ptr -> string: '" + s2 + "'");
                                }
                            }
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }

        // Now approach: Hook get_gameObject, for each GameObject, read its klass name directly
        var getGO = resolveFn(Memory.allocUtf8String("UnityEngine.Component::get_gameObject"));
        if (getGO.isNull()) return;
        console.log("\\n[*] Hooking get_gameObject @ " + getGO);

        Interceptor.attach(getGO, {
            onLeave: function(retval) {
                if (retval.isNull()) return;
                // GameObject is an il2cpp object: find klass
                // GameObject_o size depends on version. Try reading klass at various offsets
                var klass = null;
                for (var tryOff = 8; tryOff <= 32; tryOff += 8) {
                    try {
                        var k = retval.add(-tryOff).readPointer();
                        if (k && !k.isNull()) {
                            // Check if k looks like a klass (starts with vtable pointer)
                            var vtable = k.readPointer();
                            if (vtable && !vtable.isNull()) {
                                klass = k;
                                break;
                            }
                        }
                    } catch(e) {}
                }
                if (!klass) return;

                // Read name from klass
                var name = "?";
                for (var off = 0; off < 0x100; off += 8) {
                    try {
                        var p = klass.add(off).readPointer();
                        if (p && !p.isNull()) {
                            try {
                                var s = p.readCString();
                                if (s && s.length > 2 && s.length < 80) {
                                    var fc = s.charCodeAt(0);
                                    if ((fc >= 65 && fc <= 90) || (fc >= 97 && fc <= 122) || fc === 95) {
                                        name = s;
                                        break;
                                    }
                                }
                            } catch(e) {}
                        }
                    } catch(e) {}
                }

                if (name !== "?" && name.indexOf("UnityEngine") < 0 && name.indexOf("System") < 0) {
                    // Try to read position from components
                    for (var off = 0; off < 0x100; off += 8) {
                        try {
                            var comp = retval.add(off).readPointer();
                            if (comp && !comp.isNull()) {
                                var x = comp.readFloat();
                                if (x > 50 && x < 500) {
                                    var y = comp.readFloat(4);
                                    if (y > 50 && y < 500) {
                                        var z = comp.readFloat(8);
                                        console.log("[GAME] name='" + name + "' go=" + retval + " COMPONENT@" + comp + " pos=(" + x.toFixed(1) + "," + y.toFixed(1) + "," + z.toFixed(1) + ")");
                                    }
                                }
                            }
                        } catch(e) {}
                    }
                }
            }
        });

        console.log("[*] Hook active, waiting 30s...");
        return "GO";
    }
};
"""

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS)
    script.load()
    print("[*] Starting...")
    output = script.exports_sync.find()
    print(output)
    time.sleep(30)
    session.detach()
    print("[*] Done")
except Exception as e:
    print(f"[-] Error: {e}")
