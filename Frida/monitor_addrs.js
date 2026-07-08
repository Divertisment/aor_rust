const a1 = ptr("0x7b53e42cfe28");
const a2 = ptr("0x7b53e42d0308");

setInterval(() => {
    try {
        const b1 = a1.readByteArray(12), b2 = a2.readByteArray(12);
        const f1 = new Float32Array(b1), f2 = new Float32Array(b2);
        console.log(`0x${a1} -> ${f1[0].toFixed(3)}, ${f1[1].toFixed(3)}, ${f1[2].toFixed(3)}`);
        console.log(`0x${a2} -> ${f2[0].toFixed(3)}, ${f2[1].toFixed(3)}, ${f2[2].toFixed(3)}`);
        console.log('');
    } catch(e) { console.log('Error: ' + e); }
}, 150);
