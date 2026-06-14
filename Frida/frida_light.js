// frida_light.js
// Только GetName + чтение позиции 1 раз в секунду. Без recvfrom.
console.log("[*] Lightweight position reader started");

var UnityPlayer = null;
Process.enumerateModules().forEach(function(m) {
    if (m.name === "UnityPlayer.so") UnityPlayer = m;
});

if (!UnityPlayer) { console.log("[!] UnityPlayer.so not found"); }
else {
    console.log("[+] UnityPlayer base: " + UnityPlayer.base);
    var GetName = UnityPlayer.base.add(0x9F1900);
    var localObj = null;
    
    Interceptor.attach(GetName, {
        onEnter: function(args) { this.obj = args[0]; },
        onLeave: function(retval) {
            if (retval.isNull() || localObj) return;
            try {
                var name = retval.readUtf8String();
                if (name === "LocalPlayerCharacter" || name === "LocalPlayer") {
                    localObj = this.obj;
                    console.log("[+] Found LocalPlayer @ " + localObj);
                }
            } catch(e) {}
        }
    });
    
    setInterval(function() {
        if (!localObj) return;
        try {
            var tptr = localObj.add(0x10).readPointer();
            var offsets = [0x38, 0x40, 0x48, 0x50, 0x80, 0x88, 0x8C, 0x90, 0x94, 0x98, 0xA0];
            for (var i = 0; i < offsets.length; i++) {
                var off = offsets[i];
                try {
                    var x = tptr.add(off).readFloat();
                    var y = tptr.add(off+4).readFloat();
                    var z = tptr.add(off+8).readFloat();
                    if (isFinite(x) && isFinite(y) && isFinite(z) &&
                        Math.abs(x) < 50000 && Math.abs(z) < 50000 && Math.abs(y) < 30 && x > 0 && z > 0 &&
                        !isNaN(x) && !isNaN(y) && !isNaN(z) && (x !== 0 || y !== 0 || z !== 0)) {
                        console.log("[POS] (" + x.toFixed(3) + ", " + y.toFixed(3) + ", " + z.toFixed(3) + ") [t+0x" + off.toString(16) + "]");
                        break;
                    }
                } catch(e) {}
            }
        } catch(e) {}
    }, 1000);
}
