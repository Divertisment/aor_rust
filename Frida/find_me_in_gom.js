var myNode = ptr("0x74aab7489868");
var gom = ptr("0x74acb0088b20");

console.log("=== Структура GameObjectManager ===");
console.log("GOM: " + gom);

// Дампим первые 256 байт GOM
console.log("\nGOM dump (256 bytes):");
console.log(hexdump(gom.readByteArray(256), {
    offset: 0, length: 256, header: true, ansi: true
}));

// Ищем все возможные sentinel'ы (узлы где next и prev указывают на сам узел)
console.log("\n=== Поиск sentinel-узлов в GOM ===");
for (var off = 0; off < 0x100; off += 8) {
    try {
        var val = gom.add(off).readPointer();
        // Sentinel: next == off (указывает на сам себя)
        // или prev == off
        // Проверяем: читаем val как адрес узла и смотрим, что его prev/next == val
        if (!val.isNull()) {
            var next = val.readPointer();
            var prev = val.add(8).readPointer();
            if (next.equals(val) && prev.equals(val)) {
                console.log("[SENTINEL] GOM+" + off.toString(16) + " -> " + val + " (self-linked)");
            }
        }
    } catch(e) {}
}

// Также проверяем прямые значения в GOM как указатели на sentinel'ы
console.log("\n=== Проверяем прямые ссылки в GOM как потенциальные sentinel'ы ===");
for (var off = 0; off < 0x100; off += 8) {
    try {
        var candidate = gom.add(off).readPointer();
        if (candidate.isNull() || candidate.equals(ptr("0"))) continue;
        
        // Проверяем: candidate — это адрес в памяти (валидный указатель)?
        // Читаем next и prev по этому адресу
        var next = candidate.readPointer();
        var prev = candidate.add(8).readPointer();
        
        // Проверяем, не наша ли это нода
        if (candidate.equals(myNode)) {
            console.log("[MY NODE] GOM+" + off.toString(16) + " -> " + candidate + " (ЭТО МОЯ НОДА!)");
            console.log("  next=" + next + " prev=" + prev);
        }
        
        // Проверяем, является ли это sentinel'ом
        if (next.equals(candidate) && prev.equals(candidate)) {
            console.log("[SENTINEL?] GOM+" + off.toString(16) + " -> " + candidate);
        }
    } catch(e) {}
}

setTimeout(function(){}, 2000);
