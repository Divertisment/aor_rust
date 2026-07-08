const HERO_NAME = "KpAcuBa";

console.log("[*] Module: " + Process.getModuleByName("GameAssembly.so").base);
console.log("[*] Looking for: " + HERO_NAME);

const nameBytes = Memory.allocUtf16String(HERO_NAME);
const pattern = nameBytes.readByteArray(HERO_NAME.length * 2);
const patternHex = Array.from(new Uint8Array(pattern)).map(b => ("0" + b.toString(16)).slice(-2)).join(" ");
console.log("[*] Pattern (" + (HERO_NAME.length * 2) + "b): " + patternHex);

// Only anonymous rw- ranges (heap) + data sections of key modules
const allRanges = Process.enumerateRanges('rw-');
let ranges = allRanges.filter(r => {
    // Anonymous heap
    if (!r.file || r.file.path === '') return true;
    // Data sections of game modules
    if (r.file && r.file.path && (
        r.file.path.includes("GameAssembly.so") ||
        r.file.path.includes("UnityPlayer.so")
    )) return true;
    return false;
});

if (ranges.length === 0) ranges = allRanges;

console.log("[*] Scanning " + ranges.length + " ranges (of " + allRanges.length + " total)");

let foundStrings = [];
let scannedCount = 0;

function scanNext(idx) {
    if (idx >= ranges.length) {
        console.log("[*] Done scanning " + scannedCount + " ranges, found " + foundStrings.length + " string occurrences");
        if (foundStrings.length > 0) {
            scanRefs(0);
        } else {
            // Fallback: scan all ranges
            if (ranges.length < allRanges.length) {
                console.log("[*] Falling back to full scan of " + allRanges.length + " ranges...");
                ranges = allRanges;
                scannedCount = 0;
                processNextRange(0);
            } else {
                console.log("[-] Name not found anywhere");
            }
        }
        return;
    }
    const range = ranges[idx];
    scannedCount++;
    if (scannedCount % 10 === 0 || scannedCount === 1) {
        console.log("[*] [" + scannedCount + "/" + ranges.length + "] " + range.base);
    }
    try {
        Memory.scan(range.base, range.size, pattern, {
            onMatch: function (address, size) {
                const stringObjPtr = address.sub(0x14);
                console.log("[+] Name bytes at " + address + " -> StringObj " + stringObjPtr);
                foundStrings.push(stringObjPtr);
            },
            onError: function (reason) {},
            onComplete: function () {
                setImmediate(function () { scanNext(idx + 1); });
            }
        });
    } catch (e) {
        setImmediate(function () { scanNext(idx + 1); });
    }
}

function scanRefs(targetIdx) {
    if (targetIdx >= foundStrings.length) {
        console.log("[*] All done.");
        return;
    }
    const targetPtr = foundStrings[targetIdx];
    const matchPattern = targetPtr.toMatchPattern();
    console.log("[*] Refs for StringObj " + targetPtr + " (" + (targetIdx+1) + "/" + foundStrings.length + ")");
    let refCount = 0;

    function scanRange(idx2) {
        if (idx2 >= ranges.length) {
            console.log("[*] -> " + refCount + " refs to " + targetPtr);
            setImmediate(function () { scanRefs(targetIdx + 1); });
            return;
        }
        const range = ranges[idx2];
        try {
            Memory.scan(range.base, range.size, matchPattern, {
                onMatch: function (addr, size) {
                    refCount++;
                    let objBase = addr;
                    console.log("[REF] " + objBase + " (offset +0x" + objBase.sub(targetPtr).toString(16) + ")");
                    console.log(hexdump(objBase.sub(24), {
                        offset: 0, length: 64, header: false, annotate: false
                    }));
                },
                onError: function (reason) {},
                onComplete: function () {
                    setImmediate(function () { scanRange(idx2 + 1); });
                }
            });
        } catch (e) {
            setImmediate(function () { scanRange(idx2 + 1); });
        }
    }
    scanRange(0);
}

setImmediate(function () { scanNext(0); });
