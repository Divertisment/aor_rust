// hook_recvfrom_v2.js
var modules = Process.enumerateModules();
var libc = null;
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name.indexOf("libc") >= 0) {
        libc = modules[i];
        console.log("[+] libc: " + libc.name + " @ " + libc.base);
        break;
    }
}

if (libc) {
    var recvfrom = libc.base.add(0); // placeholder, need offset
    // Try to find recvfrom by scanning exports
    var recvfrom = Module.findExportByName(libc.name, "recvfrom");
    if (!recvfrom) recvfrom = Module.findExportByName(libc.name, "__recvfrom");
    
    if (recvfrom) {
        console.log("[+] recvfrom at: " + recvfrom);
        var count = 0;
        Interceptor.attach(recvfrom, {
            onEnter: function(args) { this.len = args[2].toInt32(); },
            onLeave: function(retval) {
                var r = retval.toInt32();
                if (r > 24) { count++; console.log("[recv] #" + count + " len=" + r); }
            }
        });
    } else {
        console.log("[!] recvfrom export not found in libc");
    }
} else {
    console.log("[!] libc not found");
}

// GetName
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