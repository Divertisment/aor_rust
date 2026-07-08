// hook_recvfrom.js
// sudo frida -n "Albion-Online" -l hook_recvfrom.js -q -t 120
// Хукает recvfrom в libc для захвата всех UDP пакетов на порту 5056

var recvfrom = Module.findExportByName("libc.so.6", "recvfrom");
if (!recvfrom) {
    recvfrom = Module.findExportByName("libc.so.6", "__recvfrom");
}

if (recvfrom) {
    console.log("[+] recvfrom at: " + recvfrom);
    Interceptor.attach(recvfrom, {
        onEnter: function(args) {
            // int recvfrom(int sockfd, void *buf, size_t len, int flags,
            //              struct sockaddr *src_addr, socklen_t *addrlen)
            this.buf = args[1];
            this.len = args[2].toInt32();
        },
        onLeave: function(retval) {
            var received = retval.toInt32();
            if (received > 12) { // > photon header
                try {
                    var data = this.buf.readByteArray(Math.min(received, 200));
                    var bytes = new Uint8Array(data);
                    
                    // Photon header: flags + commandCount + timestamp + challenge
                    if (bytes.length > 2) {
                        var peerId = (bytes[0] << 8 | bytes[1]);
                        var flags = bytes[2];
                        var cmdCount = bytes[3];
                        
                        // msgEvent = 4, msgEncrypted = 131
                        var msgType = -1;
                        // Грубо ищем тип сообщения
                        for (var i = 4; i < Math.min(bytes.length, 20); i++) {
                            if (bytes[i] == 4) { msgType = 4; break; }  // Event
                            if (bytes[i] == 2) { msgType = 2; break; }  // Request
                            if (bytes[i] == 3) { msgType = 3; break; }  // Response
                            if (bytes[i] == 131) { msgType = 131; break; }  // Encrypted
                        }
                        
                        if (msgType >= 0 && bytes.length > 20) {
                            var hex = "";
                            for (var i = 0; i < Math.min(bytes.length, 64); i++) {
                                hex += ("0" + bytes[i].toString(16)).slice(-2);
                            }
                            console.log("[recvfrom] len=" + received + " type=" + msgType + " first64: " + hex);
                        }
                    }
                } catch (e) {
                    console.log("[recvfrom] error: " + e);
                }
            }
        }
    });
} else {
    console.log("[!] recvfrom not found");
}

// Также хукаем GameObject::GetName
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
                            console.log("[GetName] " + name);
                        }
                    } catch (e) {}
                }
            }
        });
        console.log("[+] GameObject::GetName hooked");
        break;
    }
}