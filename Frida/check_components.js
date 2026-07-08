var gameObject = ptr("0x74aab7489800");
console.log(`[!] GameObject: ${gameObject}`);

// 6 указателей компонентов начиная с +0x68
for (var i = 0; i < 6; i++) {
    var compPtr = gameObject.add(0x68 + i * 8).readPointer();
    console.log(`\n[${i}] Компонент @ +0x${(0x68 + i * 8).toString(16)}: ${compPtr}`);
    
    if (!compPtr.isNull()) {
        try {
            var vtable = compPtr.readPointer();
            var goInComp = compPtr.add(0x18).readPointer();
            console.log(`    VTable: ${vtable}`);
            console.log(`    +0x18 → GameObject: ${goInComp}`);
            console.log(`    Ссылается на искомый GameObject: ${goInComp.equals(gameObject)}`);
            
            // Проверяем +0xF0 на координаты (свойство Transform)
            try {
                var x = compPtr.add(0xF0).readFloat();
                var y = compPtr.add(0xF4).readFloat();
                var z = compPtr.add(0xF8).readFloat();
                console.log(`    Координаты +0xF0: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Z=${z.toFixed(2)}`);
            } catch(e) {
                console.log(`    Коорд. не читаются: ${e.message}`);
            }
        } catch(e) {
            console.log(`    Ошибка чтения: ${e.message}`);
        }
    }
}
