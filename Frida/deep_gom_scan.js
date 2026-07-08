var gomAddress = ptr("0x74acb0088b20"); 

console.log("[!] Запуск глубокого сканирования структуры GOM...");

for (var offset = 0; offset <= 0x100; offset += 8) {
    try {
        var potentialHead = gomAddress.add(offset).readPointer();
        
        if (potentialHead.isNull() || Process.findRangeByAddress(potentialHead) === null) {
            continue; 
        }

        var testGo = potentialHead.sub(0x68);
        if (Process.findRangeByAddress(testGo) === null) continue;

        var tag = -1;
        try { tag = testGo.add(0x5C).readU16(); } catch(e) {}
        if (tag > 100 || tag === 0) {
            try { tag = testGo.add(0x54).readU16(); } catch(e) {}
        }

        if (tag >= 1 && tag <= 20) {
            console.log("\n[+] Найдено перспективное смещение GOM +0x" + offset.toString(16) + " -> Указывает на ноду с Тегом: " + tag);
            
            var currentNode = potentialHead;
            var count = 0;
            var visited = {};

            while (!currentNode.isNull() && count < 30) {
                var nodeStr = currentNode.toString();
                if (visited[nodeStr]) break;
                visited[nodeStr] = true;

                try {
                    var goPtr = currentNode.sub(0x68);
                    var currentTag = goPtr.add(0x5C).readU16();
                    if (currentTag > 100) currentTag = goPtr.add(0x54).readU16();

                    if (currentTag === 5) {
                        var instanceID = goPtr.add(0x10).readS32();
                        var transformPtr = goPtr.add(0x18).readPointer();
                        var posStr = "Нет трансформы";

                        if (!transformPtr.isNull() && Process.findRangeByAddress(transformPtr) !== null) {
                            var x = transformPtr.add(0xF0).readFloat();
                            var y = transformPtr.add(0xF4).readFloat();
                            posStr = "X: " + x.toFixed(2) + ", Y: " + y.toFixed(2);
                        }
                        console.log("    [Tag 5] GO=" + goPtr + " | ID=" + instanceID + " | Pos=" + posStr);
                    }
                } catch(e) {}

                try {
                    var nextNode = currentNode.readPointer();
                    if (nextNode.isNull() || nextNode.equals(currentNode) || Process.findRangeByAddress(nextNode) === null) break;
                    currentNode = nextNode;
                } catch(e) { break; }
                
                count++;
            }
        }
    } catch (e) {}
}

console.log("\n[!] Сканирование завершено.");
