// hook_cr0_ael_real.js
// sudo frida -n "Albion-Online" -l hook_cr0_ael_real.js -t 120
// Хукает реальный адрес cr0.ael из Binary Search Table (RVA 0x3a50194)
// и остальные правильные адреса

var modules = Process.enumerateModules();
var gameBase = null;
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "GameAssembly.so") {
        gameBase = modules[i].base;
        console.log("[+] GameAssembly.so base: " + gameBase);
        break;
    }
}

if (!gameBase) {
    console.log("[!] GameAssembly.so not found");
} else {
    // cr0.ael - реальный адрес из .eh_frame_hdr BTS: RVA 0x3a50194
    var cr0AelAddr = gameBase.add(0x3a50194);
    console.log("[+] Hooking cr0.ael (REAL) at: " + cr0AelAddr);
    Interceptor.attach(cr0AelAddr, {
        onEnter: function(args) {
            // args[0]=this(cr0), args[1]=gyi(PhotonEvent), args[2]=short(eventCode)
            var evCode = args[2].toInt32();
            console.log("[cr0.ael] eventCode=" + evCode);
            // Если KeySync (595) - выводим больше данных
            if (evCode === 595) {
                console.log("  >>> KeySync! gyi=" + args[1]);
                // Читаем Dictionary параметров из gyi
                // gyi: byte Code + Dictionary<byte,object> Parameters
                try {
                    var gyi = args[1];
                    if (gyi && !gyi.isNull()) {
                        // Read fields from gyi object (Il2Cpp object layout)
                        // gyi fields: +0x10 = Code (byte), +0x18 = Parameters (Dictionary)
                        var params = gyi.add(0x18).readPointer();
                        console.log("  Parameters dict: " + params);
                        send({type: "keysync", gyi: gyi.toString(), params: params.toString()});
                    }
                } catch(e) {
                    console.log("  [error reading: " + e + "]");
                }
            }
        }
    });

    // Хукаем также реальные адреса для других ael
    // Из AOdump: cr0.v(gyi) - RVA 0x19E8EA8 -> BTS то же eh_frame 
    // Для второго entry: RVA 0x3a50344
    var cr0VAddr = gameBase.add(0x3a50344);
    console.log("[+] Hooking cr0.v at: " + cr0VAddr);
    Interceptor.attach(cr0VAddr, {
        onEnter: function(args) {
            console.log("[cr0.v] called");
        }
    });

    // GameObject::GetName
    for (var j = 0; j < modules.length; j++) {
        if (modules[j].name === "UnityPlayer.so") {
            var getNameAddr = modules[j].base.add(0x9F1900);
            Interceptor.attach(getNameAddr, {
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
            console.log("[+] GameObject::GetName at: " + getNameAddr);
            break;
        }
    }
}

console.log("[+] Done. Waiting for events...");