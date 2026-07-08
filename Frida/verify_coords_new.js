const ADDR = ptr("0x74AA798EDA80");
var x = ADDR.readFloat();
var y = ADDR.add(4).readFloat();
var z = ADDR.add(8).readFloat();

console.log(`[ПРОВЕРКА] Считанные данные из памяти: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Z=${z.toFixed(2)}`);
