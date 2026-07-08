var knownGO = ptr("0x74aab7489800");
var nativeTransform = ptr("0x74AA798EDA80");

console.log(`[+] GameObject: ${knownGO}`);
console.log(`[+] Native Transform: ${nativeTransform}`);

// Компоненты начинаются с GameObject+0x78 (первые 16 байт - GOM нода)
// Читаем 8 слотов компонентов
for (var ci = 0; ci < 8; ci++) {
    var compPtr = knownGO.add(0x78 + ci * 8).readPointer();
    if (compPtr.isNull() || compPtr.equals(ptr("0"))) {
        console.log(`[${ci}] NULL`);
        continue;
    }
    
    console.log(`\n[${ci}] Managed Component @ ${compPtr}`);
    
    // Ищем cachedPtr (адрес нативного объекта) внутри managed Component
    // IL2CPP Object layout:
    // +0x00: klass (Il2CppClass*)
    // +0x08: monitor  
    // +0x10: m_InstanceID (int)
    // +0x14: padding
    // +0x18: m_CachedPtr (IntPtr) <<-- нативный объект!
    
    // А также ищем managed gameObject (ссылка на managed GameObject)
    
    var foundCached = false;
    var foundGOref = false;
    
    for (var off = 0; off < 0x40; off += 8) {
        try {
            var val = compPtr.add(off).readPointer();
            if (!val.isNull()) {
                if (val.equals(nativeTransform)) {
                    console.log(`  >>> cachedPtr (нативный Transform) НАЙДЕН @ +0x${off.toString(16)}`);
                    foundCached = true;
                }
                if (val.equals(knownGO)) {
                    console.log(`  >>> gameObject ref НАЙДЕН @ +0x${off.toString(16)}`);
                    foundGOref = true;
                }
            }
            
            // Также проверяем как int (instance ID)
            if (off === 0x10) {
                var iid = compPtr.add(0x10).readS32();
                console.log(`  +0x10 instanceID = ${iid}`);
            }
        } catch(e) {}
    }
    
    // Дамп для анализа
    console.log(hexdump(compPtr.readByteArray(64), {
        offset: 0, length: 64, header: true, ansi: true
    }));
    
    if (foundCached) {
        console.log(`\n[***] Компонент [${ci}] - ЭТО Transform wrapper!`);
    }
}

setTimeout(function(){}, 2000);
