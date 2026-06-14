// hook_names.js
// Показывает ВСЕ имена объектов через GetName
var modules = Process.enumerateModules();
var unity = null;
for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "UnityPlayer.so") { unity = modules[i]; break; }
}

if (unity) {
    var GetName = unity.base.add(0x9F1900);
    var seen = {};
    Interceptor.attach(GetName, {
        onEnter: function(args) { this.obj = args[0]; },
        onLeave: function(retval) {
            if (retval.isNull()) return;
            try {
                var name = retval.readUtf8String();
                if (name && !seen[name]) {
                    seen[name] = 1;
                    console.log("[name] " + name);
                }
            } catch(e) {}
        }
    });
    console.log("[+] GetName hooked - showing ALL object names");
}
