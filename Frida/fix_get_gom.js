// Keep process alive and print info
var unityPlayer = Process.getModuleByName("UnityPlayer.so");
console.log(`[+] UnityPlayer.so: base=${unityPlayer.base}, size=0x${unityPlayer.size.toString(16)}`);

var gameAssembly = Process.getModuleByName("GameAssembly.so");
console.log(`[+] GameAssembly.so: base=${gameAssembly.base}, size=0x${gameAssembly.size.toString(16)}`);

// Read GetGameObjectManager function bytes
var funcAddr = unityPlayer.base.add(0x9ECE20);
console.log(`[+] GetGameObjectManager func @ ${funcAddr}`);
console.log(hexdump(funcAddr.readByteArray(16), {
    offset: 0, length: 16, header: true, ansi: true
}));

// Try to read the global it references
// 48 8B 05 99 DC 6F 01 = mov rax, [rip + 0x016FDC99]
// rip is address of NEXT instruction = funcAddr + 6 (after the 6-byte instruction)
// The displacement is 0x016FDC99 in little-endian (99 DC 6F 01)
var rip = funcAddr.add(6);
var disp = funcAddr.add(2).readS32();  // bytes 2-5 are the displacement
var globalPtr = funcAddr.add(6).add(disp);
console.log(`[+] RIP = ${rip}`);
console.log(`[+] Displacement = 0x${disp.toString(16)}`);
console.log(`[+] Global var = ${globalPtr}`);
console.log(`[+] Global value = ${globalPtr.readPointer()}`);

setTimeout(function() {}, 3000);
