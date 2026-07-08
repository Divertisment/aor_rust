import frida, sys

PID = 10994

JS = """
rpc.exports = {
    hookTransform: function() {
        console.log("\\n============================================================");
        console.log("HOOK Transform calls");
        console.log("PID: %d");
        console.log("============================================================");

        const module = Process.findModuleByName("GameAssembly.so");
        if (!module) { console.log("GameAssembly.so not found"); return; }

        // Find il2cpp_resolve_icall
        var resolve_icall = null;
        var exports = module.enumerateExports();
        exports.forEach(function(e) {
            if (e.name.indexOf("il2cpp_resolve_icall") >= 0) {
                resolve_icall = e.address;
            }
        });
        if (!resolve_icall) { console.log("resolve_icall not found"); return; }

        var resolveFn = new NativeFunction(resolve_icall, 'pointer', ['pointer']);

        // Resolve get_position
        var posName = Memory.allocUtf8String("UnityEngine.Transform::get_position");
        var getPos = resolveFn(posName);
        console.log("Transform::get_position @ " + getPos);

        var goName = Memory.allocUtf8String("UnityEngine.Component::get_gameObject");
        var getGO = resolveFn(goName);
        console.log("Component::get_gameObject @ " + getGO);

        if (getPos.isNull() || getGO.isNull()) {
            console.log("Methods not resolved, trying Interceptor directly...");
            return;
        }

        console.log("\\n[*] Hooking Transform::get_position...");
        Interceptor.attach(getPos, {
            onEnter: function(args) {
                var thisAddr = args[0];
                console.log("\\n[get_position] this = " + thisAddr);
                // Read position from memory (this + 0x40 is where Unity stores localPosition in native Transform)
                try {
                    var x = thisAddr.add(0x40).readFloat();
                    var y = thisAddr.add(0x44).readFloat();
                    var z = thisAddr.add(0x48).readFloat();
                    console.log("  Position from memory (+0x40): (" + x.toFixed(2) + ", " + y.toFixed(2) + ", " + z.toFixed(2) + ")");
                } catch(e) {}
                // Also dump klass ptr
                try {
                    var klass = thisAddr.add(-0x10).readPointer();
                    console.log("  Klass (obj-0x10): " + klass);
                } catch(e) {}
                try {
                    var klass2 = thisAddr.add(-0x08).readPointer();
                    console.log("  Klass (obj-0x08): " + klass2);
                } catch(e) {}
                // Dump first bytes
                try {
                    var bytes = thisAddr.readByteArray(32);
                    var arr = new Uint8Array(bytes);
                    var hex = "";
                    for (var i = 0; i < 16; i++) {
                        hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
                    }
                    console.log("  First 16 bytes: " + hex);
                } catch(e) {}
            }
        });

        console.log("[*] Hooking Component::get_gameObject...");
        Interceptor.attach(getGO, {
            onEnter: function(args) {
                var thisAddr = args[0];
                console.log("\\n[get_gameObject] this = " + thisAddr);
                try {
                    var bytes = thisAddr.readByteArray(16);
                    var arr = new Uint8Array(bytes);
                    var hex = "";
                    for (var i = 0; i < 16; i++) {
                        hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
                    }
                    console.log("  First 16 bytes: " + hex);
                } catch(e) {}
            },
            onLeave: function(retval) {
                console.log("  -> GameObject: " + retval);
            }
        });

        console.log("\\n[*] Waiting 15 seconds for Transform calls...");
        return "Hooks installed, check console output above";
    }
};
""" % PID

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS)
    script.load()
    print("[*] Installing hooks...")
    output = script.exports_sync.hook_transform()
    print(output)
    import time
    time.sleep(15)
    session.detach()
    print("[*] Done")
except Exception as e:
    print(f"[-] Error: {e}")
