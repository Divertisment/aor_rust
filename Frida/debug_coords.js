var baseAddr = ptr("0x74AA798EDA80");
var coordAddr = baseAddr.add(0xF0);

console.log(`\n[!] Дамп памяти по адресу ${coordAddr} (16 байт):`);
console.log(hexdump(coordAddr.readByteArray(16), {
    offset: 0,
    length: 16,
    header: true,
    ansi: true
}));

// Пробуем прочитать как float и как double
console.log(`[+] Float: X=${coordAddr.readFloat()}, Y=${coordAddr.add(4).readFloat()}, Z=${coordAddr.add(8).readFloat()}`);
console.log(`[+] Double: X=${coordAddr.readDouble()}, Y=${coordAddr.add(8).readDouble()}`);
