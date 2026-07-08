const BASE_COMPONENT_PTR = ptr("0x74AA798EDB70");
var coordsPtr = BASE_COMPONENT_PTR.sub(0xF0);

var x = coordsPtr.readFloat();
var y = coordsPtr.add(4).readFloat();
var z = coordsPtr.add(8).readFloat();

console.log(`[ПРОВЕРКА] Адрес для чтения координат: ${coordsPtr}`);
console.log(`[ПРОВЕРКА] Считанные данные: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Z=${z.toFixed(2)}`);
