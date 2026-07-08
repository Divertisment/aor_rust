var bucketArrayPtr = ptr("0x74aa617314f8");

console.log("[!] Начинаем точечный обход массива бакетов GOM...");

var foundCount = 0;

for (var i = 0; i < 64; i++) {
    try {
        var bucketHead = bucketArrayPtr.add(i * 8).readPointer();

        if (bucketHead.isNull() || bucketHead.toUInt32() < 0x10000) continue;
        if (Process.findRangeByAddress(bucketHead) === null) continue;

        var currentNode = bucketHead;
        var nodeCount = 0;
        var visited = {};

        while (!currentNode.isNull() && nodeCount < 20) {
            var nodeStr = currentNode.toString();
            if (visited[nodeStr]) break;
            visited[nodeStr] = true;

            try {
                var gameObjectPtr = currentNode.sub(0x68);
                if (Process.findRangeByAddress(gameObjectPtr) !== null) {
                    var instanceID = gameObjectPtr.add(0x10).readS32();

                    var tag = gameObjectPtr.add(0x5C).readU16();
                    if (tag > 100 || tag === 0) tag = gameObjectPtr.add(0x54).readU16();

                    var transformPtr = gameObjectPtr.add(0x18).readPointer();

                    if (tag === 5 && instanceID > 0) {
                        foundCount++;
                        var posStr = "Нет трансформы";

                        if (!transformPtr.isNull() && Process.findRangeByAddress(transformPtr) !== null) {
                            var x = transformPtr.add(0xF0).readFloat();
                            var y = transformPtr.add(0xF4).readFloat();
                            var z = transformPtr.add(0xF8).readFloat();
                            posStr = `X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}, Z: ${z.toFixed(2)}`;
                        }

                        console.log(`[Бакет ${i} | Объект #${foundCount}] GO=${gameObjectPtr} | ID=${instanceID} | ${posStr}`);
                    }
                }
            } catch(e) {}

            try {
                var nextNode = currentNode.readPointer();
                if (nextNode.isNull() || nextNode.equals(currentNode) || Process.findRangeByAddress(nextNode) === null) break;
                currentNode = nextNode;
            } catch(e) { break; }

            nodeCount++;
        }

    } catch (e) {}

}

console.log(`[!] Обход завершен. Найдено целей с Tag 5: ${foundCount}`);
