var baseAddr = ptr("0x74AA798EDA80");

function printTransform(transform, index) {
    if (transform.isNull()) return;
    
    // Читаем координаты Vector3 по смещению 0xF0
    var x = transform.add(0xF0).readFloat();
    var y = transform.add(0xF0 + 0x4).readFloat();
    var z = transform.add(0xF0 + 0x8).readFloat();
    
    console.log(`    [${index}] Transform: ${transform} | Pos: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Z=${z.toFixed(2)}`);
}

var firstChild = baseAddr.add(0x20).readPointer();
console.log(`\n[!] Чтение координат детей для: ${baseAddr}`);

if (firstChild.isNull()) {
    console.log("[-] Нет детей.");
} else {
    var currentChild = firstChild;
    var i = 0;
    while (!currentChild.isNull()) {
        printTransform(currentChild, i);
        // Переходим к следующему брату
        currentChild = currentChild.add(0x28).readPointer();
        i++;
    }
}
