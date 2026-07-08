// hook_ckl_register.js — search symbol then hook
var mod = Module.find("GameAssembly.so");
if (!mod) { console.log("GameAssembly.so not found"); }
else {
    console.log("Searching symbols for ckl1.af in " + mod.name + " base=" + mod.base);
    var found = 0;
    mod.enumerateSymbols().forEach(function(s) {
        if (s.name.indexOf("ckl1") >= 0 || s.name.indexOf("_af") >= 0 || s.name.indexOf("KeySync") >= 0) {
            console.log("sym: " + s.name + " @ " + s.address + " size=" + s.size);
            found++;
        }
    });
    if (found === 0) {
        // try with .af
        mod.enumerateSymbols().forEach(function(s) {
            if (s.name.indexOf(".af") >= 0 && s.name.indexOf("ck") >= 0) {
                console.log("alt: " + s.name + " @ " + s.address);
                found++;
            }
        });
    }
    console.log("found " + found + " matches");
}
