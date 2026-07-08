/* Frida script: read string table from any Movement Component that has Level1 chain.
   Usage: frida -p PID -l read_string_table.js
   Edit MC_ADDR at the top to point to any valid MC. */
const MC_ADDR = ptr('0x7CCB0210F540');

function hex(p) { return '0x' + p.toString(16).padStart(12, '0'); }

const l1 = MC_ADDR.add(0xA0).readPointer();
const l2 = l1.add(0x40).readPointer();
const st = l2.add(0x10).readPointer();

console.log('; StringTable: ' + hex(st));
console.log('; Chain: MC(' + hex(MC_ADDR) + ') +0xA0 -> L1(' + hex(l1) + ') +0x40 -> L2(' + hex(l2) + ') +0x10 -> ST\n');

let off = 0;
let str = '';
for (let i = 0; i < 0x400; i++) {
    const b = st.add(i).readU8();
    if (b === 0) {
        if (str.length >= 2) {
            const addr = st.add(i - str.length);
            console.log(off.toString(16).toUpperCase().padStart(4, '0') + '  ' + hex(addr) + '  ' + str);
            off = i + 1;
        }
        str = '';
    } else if (b >= 32 && b < 127) {
        str += String.fromCharCode(b);
    } else {
        str = '';
        off = i + 1;
    }
}
