try {
    const ga = Process.getModuleByName("GameAssembly.so");

    // Find all il2cpp exports
    const exports = ga.enumerateExports();
    console.log("[*] Total exports: " + exports.length);

    for (const e of exports) {
        if (e.name.includes("il2cpp")) {
            console.log("[EXPORT] " + e.name + " -> " + e.address);
        }
    }

    // Find il2cpp_string_new specifically
    const stringNew = ga.getExportByName("il2cpp_string_new");
    console.log("[*] il2cpp_string_new: " + stringNew);

} catch(e) {
    console.log("Error: " + e);
}
