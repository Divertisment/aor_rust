const MC_ADDR = ptr('0x7CCB0210F540');

const l1 = MC_ADDR.add(0xA0).readPointer();
const l2 = l1.add(0x40).readPointer();
const st = l2.add(0x10).readPointer();

console.log('StringTable: ' + st + '\n');

let addr = st;
let str = '';
let count = 0;
const maxOff = 0x400;

for (let off = 0; off < maxOff; off++) {
    const b = addr.readU8();
    if (b === 0) {
        if (str.length >= 2) {
            console.log('  +0x' + off.toString(16).padStart(4, '0') + ': "' + str + '" (' + str.length + ')');
            count++;
        }
        str = '';
    } else if (b >= 32 && b < 127) {
        str += String.fromCharCode(b);
    } else {
        str = '';
    }
    addr = addr.add(1);
}
console.log('Total: ' + count + ' strings');
