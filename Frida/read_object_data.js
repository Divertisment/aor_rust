var baseAddr = ptr("0x74AA798EDA80"); // Ваш исходный Transform
var firstChildNode = baseAddr.add(0x20).readPointer(); // Указатель на структуру ребенка

console.log(`[!] Анализ структуры ребенка: ${firstChildNode}`);

// Смещение 0x30 в структуре ребенка ведет на данные объекта
var dataPtr = firstChildNode.add(0x30).readPointer();
console.log(`[+] Адрес данных объекта: ${dataPtr}`);

if (!dataPtr.isNull()) {
    // Читаем значения, которые могут быть координатами или важными данными
    console.log(`[+] Чтение потенциальных координат (тип Double):`);
    console.log(`    Offset 0xD0 (Double): ${dataPtr.add(0xD0).readDouble()}`);
    console.log(`    Offset 0x180 (Double): ${dataPtr.add(0x180).readDouble()}`);
    console.log(`    Offset 0x194 (Double): ${dataPtr.add(0x194).readDouble()}`);
}
