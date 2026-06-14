// hook_keysync_register.js
// sudo frida -n "Albion-Online" -l hook_keysync_register.js -q -t 60

// Frida 17: Module.findBaseAddress не существует, используем Process.enumerateModules()
var modules = Process.enumerateModules();
var base = null;
var unityBase = null;

for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "GameAssembly.so") {
        base = modules[i].base;
        console.log("[+] GameAssembly.so base: " + base);
    }
    if (modules[i].name === "UnityPlayer.so") {
        unityBase = modules[i].base;
        console.log("[+] UnityPlayer.so base: " + unityBase);
    }
}

if (!base) {
    console.log("[!] GameAssembly.so not found");
} else {
    var REGISTER_RVA = 0x1BBAB10;
    var REGISTER_VA = base.add(REGISTER_RVA);
    console.log("[+] Hooking ck1.af at: " + REGISTER_VA);

    Interceptor.attach(REGISTER_VA, {
        onEnter: function(args) {
            var eventCode = args[1].toInt32();
            if (eventCode === 595) {
                console.log("\n[=== ck1.af KeySync handler registered ===]");
                console.log(" ck1 instance: " + args[0]);
                console.log(" handler (cwj): " + args[2]);

                var handler = args[2];
                if (handler && !handler.isNull()) {
                    console.log("[+] Attaching to KeySync handler...");
                    Interceptor.attach(handler, {
                        onEnter: function(hArgs) {
                            console.log("[KeySync handler CALLED]");
                            var dict = hArgs[1];
                            if (dict) {
                                console.log("  dict: " + dict);
                            }
                        }
                    });
                }
            }
        }
    });
}

if (unityBase) {
    var GETNAME_RVA = 0x9F1900;
    var GETNAME_VA = unityBase.add(GETNAME_RVA);
    console.log("[+] Hooking GameObject::GetName at: " + GETNAME_VA);

    Interceptor.attach(GETNAME_VA, {
        onEnter: function(args) {
            this.obj = args[0];
        },
        onLeave: function(retval) {
            if (retval && !retval.isNull()) {
                try {
                    var name = retval.readUtf8String();
                    if (name && (name.includes("KeySync") || name.includes("keySync") || name.includes("Session") || name.includes("Crypto") || name.includes("Network"))) {
                        console.log("[GetName] " + name + " (obj: " + this.obj + ")");
                    }
                } catch (e) {}
            }
        }
    });
}