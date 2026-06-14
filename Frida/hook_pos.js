// hook_pos.js
// Читает локальные координаты + ищет совпадающие float'ы в recvfrom пакетах

var recvfrom = DebugSymbol.getFunctionByName("recvfrom");
var pktCount = 0;
var localPos = null; // [x, y, z]

function bytesToFloats(bytes, off, count) {
    var result = [];
    for (var i = 0; i < count; i++) {
        var b = bytes.slice(off + i*4, off + i*4 + 4);
        if (b.length < 4) break;
        var buf = new ArrayBuffer(4);
        var view = new Uint8Array(buf);
        view[0] = b[0]; view[1] = b[1]; view[2] = b[2]; view[3] = b[3];
        var f = new Float32Array(buf)[0];
        if (isFinite(f) && Math.abs(f) < 100000) result.push(f);
    }
    return result;
}

function diff(a, b) {
    return Math.abs(a - b);
}

// ---- поиск LocalPlayer ----
var modules = Process.enumerateModules();
var unity = null;
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "UnityPlayer.so") { unity = modules[i]; break; }
}

if (unity) {
    var GetName = unity.base.add(0x9F1900);
    Interceptor.attach(GetName, {
        onEnter: function(args) { this.obj = args[0]; },
        onLeave: function(retval) {
            if (retval.isNull()) return;
            try {
                var name = retval.readUtf8String();
                if (name === "LocalPlayerCharacter" || name === "LocalPlayer") {
                    var tptr = this.obj.add(0x10).readPointer();
                    function tryPos(off) {
                        try {
                            var p = [tptr.add(off).readFloat(), tptr.add(off+4).readFloat(), tptr.add(off+8).readFloat()];
                            if (isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2]) && Math.abs(p[0]) < 100000) {
                                localPos = p;
                                console.log("[POS] LocalPlayer @ (" + p[0].toFixed(2) + ", " + p[1].toFixed(2) + ", " + p[2].toFixed(2) + ") [t+0x" + off.toString(16) + "]");
                                return true;
                            }
                        } catch(e) {}
                        return false;
                    }
                    for (var off = 0x38; off <= 0xA0; off += 4) { if (tryPos(off)) break; }
                }
            } catch(e) {}
        }
    });
    console.log("[+] GetName hooked");
}

// ---- recvfrom хук с поиском float'ов ----
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
                
                // Сканируем пакет на float'ы рядом с localPos
                var matchFound = false;
                var matchInfo = "";
                if (localPos) {
                    for (var off = 0; off <= len - 12; off++) {
                        var f = bytesToFloats(bytes, off, 3);
                        if (f.length >= 2) {
                            var dx = diff(f[0], localPos[0]);
                            var dz = diff(f[1], localPos[2]);
                            // Albion: X и Z — горизонтальные координаты (Y = высота)
                            if (dx < 5 && dz < 5 && f[0] > 0 && f[0] < 10000) {
                                matchFound = true;
                                matchInfo = " [MATCH XZ at +" + off + ": (" + f[0].toFixed(2) + ", " + f[1].toFixed(2) + ") local=(" + localPos[0].toFixed(2) + ", " + localPos[2].toFixed(2) + ")]";
                                break;
                            }
                            // Также пробуем X+Y
                            var dy = diff(f[1], localPos[1]);
                            if (dx < 5 && dy < 5 && f[0] > 0) {
                                matchFound = true;
                                matchInfo = " [MATCH XY at +" + off + ": (" + f[0].toFixed(2) + ", " + f[1].toFixed(2) + ")]";
                                break;
                            }
                        }
                    }
                }
                
                if (matchFound) {
                    console.log("[PKT#" + pktCount + "] fd=" + this.fd + " len=" + got + matchInfo);
                    console.log("    " + hex);
                    // Показываем больше байт для матча
                    var moreHex = "";
                    for (var i = 48; i < Math.min(len, 128); i++) {
                        moreHex += ("0" + bytes[i].toString(16)).slice(-2);
                        if (i % 16 === 15 && i < len - 1) moreHex += "\n    ";
                        else if (i < len - 1) moreHex += " ";
                    }
                    if (moreHex) console.log("    " + moreHex);
                }
            } catch(e) {
                if (pktCount < 5) console.log("[err] " + e);
            }
        }
    });
    console.log("[+] recvfrom hooked - matching floats against local position");
}

console.log("[*] Ready. Stand still so I can read your position.");
