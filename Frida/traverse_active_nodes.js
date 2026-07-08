var gomAddress = ptr("0x74acb0088b20");

var activeNodesListHead = gomAddress.add(0x08).readPointer(); 
var currentNode = activeNodesListHead;

var count = 0;
var foundCount = 0;
var visited = {};

console.log("[!] Сканируем плоский список ActiveNodes напрямую из GOM...");
console.log("[+] ActiveNodes head: " + activeNodesListHead);

while (!currentNode.isNull() && count < 2000) {
    var nodeStr = currentNode.toString();
    if (visited[nodeStr]) {
        console.log("[!] Конец плоского списка (зацикливание на голову).");
        break;
    }
    visited[nodeStr] = true;

    try {
        var gameObjectPtr = currentNode.sub(0x68);
        
        var tag = gameObjectPtr.add(0x5C).readU16(); 
        
        if (tag > 100) { 
            tag = gameObjectPtr.add(0x54).readU16();
        }

        if (tag === 5) {
            foundCount++;
            var instanceID = gameObjectPtr.add(0x10).readS32();
            var transformPtr = gameObjectPtr.add(0x18).readPointer();
            
            var posStr = "Нет трансформы";
            if (!transformPtr.isNull()) {
                var x = transformPtr.add(0xF0).readFloat();
                var y = transformPtr.add(0xF4).readFloat();
                var z = transformPtr.add(0xF8).readFloat();
                posStr = "X: " + x.toFixed(2) + ", Y: " + y.toFixed(2) + ", Z: " + z.toFixed(2);
            }

            console.log("[#" + foundCount + "] GO=" + gameObjectPtr + " | ID=" + instanceID + " | Tag=" + tag + " | " + posStr);
        }

    } catch (e) {}

    var nextNode = currentNode.readPointer();
    if (nextNode.isNull() || nextNode.equals(currentNode)) break;
    
    currentNode = nextNode;
    count++;
}

console.log("[!] Готово. Нод: " + count + ", Объектов с Tag 5: " + foundCount);
