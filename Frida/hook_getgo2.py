import frida, time, sys

PID = 10994

JS_CODE = """
var icallAddr = ptr("0x79956301bfc0");
console.log("[*] Hooking Component::get_gameObject @ " + icallAddr);

try {
    Interceptor.attach(icallAddr, {
        onEnter: function(args) {
            var managedThis = args[0];
            
            // Read klass to identify object type
            try {
                var klass = managedThis.readPointer();
                // Find class name from klass
                for (var co = 0; co < 0x100; co += 8) {
                    try {
                        var p = klass.add(co).readPointer();
                        if (p && !p.isNull()) {
                            var s = p.readCString();
                            if (s && s.length > 2 && s.length < 60) {
                                var fc = s.charCodeAt(0);
                                if ((fc >= 65 && fc <= 90) || (fc >= 97 && fc <= 122)) {
                                    console.log("\\n[get_go] " + s + "  managed=" + managedThis);
                                    break;
                                }
                            }
                        }
                    } catch(e) {}
                }
            } catch(e) {}
            
            // Read native ptr
            try {
                var cachedPtr = managedThis.add(0x10).readPointer();
                if (cachedPtr > 0x100000000000) {
                    console.log("  native=" + cachedPtr + " vt=" + cachedPtr.readPointer());
                    // Read higher offsets
                    for (var off = 0x00; off <= 0x80; off += 8) {
                        try {
                            var val = cachedPtr.add(off);
                            var u64 = val.readU64();
                            var f = val.readFloat();
                            // Print if it looks like a small float (potential position)
                            if (f > 0 && f < 2000 && off >= 0x40) {
                                console.log("  +" + off.toString(16) + " f=" + f.toFixed(2) + " u64=0x" + u64.toString(16));
                            }
                        } catch(e) {}
                    }
                    
                    // Specifically dump sectors with potential Vector3 data
                    // Check every 4 bytes from +0x40 to +0x80
                    console.log("  Float scan from +0x40:");
                    var line = "";
                    for (var off = 0x40; off <= 0x80; off += 4) {
                        try {
                            var f = cachedPtr.add(off).readFloat();
                            if (f > 0 && f < 2000) {
                                line += " +" + off.toString(16) + "=" + f.toFixed(1);
                            }
                        } catch(e) {}
                    }
                    if (line.length > 0) console.log("   " + line);
                }
            } catch(e) {}
        }
    });
    console.log("[*] Hook installed!");
} catch(e) {
    console.log("[*] Hook error: " + e);
}
console.log("[*] Waiting...");
"""

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS_CODE)
    script.load()
    print("[*] Running...", flush=True)
    time.sleep(15)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}", file=sys.stderr)
