var baseAddr = ptr("0x74AA798EDA80");

function printTransform(transform, index) {
    if (transform.isNull()) return;
    var go = transform.add(0x18).readPointer();
    var id = !go.isNull() ? go.add(0x10).readS32() : "Null";
    console.log(`    [${index}] Transform: ${transform} | GO: ${go} | ID: ${id}`);
}

var firstChild = baseAddr.add(0x20).readPointer();
console.log(`\n[!] Обход детей для: ${baseAddr}`);

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
