// hook_all_bts.js - хукает ВСЕ реальные RVAs из Binary Search Table
var modules = Process.enumerateModules();
var gb = null;
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "GameAssembly.so") { gb = modules[i].base; break; }
}

if (!gb) { console.log("[!] GameAssembly not found"); }
else {
    console.log("[+] Base: " + gb);

    // Все RVAs из BTS
    var hooks = [
        // cr0.ael entry 1    - 0x03A50194
        // cr0.ael entry 2    - 0x03A50344
        // cr0.v entry 1      - 0x03A505E4
        // cr0.v entry 2      - 0x03A50604
        // cr0.u entry 1      - 0x03A52D84
        // cr0.u entry 2      - 0x03A52DC4
        // cr0.ahx entry 1    - 0x03A54994
        // cr0.ahx entry 2    - 0x03A54A14
        // cqy.ael entry 1    - 0x0098A164
        // cqy.ael entry 2    - 0x0098A1B4
        {rva: 0x03A50194, label: "cr0.ael#1"},
        {rva: 0x03A50344, label: "cr0.ael#2"},
        {rva: 0x03A505E4, label: "cr0.v#1"},
        {rva: 0x03A50604, label: "cr0.v#2"},
        {rva: 0x03A52D84, label: "cr0.u#1"},
        {rva: 0x03A52DC4, label: "cr0.u#2"},
        {rva: 0x03A54994, label: "cr0.ahx#1"},
        {rva: 0x03A54A14, label: "cr0.ahx#2"},
        {rva: 0x0098A164, label: "cqy.ael#1"},
        {rva: 0x0098A1B4, label: "cqy.ael#2"},
    ];

    for (var j = 0; j < hooks.length; j++) {
        var addr = gb.add(hooks[j].rva);
        (function(label) {
            try {
                Interceptor.attach(gb.add(hooks[j].rva), {
                    onEnter: function(args) {
                        console.log("[HIT] " + label + " args=" + args[0] + " " + args[1] + " " + args[2]);
                    }
                });
                console.log("[+] " + label + " at " + addr);
            } catch(e) {
                console.log("[FAIL] " + label + " at " + addr + ": " + e);
            }
        })(hooks[j].label);
    }

    // GetName
    for (var j = 0; j < modules.length; j++) {
        if (modules[j].name === "UnityPlayer.so") {
            var gn = modules[j].base.add(0x9F1900);
            Interceptor.attach(gn, {
                onEnter: function(a) { this.o = a[0]; },
                onLeave: function(r) {
                    if (r && !r.isNull()) {
                        try {
                            var n = r.readUtf8String();
                            if (n && (n.includes("RemotePlayer") || n.includes("LocalPlayer") || n.includes("LocalActor"))) {
                                console.log("[name] " + n);
                            }
                        } catch(e) {}
                    }
                }
            });
            console.log("[+] GetName at " + gn);
            break;
        }
    }
}
console.log("[+] All hooks installed");