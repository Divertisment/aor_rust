// frida_read_pos.js
// Минимальный: без Interceptor.attach, только чтение памяти раз в секунду
// Ищет GameObject::GetName адрес и проверяет позицию через Transform
console.log("[*] Scanning for LocalPlayer position...");

function tryPos(addr) {
    if (!addr || addr.isNull()) return null;
    try {
        var x = addr.readFloat();
        var y = addr.add(4).readFloat();
        var z = addr.add(8).readFloat();
        if (isFinite(x) && isFinite(y) && isFinite(z) &&
            Math.abs(x) < 50000 && Math.abs(z) < 50000 &&
            Math.abs(y) < 30 && x > 0 && z > 0)
            return [x, y, z];
    } catch(e) {}
    return null;
}

var UnityPlayer = null;
Process.enumerateModules().forEach(function(m) {
    if (m.name === "UnityPlayer.so") UnityPlayer = m;
});

if (!UnityPlayer) { console.log("[!] UnityPlayer.so not found"); }
else {
    console.log("[+] UnityPlayer.so: " + UnityPlayer.base);
    
    // GameObject::GetName hook - только для захвата LocalPlayer
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
                    console.log("[+] LocalPlayerCharacter @ " + localObj);
                }
            } catch(e) {}
        }
    });
    
    // Таймер чтения позиции
    setInterval(function() {
        if (!localObj) return;
        
        // GameObject: transform pointer часто по offset 0x10
        var tptr = localObj.add(0x10).readPointer();
        
        // Пробуем разные оффсеты Transform.position
        var offsets = [0x38, 0x40, 0x48, 0x50, 0x80, 0x88, 0x8C, 0x90, 0x94, 0x98, 0xA0];
        for (var i = 0; i < offsets.length; i++) {
            var p = tryPos(tptr.add(offsets[i]));
            if (p) {
                console.log("[POS] (" + p[0].toFixed(3) + ", " + p[1].toFixed(3) + ", " + p[2].toFixed(3) + ") [t+0x" + offsets[i].toString(16) + "]");
                break;
            }
        }
    }, 500);
}

console.log("[*] Ready. Move around to see your position.");
