var unityPlayer = Process.findModuleByName("UnityPlayer.so");
console.log(`[+] UnityPlayer.so: base=${unityPlayer.base}, size=0x${unityPlayer.size.toString(16)}`);

// Проверяем оба адреса
var gomAddr = unityPlayer.base.add(0x9ECE20);
console.log(`\n[1] GetGameObjectManager @ 0x9ECE20: ${gomAddr}`);
try {
    console.log(hexdump(gomAddr.readByteArray(16), {offset:0,length:16,header:true,ansi:true}));
} catch(e) { console.log(`    Ошибка: ${e.message}`); }

var taggedAddr = unityPlayer.base.add(0x849F40);
console.log(`\n[2] GetTaggedNodes @ 0x849F40: ${taggedAddr}`);
try {
    console.log(hexdump(taggedAddr.readByteArray(32), {offset:0,length:32,header:true,ansi:true}));
} catch(e) { console.log(`    Ошибка: ${e.message}`); }

// Найдём исполняемые секции UnityPlayer.so
console.log(`\n[3] Секции UnityPlayer.so:`);
['r-x', 'r--', 'rw-'].forEach(function(prot) {
    var ranges = Process.enumerateRanges(prot).filter(r => 
        r.base >= unityPlayer.base && r.base < unityPlayer.base.add(unityPlayer.size)
    );
    if (ranges.length > 0) {
        ranges.forEach(function(r) {
            var off = r.base.sub(unityPlayer.base);
            console.log(`    ${prot} [0x${off.toString(16)}] ${r.base} (0x${r.size.toString(16)})`);
        });
    }
});

// Заодно проверим, может GetGameObjectManager всё же в GameAssembly.so
var ga = Process.findModuleByName("GameAssembly.so");
// Поищем в r-x секции GameAssembly.so все короткие функции, 
// которые загружают указатель из rw- секции
console.log(`\n[4] Ищем GetGameObjectManager в GameAssembly.so через RIP-relative references to rw-...`);

var rwRanges = Process.enumerateRanges('rw-').filter(r => 
    r.base >= ga.base && r.base < ga.base.add(ga.size)
);
var execRanges = Process.enumerateRanges('r-x').filter(r => 
    r.base >= ga.base && r.base < ga.base.add(ga.size)
);

console.log(`    rw- секций: ${rwRanges.length}, r-x секций: ${execRanges.length}`);

// Для каждого кандидата из r-x, проверяем, куда ведёт его RIP-relative offset
execRanges.forEach(function(er) {
    try {
        // Ищем mov rax, [rip+X]; ret (48 8B 05 XX XX XX XX C3)
        Memory.scanSync(er.base, er.size, "48 8B 05").forEach(function(m) {
            var bytes = m.address.readByteArray(8);
            var arr = Array.from(new Uint8Array(bytes));
            if (arr[7] === 0xC3) {
                var off = (arr[3] << 0) | (arr[4] << 8) | (arr[5] << 16) | (arr[6] << 24);
                if (off > 0x7FFFFFFF) off -= 0x100000000;
                var target = m.address.add(7 + off);
                // Проверяем, указывает ли на rw- секцию GameAssembly
                var inRw = rwRanges.some(r => target >= r.base && target < r.base.add(r.size));
                if (inRw) {
                    var val = target.readPointer();
                    console.log(`    КАНДИДАТ! Функция: ${m.address.sub(ga.base)} → нагрузка: ${target.sub(ga.base)}, значение: ${val}`);
                }
            }
        });
    } catch(e) {}
});
