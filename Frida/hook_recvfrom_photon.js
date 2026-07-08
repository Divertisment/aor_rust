// hook_recvfrom_photon.js
// Перехватывает recvfrom и парсит Photon заголовок
var recvfrom = DebugSymbol.getFunctionByName("recvfrom");
if (!recvfrom) { console.log("[!] recvfrom not found"); }
else {
    console.log("[+] recvfrom: " + recvfrom);
    var count = 0;
    Interceptor.attach(recvfrom, {
        onEnter: function(args) {
            this.fd = args[0].toInt32(); // socket fd
            this.buf = args[1];
            this.maxlen = args[2].toInt32();
        },
        onLeave: function(retval) {
            var got = retval.toInt32();
            if (got < 24) return;
            
            count++;
            try {
                // Читаем первые байты пакета
                var peek = this.buf.readByteArray(Math.min(got, 128));
                var bytes = new Uint8Array(peek);
                
                // Photon header: peerId(2) + flags(1) + cmdCount(1) + timestamp(4) + challenge(4)
                if (bytes.length >= 14) {
                    var peerId = (bytes[0] << 8) | bytes[1];
                    var flags = bytes[2];
                    var cmdCount = bytes[3];
                    
                    // После Photon header идет command (offset 12):
                    // cmdType(1) + channel(1) + flags(1) + reserved(1) + cmdLen(4) + reliableSeq(4) + payload
                    if (bytes.length >= 16) {
                        var cmdType = bytes[12];
                        // cmdLen = bytes[14..17] big-endian
                        var cmdLen = (bytes[14] << 24) | (bytes[15] << 16) | (bytes[16] << 8) | bytes[17];
                        
                        // msgType = bytes[18] (byte after command header)
                        if (bytes.length >= 19) {
                            var msgType = bytes[18];
                            
                            // Filter: msgEvent=4, msgEncrypted=131
                            if (msgType === 4 || msgType === 131) {
                                var evCode = 0;
                                if (bytes.length >= 21) {
                                    if (msgType === 4) evCode = bytes[20]; // Event Code
                                }
                                console.log("[PKT#" + count + "] fd=" + this.fd + " len=" + got + " cmdType=" + cmdType + " msgType=" + msgType + " evCode=" + evCode);
                                
                                // Если Event и подозрительно на KeySync (редкий код)
                                if (msgType === 4 && evCode === 0) {
                                    // Read more to find application event code
                                    for (var off = 21; off < bytes.length - 4; off++) {
                                        // Look for app-level event code marker
                                        // Application event codes use ej() attribute with codes like 595
                                        // They're stored in the event's parameter dictionary
                                    }
                                }
                                
                                // Log first 48 bytes for encrypted events
                                if (msgType === 131) {
                                    var hex = "";
                                    for (var i = 0; i < Math.min(bytes.length, 48); i++) {
                                        hex += ("0" + bytes[i].toString(16)).slice(-2);
                                    }
                                    console.log("  [encrypted] " + hex);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                if (count < 5) console.log("[err] " + e);
            }
        }
    });
    console.log("[+] recvfrom hooked - waiting for Photon events...");
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