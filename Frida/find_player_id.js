const PLAYER_NAME = "KpAcuBa";
const COMPONENT_NAME = "MovementComponent";

const ga = Process.getModuleByName("GameAssembly.so");
console.log("[*] GA base: " + ga.base);

const il2cpp_string_new = new NativeFunction(
    ga.getExportByName("il2cpp_string_new"), 'pointer', ['pointer']
);

const GameObjectFind = new NativeFunction(
    ga.base.add(0x496E1EC), 'pointer', ['pointer']
);

const GetComponentByName = new NativeFunction(
    ga.base.add(0x496D134), 'pointer', ['pointer', 'pointer']
);

const nameStr = il2cpp_string_new(Memory.allocUtf8String(PLAYER_NAME));
console.log("[*] Created Il2CppString for '" + PLAYER_NAME + "': " + nameStr);

const go = GameObjectFind(nameStr);
console.log("[*] GameObject::Find result: " + go);

if (go.isNull()) {
    console.log("[-] Player not found. Not in world yet?");
} else {
    const compNameStr = il2cpp_string_new(Memory.allocUtf8String(COMPONENT_NAME));
    const mc = GetComponentByName(go, compNameStr);
    console.log("[*] GetComponentByName('" + COMPONENT_NAME + "'): " + mc);

    if (!mc.isNull()) {
        const managedGo = mc.add(0x18).readPointer();
        const entityId = managedGo.add(0x10).readS32();
        const entityId64 = managedGo.add(0x10).readS64();

        console.log("[+] Managed GO*: " + managedGo);
        console.log("[+] Entity ID (S32): " + entityId);
        console.log("[+] Entity ID (S64): " + entityId64);
        console.log("[XYZ] " +
            managedGo.add(0x38).readFloat().toFixed(2) + ", " +
            managedGo.add(0x3C).readFloat().toFixed(2) + ", " +
            managedGo.add(0x40).readFloat().toFixed(2) + " (angle)"
        );
    } else {
        console.log("[-] Component not found. Trying alternative names...");
        const altNames = ["Character", "PlayerMovement", "Actor", "LocalPlayer"];
        altNames.forEach(function(aname) {
            try {
                const astr = il2cpp_string_new(Memory.allocUtf8String(aname));
                const comp = GetComponentByName(go, astr);
                if (!comp.isNull()) {
                    console.log("[+] Found component '" + aname + "' at: " + comp);
                    console.log("    Managed GO*: " + comp.add(0x18).readPointer());
                    console.log("    Entity ID: " + comp.add(0x18).readPointer().add(0x10).readS32());
                }
            } catch(e) {}
        });
    }
}

console.log("[*] Done");
