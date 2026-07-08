Il2Cpp.perform(() => {
    const addr = ptr("0x72FB72FD5000");

    console.log("[*] Creating Il2Cpp.Object at " + addr);
    const obj = new Il2Cpp.Object(addr);
    console.log("[*] Object created");

    const cls = obj.class;
    console.log("[*] Class: " + cls);
    console.log("[!] CLASS NAME: " + cls.name);
    console.log("[!] FULL NAME: " + cls.fullName);

    const asm = cls.assembly;
    console.log("[!] ASSEMBLY: " + (asm ? asm.name : "null"));

    const fields = cls.fields;
    console.log("[*] Fields count: " + fields.length);
    for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        console.log("  [" + i + "] " + f.name + " @ +0x" + f.offset.toString(16) + " type=" + f.type.name);
    }

    const methods = cls.methods;
    console.log("[*] Methods count: " + methods.length);
    for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        if (m.name === "get_Name" || m.name === "get_Id" || m.name === "get_EntityId") {
            console.log("  [" + i + "] " + m.name);
        }
    }
});
