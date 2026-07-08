if (typeof Il2Cpp !== 'undefined') {
    console.log("[*] Il2Cpp global found");

    Il2Cpp.perform(() => {
        console.log("[*] Il2Cpp initialized");

        // Check what's available
        console.log("[*] Il2Cpp.Image: " + typeof Il2Cpp.Image);
        console.log("[*] Il2Cpp.Domain: " + typeof Il2Cpp.Domain);

        if (Il2Cpp.Image) {
            try {
                console.log("[*] Image keys: " + Object.keys(Il2Cpp.Image).join(", "));
            } catch(e) {
                console.log("[*] Image error: " + e);
            }
        }

        if (Il2Cpp.Domain) {
            try {
                console.log("[*] Domain: " + Il2Cpp.Domain);
                const assemblies = Il2Cpp.Domain.assemblies;
                console.log("[*] Assemblies count: " + assemblies.length);
                assemblies.forEach(a => {
                    console.log("  Assembly: " + a.name + " - " + a.image);
                    try {
                        const classes = a.image.classes;
                        console.log("    Classes: " + classes.length);
                        // Try to find GameObject
                        classes.forEach(c => {
                            if (c.name.includes("GameObject") || c.name.includes("Movement")) {
                                console.log("    -> " + c.fullName);
                            }
                        });
                    } catch(e) {
                        console.log("    Error: " + e);
                    }
                });
            } catch(e) {
                console.log("[*] Domain error: " + e);
            }
        }
    });
} else {
    console.log("[-] Il2Cpp not found");
}
