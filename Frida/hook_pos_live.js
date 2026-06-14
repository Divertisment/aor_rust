// hook_pos_live.js
// Непрерывно читает координаты LocalPlayer + recvfrom
var recvfrom = DebugSymbol.getFunctionByName("recvfrom");
var pktCount = 0;
var localObj = null;
var localPos = null;

var modules = Process.enumerateModules();
var unity = null;
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "UnityPlayer.so") { unity = modules[i]; break; }
}

// Перехватываем GetName чтобы получить адрес LocalPlayerCharacter
if (unity) {
    var GetName = unity.base.add(0x9F1900);
    Interceptor.attach(GetName, {
        onEnter: function(args) { this.obj = args[0]; },
        onLeave: function(retval) {
            if (retval.isNull()) return;
            try {
                var name = retval.readUtf8String();
                if ((name === "LocalPlayerCharacter" || name === "LocalPlayer") && !localObj) {
                    localObj = this.obj;
                    console.log("[+] LocalPlayer GameObject @ " + localObj);
                }
            } catch(e) {}
        }
    });
    console.log("[+] GetName hooked");
}

function tryReadPos() {
    if (!localObj) return null;
    try {
        var tptr = localObj.add(0x10).readPointer();
        // Пробуем разные оффсеты для Transform.position
        var offsets = [0x38, 0x90, 0x48, 0x50, 0x80, 0x88, 0x94, 0x98, 0x9C, 0xA0, 0x40, 0x44, 0x30, 0x34, 0x3C, 0x8C];
        for (var i = 0; i < offsets.length; i++) {
            var off = offsets[i];
            try {
                var x = tptr.add(off).readFloat();
                var y = tptr.add(off+4).readFloat();
                var z = tptr.add(off+8).readFloat();
                if (isFinite(x) && isFinite(y) && isFinite(z) &&
                    Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000 &&
                    (x !== 0 || y !== 0 || z !== 0) &&
                    !isNaN(x) && !isNaN(y) && !isNaN(z)) {
                    return { x: x, y: y, z: z, off: off };
                }
            } catch(e) {}
        }
    } catch(e) {}
    return null;
}

// Таймер раз в 300мс
setInterval(function() {
    var p = tryReadPos();
    if (p) {
        if (!localPos || 
            Math.abs(p.x - localPos.x) > 0.01 || 
            Math.abs(p.y - localPos.y) > 0.01 || 
            Math.abs(p.z - localPos.z) > 0.01) {
            console.log("[POS] X=" + p.x.toFixed(4) + " Y=" + p.y.toFixed(4) + " Z=" + p.z.toFixed(4) + " [t+0x" + p.off.toString(16) + "]");
            localPos = { x: p.x, y: p.y, z: p.z };
        }
    } else if (localObj) {
        // Если объект есть но позиция не читается
        if (!localPos) console.log("[!] LocalPlayer found but can't read position - wrong Transform offset");
    }
}, 300);

// recvfrom с поиском float'ов
if (recvfrom) {
    console.log("[+] recvfrom: " + recvfrom);
    Interceptor.attach(recvfrom, {
        onEnter: function(args) {
            this.fd = args[0].toInt32();
            this.buf = args[1];
            this.maxlen = args[2].toInt32();
        },
        onLeave: function(retval) {
            var got = retval.toInt32();
            if (got < 16 || got > 2000) return;
            pktCount++;
            
            try {
                var peek = this.buf.readByteArray(got);
                var bytes = new Uint8Array(peek);
                var len = bytes.length;
                
                var hex = "";
                for (var i = 0; i < Math.min(len, 48); i++) {
                    hex += ("0" + bytes[i].toString(16)).slice(-2);
                    if (i % 16 === 15 && i < len - 1) hex += "\n    ";
                    else if (i < len - 1) hex += " ";
                }
                
                if (localPos) {
                    for (var off = 0; off <= len - 8; off++) {
                        var buf = new ArrayBuffer(4);
                        var view = new Uint8Array(buf);
                        for (var fi = 0; fi < 4; fi++) view[fi] = bytes[off + fi];
                        var f1 = new Float32Array(buf)[0];
                        for (var fi = 0; fi < 4; fi++) view[fi] = bytes[off + 4 + fi];
                        var f2 = new Float32Array(buf)[0];
                        
                        if (isFinite(f1) && isFinite(f2) && f1 > 0) {
                            var dx = Math.abs(f1 - localPos.x);
                            var dz = Math.abs(f2 - localPos.z);
                            if (dx < 5 && dz < 5) {
                                console.log("[MATCH#" + pktCount + "] off=+" + off + " XZ=(" + f1.toFixed(2) + ", " + f2.toFixed(2) + ")");
                                console.log("    " + hex);
                                break;
                            }
                        }
                    }
                }
            } catch(e) {}
        }
    });
    console.log("[+] recvfrom hooked");
}

console.log("[*] Running - move around so I can detect position...");
