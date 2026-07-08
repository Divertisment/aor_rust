var baseAddr = ptr("0x74AA798EDA80");
console.log(`\n[!] Дамп Transform: ${baseAddr}`);
console.log(hexdump(baseAddr.readByteArray(256), {
    offset: 0,
    length: 256,
    header: true,
    ansi: true
}));
