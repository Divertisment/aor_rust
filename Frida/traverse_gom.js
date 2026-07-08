var unityPlayer = Process.findModuleByName("UnityPlayer.so");
var getGOM = new NativeFunction(unityPlayer.base.add(0x9ECE20), 'pointer', []);

var gom = getGOM();
console.log(`[1] GameObjectManager: ${gom}`);

if (gom.isNull()) { console.log("[-] NULL!"); }

// Сентинель в GOM + 24
var sentinel = gom.add(24);
var current = sentinel.readPointer(); // sentinel->next = первый реальный узел
console.log(`[2] Sentinel @ ${sentinel} → first node: ${current}`);

var count = 0;

while (!current.isNull() && !current.equals(sentinel) && count < 5000) {
    var gameObject = current.sub(0x68);
    
    console.log(`\n[${count}] Node: ${current} → GameObject: ${gameObject}`);
    
    // Валидный ли GameObject?
    // По дампу, GameObject имеет vtable/указатель в начале
    try {
        var vtable = gameObject.readPointer();
        var id_or_flag = gameObject.add(0x10).readS32();
        // Пробуем прочитать Transform: gameObject + 0x18
        var transformPtr = gameObject.add(0x18).readPointer();
        
        console.log(`    VTable: ${vtable} | ID: ${id_or_flag} | Transform: ${transformPtr}`);
        
        // Если есть Transform, читаем координаты
        if (!transformPtr.isNull()) {
            var x = transformPtr.add(0xF0).readFloat();
            var y = transformPtr.add(0xF4).readFloat();
            var z = transformPtr.add(0xF8).readFloat();
            console.log(`    Координаты: X=${x.toFixed(1)}, Y=${y.toFixed(1)}, Z=${z.toFixed(1)}`);
        }
    } catch(e) {
        console.log(`    Ошибка чтения: ${e.message}`);
    }
    
    // Переходим к следующему
    var next = current.readPointer();
    if (next.equals(current) || next.isNull()) break;
    current = next;
    count++;
}

console.log(`\n[!] Всего обработано: ${count} узлов.`);
