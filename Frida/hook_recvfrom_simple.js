// hook_recvfrom_simple.js
// Tолько размеры пакетов, без чтения данных
var recvfrom = Module.findExportByName("libc.so.6", "recvfrom");
if (!recvfrom) {
    console.log("[!] recvfrom not found in libc");
} else {
    console.log("[+] recvfrom at: " + recvfrom);
    var count = 0;
    Interceptor.attach(recvfrom, {
        onEnter: function(args) {
            this.len = args[2].toInt32();
            this.flags = args[3].toInt32();
        },
        onLeave: function(retval) {
            var received = retval.toInt32();
            if (received > 20) {
                count++;
                console.log("[recv] #" + count + " len=" + received);
                if (count >= 20) {
                    console.log("[+] Got 20 packets, stopping");
                }
            }
        }
    });
}

var modules = Process.enumerateModules();
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "UnityPlayer.so") {
        var getname = modules[i].base.add(0x9F1900);
        Interceptor.attach(getname, {
            onEnter: function(args) { this.obj = args[0]; },
            onLeave: function(retval) {
                if (retval && !retval.isNull()) {
                    try {
                        var name = retval.readUtf8String();
                        if (name && (name.includes("RemotePlayer") || name.includes("LocalPlayer") || name.includes("LocalActor"))) {
                            console.log("[name] " + name);
                        }
                    } catch (e) {}
                }
            }
        });
        console.log("[+] GetName hooked");
        break;
    }
}

console.log("[+] Ready");