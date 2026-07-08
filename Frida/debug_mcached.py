import frida, sys, time

PID = 10994

JS = """
const pid = %d;

rpc.exports = {
    debug: function() {
        console.log("============================================================");
        console.log("DEBUG: dump m_CachedPtr for all get_gameObject calls");
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
        if (!resolve_icall) { console.log("resolve_icall not found"); return; }
        var resolveFn = new NativeFunction(resolve_icall, 'pointer', ['pointer']);

        var getGO = resolveFn(Memory.allocUtf8String("UnityEngine.Component::get_gameObject"));
        if (getGO.isNull()) { console.log("get_gameObject NULL"); return; }

        var count = 0;
        Interceptor.attach(getGO, {
            onEnter: function(args) {
                this.thisAddr = args[0];
            },
            onLeave: function(retval) {
                count++;
                if (count > 500) return; // limit

                var mc = this.thisAddr;
                if (retval.isNull()) return;

                // Read raw data at managed Component + multiple offsets
                var mcStr = mc.toString();
                
                // Read ptr fields at common offsets
                var p0x08 = "err", p0x10 = "err", p0x18 = "err";
                try { p0x08 = mc.add(0x08).readPointer().toString(); } catch(e) {}
                try { p0x10 = mc.add(0x10).readPointer().toString(); } catch(e) {}
                try { p0x18 = mc.add(0x18).readPointer().toString(); } catch(e) {}

                // Check if ptr at +0x10 has position at +0x00
                var hasPos = false;
                try {
                    var p = mc.add(0x10).readPointer();
                    if (!p.isNull()) {
                        var x = p.readFloat();
                        var y = p.add(4).readFloat();
                        if (x > 50 && x < 500 && y > 50 && y < 500) {
                            hasPos = true;
                        }
                    }
                } catch(e) {}

                // Also try +0x18 as m_CachedPtr (maybe different field order)
                var hasPos18 = false;
                try {
                    var p2 = mc.add(0x18).readPointer();
                    if (!p2.isNull()) {
                        var x2 = p2.readFloat();
                        var y2 = p2.add(4).readFloat();
                        if (x2 > 50 && x2 < 500 && y2 > 50 && y2 < 500) {
                            hasPos18 = true;
                        }
                    }
                } catch(e) {}

                if (hasPos || hasPos18 || count <= 30) {
                    console.log("this=" + mc + " +0x08=" + p0x08 + " +0x10=" + p0x10 + " +0x18=" + p0x18 + 
                        (hasPos ? " ***POS at +0x10's target+0x00***" : "") +
                        (hasPos18 ? " ***POS at +0x18's target+0x00***" : ""));
                }
            }
        });

        console.log("[*] Hook active, waiting 20s...");
        return "GO";
    }
};
""" % PID

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS)
    script.load()
    print("[*] Debug...")
    output = script.exports_sync.debug()
    print(output)
    time.sleep(20)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}")
