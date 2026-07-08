// hook_all_events.js
// Hooks ALL known event dispatch methods simultaneously
// sudo frida -n "Albion-Online" -l hook_all_events.js -q -t 120

var modules = Process.enumerateModules();
var gameBase = null;

for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "GameAssembly.so") {
        gameBase = modules[i].base;
        console.log("[+] GameAssembly.so base: " + gameBase);
    }
}

if (!gameBase) {
    console.log("[!] GameAssembly.so not found");
} else {
    // Hook ck1.af (handler registration) - RVA 0x1BBAB10
    var regAddr = gameBase.add(0x1BBAB10);
    console.log("[+] Hooking ck1.af at: " + regAddr);
    Interceptor.attach(regAddr, {
        onEnter: function(args) {
            var eventCode = args[1].toInt32();
            console.log("[ck1.af] eventCode=" + eventCode + " handler=" + args[2]);
        }
    });

    // Hook cr0.ael (OnEvent for game simulation) - RVA 0x19E8E88
    var aelAddr = gameBase.add(0x19E8E88);
    console.log("[+] Hooking cr0.ael at: " + aelAddr);
    Interceptor.attach(aelAddr, {
        onEnter: function(args) {
            console.log("[cr0.ael CALLED]");
            console.log("  event: " + args[1] + " code: " + args[2].toInt32());
        }
    });

    // Hook LoginClient.OnEvent - RVA 0x27C55E4
    var loginEvAddr = gameBase.add(0x27C55E4);
    console.log("[+] Hooking LoginClient.OnEvent at: " + loginEvAddr);
    Interceptor.attach(loginEvAddr, {
        onEnter: function(args) {
            console.log("[LoginClient.OnEvent] code=" + args[2].toInt32());
        }
    });

    // Hook cr0.ahx (OnOperationResponse for game simulation) - RVA 0x19E9228
    var ahxAddr = gameBase.add(0x19E9228);
    console.log("[+] Hooking cr0.ahx at: " + ahxAddr);
    Interceptor.attach(ahxAddr, {
        onEnter: function(args) {
            console.log("[cr0.ahx CALLED] opCode=" + args[2].toInt32());
        }
    });

    // Also hook cqy.ael - RVA 0x19EA0E4
    var cqyAelAddr = gameBase.add(0x19EA0E4);
    console.log("[+] Hooking cqy.ael at: " + cqyAelAddr);
    Interceptor.attach(cqyAelAddr, {
        onEnter: function(args) {
            console.log("[cqy.ael CALLED] code=" + args[2].toInt32());
        }
    });

    // Hook GameObject::GetName for names
    var uBase = null;
    for (var j = 0; j < modules.length; j++) {
        if (modules[j].name === "UnityPlayer.so") {
            uBase = modules[j].base;
            break;
        }
    }
    if (uBase) {
        var getNameAddr = uBase.add(0x9F1900);
        Interceptor.attach(getNameAddr, {
            onEnter: function(args) { this.obj = args[0]; },
            onLeave: function(retval) {
                if (retval && !retval.isNull()) {
                    try {
                        var name = retval.readUtf8String();
                        if (name && (name.includes("RemotePlayer") || name.includes("LocalActor") || name.includes("PlayerCharacter"))) {
                            console.log("[GetName] " + name);
                        }
                    } catch (e) {}
                }
            }
        });
        console.log("[+] Hooking GameObject::GetName at: " + getNameAddr);
    }
}

console.log("[+] All hooks installed. Waiting for events...");