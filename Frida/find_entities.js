// AOR: Hook entities and events. Run: sudo frida -n "Albion-Online" -l find_entities.js -t 60

var ga = null, unity = null;
Process.enumerateModules().forEach(function(m) {
    if (m.name === "GameAssembly.so") ga = m.base;
    if (m.name === "UnityPlayer.so") unity = m.base;
});

if (!ga || !unity) {
    console.log("NO MODULES");
} else {
    console.log("GA: " + ga);
    console.log("Unity: " + unity);

// Hook GetName - collect all game objects
var names = {};
Interceptor.attach(unity.add(0x9F1900), {
    onLeave: function(r) {
        if (r && !r.isNull()) {
            var n = r.readCString();
            if (n && n.length > 0 && n.length < 200 && !names[n]) {
                names[n] = 1;
                console.log("[GO] " + n);
            }
        }
    }
});
console.log("GetName hooked");

// Hook OnEvent at connection handler (RVA 0x27C55E4)
try {
    Interceptor.attach(ga.add(0x27C55E4), {
        onEnter: function(args) {
            var evt = args[1]; // gyi pPhotonEvent
            var code = args[2].toInt32();
            console.log("[EVT code=" + code + "] evt=" + evt);
        }
    });
    console.log("OnEvent hooked at 0x27C55E4");
} catch(e) { console.log("OnEvent FAIL: " + e.message); }

// Hook LocalActorFake methods
["Awake:0x1C2B738", "Start:0x1C2B7C8", "Update:0x1C2BA70", "ctor:0x1C2C008"].forEach(function(pair) {
    var parts = pair.split(":");
    try {
        Interceptor.attach(ga.add(parseInt(parts[1])), {
            onEnter: function(args) {
                console.log("[LAF." + parts[0] + "] this=" + args[0]);
            }
        });
        console.log("LAF." + parts[0] + " hooked");
    } catch(e) { console.log("LAF." + parts[0] + " FAIL: " + e.message); }
});

// Hook RemotePlayerCharacterView (TypeDefIndex 3462 = crz)
// Let's try hooking the view's methods
// RemotePlayerCharacterView.Move handler

console.log("=== HOOKS INSTALLED, waiting 60s ===");
}
