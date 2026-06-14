// hook_recvfrom_raw.js
// recvfrom: показывает ВСЕ пакеты в hex
var recvfrom = DebugSymbol.getFunctionByName("recvfrom");
if (!recvfrom) { console.log("[!] recvfrom not found"); }
else {
    console.log("[+] recvfrom: " + recvfrom);
    var count = 0;
    Interceptor.attach(recvfrom, {
        onEnter: function(args) {
            this.fd = args[0].toInt32();
            this.buf = args[1];
            this.maxlen = args[2].toInt32();
        },
        onLeave: function(retval) {
            var got = retval.toInt32();
            if (got < 16) return;
            count++;
            
            try {
                var peek = this.buf.readByteArray(Math.min(got, 64));
                var bytes = new Uint8Array(peek);
                
                // HEX первой строки
                var hex = "";
                for (var i = 0; i < bytes.length; i++) {
                    hex += ("0" + bytes[i].toString(16)).slice(-2);
                    if (i % 16 === 15 && i < bytes.length - 1) hex += "\n    ";
                    else if (i < bytes.length - 1) hex += " ";
                }
                
                // ASCII
                var ascii = "";
                for (var i = 0; i < bytes.length; i++) {
                    var c = bytes[i];
                    ascii += (c >= 0x20 && c <= 0x7E) ? String.fromCharCode(c) : ".";
                }
                
                console.log("[PKT#" + count + "] fd=" + this.fd + " len=" + got);
                console.log("    " + hex);
                if (ascii.trim().length > 0) console.log("    " + ascii);
            } catch (e) {
                if (count < 5) console.log("[err] " + e);
            }
        }
    });
    console.log("[+] recvfrom hooked - logging all packets...");
}

// GetName hook
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
