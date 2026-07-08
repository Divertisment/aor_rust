Il2Cpp.perform(() => {
    console.log("[*] Il2Cpp initialized");

    // List all assemblies with class counts
    const assemblies = Il2Cpp.domain.assemblies;
    console.log("[*] Total assemblies: " + assemblies.length);

    // Find game-related assemblies
    let targetAssembly = null;
    for (let i = 0; i < assemblies.length; i++) {
        const a = assemblies[i];
        console.log("[" + i + "] " + a.name + " - " + a.image);
        if (a.name === "Assembly-CSharp" || a.name === "Assembly-CSharp.dll") {
            targetAssembly = a;
        }
    }

    if (!targetAssembly) {
        console.log("[-] Assembly-CSharp not found");
        return;
    }

    const image = targetAssembly.image;
    const classCount = image.classCount;
    console.log("[*] Assembly-CSharp has " + classCount + " classes");

    // Check some interesting classes
    let found = 0;
    for (let i = 0; i < classCount && found < 30; i++) {
        try {
            const cls = image.class(i);
            const name = cls.name;
            const fullName = cls.fullName;

            // Look for classes with position/entity-related names
            if (fullName.includes(".") && !fullName.startsWith("System")) {
                const methodCount = cls.methods.length;
                const fieldCount = cls.fields.length;
                console.log("  " + fullName + " (methods:" + methodCount + " fields:" + fieldCount + ")");
                found++;
            }
        } catch(e) { /* skip */ }
    }

    // Try to find the Player/Character class
    const searchNames = ["Player", "Character", "Entity", "Actor", "Simulation"];
    for (let sn of searchNames) {
        try {
            const cls = image.class(sn);
            console.log("\n[+] Found class: " + cls.fullName);
            console.log("    Fields: " + cls.fields.length);
            for (let f of cls.fields) {
                console.log("    field: " + f.name + " type=" + f.type);
            }
            console.log("    Methods: " + cls.methods.length);
            for (let m of cls.methods) {
                if (m.name.includes("Name") || m.name.includes("name") || m.name.includes("Id") || m.name.includes("id")) {
                    console.log("    method: " + m.name);
                }
            }
        } catch(e) { /* not found */ }
    }
});
