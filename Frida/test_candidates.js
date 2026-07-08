var base = Process.findModuleByName("GameAssembly.so").base;

// Найдем все короткие mov rax, [rip+off]; ret в r-x секциях
var execRanges = Process.enumerateRanges('r-x').filter(r => 
    r.base >= base && r.base < base.add(0x7780888)
);

var candidates = [];
execRanges.forEach(function(range) {
    try {
        // mov rax, [rip+off]; ret
        var movMatches = Memory.scanSync(range.base, range.size, "48 8B 05");
        movMatches.forEach(function(m) {
            var bytes = m.address.readByteArray(8);
            if (bytes) {
                var arr = Array.from(new Uint8Array(bytes));
                if (arr[7] === 0xC3) {
                    var offset = (arr[3] << 0) | (arr[4] << 8) | (arr[5] << 16) | (arr[6] << 24);
                    var ripNext = m.address.add(7);
                    var targetAddr = offset > 0x7FFFFFFF 
                        ? ripNext.sub(0x100000000 - offset) 
                        : ripNext.add(offset);
                    candidates.push({ addr: m.address, target: targetAddr, type: 'mov' });
                }
            }
        });
        
        // lea rax, [rip+off]; ret
        var leaMatches = Memory.scanSync(range.base, range.size, "48 8D 05");
        leaMatches.forEach(function(m) {
            var bytes = m.address.readByteArray(8);
            if (bytes) {
                var arr = Array.from(new Uint8Array(bytes));
                if (arr[7] === 0xC3) {
                    var offset = (arr[3] << 0) | (arr[4] << 8) | (arr[5] << 16) | (arr[6] << 24);
                    var ripNext = m.address.add(7);
                    var targetAddr = offset > 0x7FFFFFFF 
                        ? ripNext.sub(0x100000000 - offset) 
                        : ripNext.add(offset);
                    candidates.push({ addr: m.address, target: targetAddr, type: 'lea' });
                }
            }
        });
    } catch(e) {}
});

console.log(`[!] Найдено ${candidates.length} кандидатов. Вызываем их...\n`);

candidates.forEach(function(c, idx) {
    try {
        // Создаем и вызываем функцию
        var fn = new NativeFunction(c.addr, 'pointer', []);
        var result = fn();
        var rva = c.addr.sub(base);
        
        if (!result.isNull()) {
            console.log(`[${idx}] RVA 0x${rva.toString(16)} (${c.type}): ВОЗВРАТ = ${result}`);
            console.log(hexdump(result.readByteArray(64), {
                offset: 0, length: 64, header: true, ansi: true
            }));
            console.log("");
        }
    } catch(e) {
        // silent
    }
});

console.log("[!] Поиск завершён.");
