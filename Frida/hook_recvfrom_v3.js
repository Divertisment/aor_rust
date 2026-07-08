// hook_recvfrom_v3.js
// Используем DebugSymbol для поиска recvfrom
var recvfrom = null;
try {
    recvfrom = DebugSymbol.getFunctionByName("recvfrom");
    console.log("[+] recvfrom via DebugSymbol: " + recvfrom);
} catch (e) {
    console.log("[!] DebugSymbol.getFunctionByName failed: " + e);
    // Fallback: enumerate libc exports
    var modules = Process.enumerateModules();
    for (var i = 0; i < modules.length; i++) {
        if (modules[i].name.indexOf("libc") >= 0) {
            var exports = Module.enumerateExports(modules[i].name);
            for (var j = 0; j < exports.length; j++) {
                if (exports[j].name.indexOf("recvfrom") >= 0 || exports[j].name.indexOf("recv") >= 0) {
                    console.log("  export: " + exports[j].name + " @ " + exports[j].address);
                }
            }
            break;
        }
    }
}

if (recvfrom) {
    var count = 0;
    Interceptor.attach(recvfrom, {
        onEnter: function(args) { this.len = args[2].toInt32(); },
        onLeave: function(retval) {
            var r = retval.toInt32();
            if (r > 24) { count++; console.log("[recv] #" + count + " len=" + r); }
        }
    });
    console.log("[+] recvfrom hooked");
} else {
    console.log("[!] recvfrom hook failed");
}

// GetName
var modules = Process.enumerateModules();
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "UnityPlayer.so") {
        var gn = modules[i].base.add(0x9F1900);
        Interceptor.attach(gn, {
            onEnter: function(a) { this.o = a[0]; },
            onLeave: function(r) {
                if (r && !r.isNull()) {
                    try {
                        var n = r.readUtf8String();
                        if (n && (n.includes("Remote") || n.includes("Local") || n.includes("Actor")))
                            console.log("[name] " + n);
                    } catch(e) {}
                }
            }
        });
        console.log("[+] GetName hooked");
        break;
    }
}

console.log("[+] Ready");