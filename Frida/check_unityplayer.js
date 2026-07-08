// Проверяем UnityPlayer.so
var unityPlayer = Process.findModuleByName("UnityPlayer.so");

if (!unityPlayer) {
    console.log("[-] UnityPlayer.so НЕ ЗАГРУЖЕН!");
    // Проверим все модули
    Process.enumerateModules().forEach(function(m) {
        if (m.name.includes("Unity") || m.name.includes("Player")) {
            console.log(`    Найден модуль: ${m.name} - ${m.base}`);
        }
    });
} else {
    console.log(`[+] UnityPlayer.so найден:`);
    console.log(`    Base: ${unityPlayer.base}`);
    console.log(`    Size: 0x${unityPlayer.size.toString(16)}`);
    console.log(`    Path: ${unityPlayer.path}`);
    
    // Ищем экспорт GetGameObjectManager
    var getGOM_export = Module.findExportByName("UnityPlayer.so", "GetGameObjectManager");
    if (getGOM_export) {
        console.log(`[+] Экспорт GetGameObjectManager найден: ${getGOM_export}`);
    } else {
        console.log("[-] Экспорт GetGameObjectManager отсутствует в UnityPlayer.so");
    }
    
    // Проверяем, есть ли RVA 0x9ECE20 в пределах модуля
    var gomAddr = unityPlayer.base.add(0x9ECE20);
    var inRange = gomAddr >= unityPlayer.base && gomAddr < unityPlayer.base.add(unityPlayer.size);
    console.log(`\n    RVA 0x9ECE20 в пределах модуля: ${inRange}`);
    if (inRange) {
        console.log(`    Адрес: ${gomAddr}`);
        try {
            console.log(hexdump(gomAddr.readByteArray(16), {
                offset: 0, length: 16, header: true, ansi: true
            }));
        } catch(e) {
            console.log(`    Не читается: ${e.message}`);
        }
    }
    
    // Аналогично для GetTaggedNodes (RVA 0x849F40)
    var taggedAddr = unityPlayer.base.add(0x849F40);
    var inRange2 = taggedAddr >= unityPlayer.base && taggedAddr < unityPlayer.base.add(unityPlayer.size);
    console.log(`\n    RVA 0x849F40 в пределах модуля: ${inRange2}`);
    if (inRange2) {
        console.log(`    Адрес: ${taggedAddr}`);
        try {
            console.log(hexdump(taggedAddr.readByteArray(16), {
                offset: 0, length: 16, header: true, ansi: true
            }));
        } catch(e) {
            console.log(`    Не читается: ${e.message}`);
        }
    }
    
    // Ищем любые функции с GOM-связанными именами
    console.log(`\n[!] Ищем символы GameObj в UnityPlayer.so...`);
    var symbols = Module.enumerateSymbols("UnityPlayer.so");
    var gomSymbols = symbols.filter(s => 
        s.name.includes("GameObj") || 
        s.name.includes("GetTagged") || 
        s.name.includes("GameObjectManager")
    );
    if (gomSymbols.length > 0) {
        gomSymbols.forEach(s => console.log(`    ${s.name}: ${s.address}`));
    } else {
        console.log("    Символы не найдены (stripped)");
    }

    // Посмотрим r-x секции UnityPlayer.so
    console.log(`\n[!] Секции UnityPlayer.so:`);
    ['r-x', 'r--', 'rw-'].forEach(function(prot) {
        var ranges = Process.enumerateRanges(prot).filter(r => 
            r.base >= unityPlayer.base && r.base < unityPlayer.base.add(unityPlayer.size)
        );
        if (ranges.length > 0) {
            console.log(`\n    ${prot}:`);
            ranges.forEach(function(r) {
                var off = r.base.sub(unityPlayer.base);
                console.log(`        [0x${off.toString(16)}] ${r.base} (0x${r.size.toString(16)})`);
            });
        }
    });
}
