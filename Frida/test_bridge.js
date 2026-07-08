console.log("[*] test_bridge.js loaded");
console.log("[*] Il2Cpp type: " + typeof Il2Cpp);
console.log("[*] Il2Cpp.corlib: " + typeof Il2Cpp.corlib);
console.log("[*] Il2Cpp.domain: " + typeof Il2Cpp.domain);

try {
    Il2Cpp.perform(() => {
        console.log("[*] Il2Cpp performed!");

        console.log("[*] Il2Cpp.corlib type: " + typeof Il2Cpp.corlib);
        console.log("[*] Il2Cpp.domain type: " + typeof Il2Cpp.domain);

        if (Il2Cpp.corlib) {
            console.log("[*] Il2Cpp.corlib: " + Il2Cpp.corlib);
            try {
                const gameObjClass = Il2Cpp.corlib.class("UnityEngine.GameObject");
                console.log("[*] GameObject class: " + gameObjClass);
            } catch(e) {
                console.log("[-] Error getting class: " + e);
            }
        }

        if (Il2Cpp.domain) {
            console.log("[*] Il2Cpp.domain: " + Il2Cpp.domain);
            try {
                const assemblies = Il2Cpp.domain.assemblies;
                console.log("[*] Assemblies count: " + assemblies.length);
                for (let i = 0; i < Math.min(5, assemblies.length); i++) {
                    const a = assemblies[i];
                    console.log("  Assembly[" + i + "]: " + a.name + " image=" + a.image);
                }
            } catch(e) {
                console.log("[-] Error enumerating assemblies: " + e);
            }
        }
    });
} catch(e) {
    console.log("[-] Error in Il2Cpp.perform: " + e);
}
