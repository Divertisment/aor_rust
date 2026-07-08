'use strict';
/*
 * hook_a7h_collision.js
 *
 * Hooks a7h.k() (RVA 0x2F1E510) — the byte[] getter on the collision-grid
 * class — and dumps the returned payload to stdout.  This is the most
 * direct path to the live passability bitmap once the cluster is loaded.
 *
 * Pipeline:
 *   CollisionTester (MonoBehaviour, in GOM)
 *      └─ GetCollisionGrid()  (RVA 0x46CDB70)  returns ──┐
 *                                                       v
 *                                              a7h instance
 *                                              ├─ b @ +0x18 (byte[])  ←★ HERE
 *                                              ├─ j @ +0x44 (AxisAlignedRectangle)
 *                                              └─ k @ +0x58 (Vector2[])
 *
 * The hook is on a7h.k() because the getter is called by
 *   a) the rendering pipeline (every frame, while the grid is on-screen)
 *   b) the editor / debug code
 *   c) the cluster-load path
 * So a single hit tells us (1) the byte[] lives at this address, (2) it has
 * N bytes, (3) it contains a collision bitmap.
 *
 * OUTPUT (3 layers):
 *   1) Human-readable: "[a7h.k] called from 0x<retaddr>, ptr=0x..., len=...",
 *      followed by hexdump of the first MAX_DUMP bytes.
 *   2) Machine-parseable: each hit emits a TSV line
 *        HOOK   <thread_id>  <a7h.this>  <byte[]_ptr>  <length>  <first16hex>
 *      so the user can `awk` to correlate multiple calls.
 *   3) Stats footer: total hits, dropped calls (length==0 or too big).
 *
 * PROJECT RULE: run under sudo via frida-il2cpp-bridge.
 *     echo 31271 | sudo -S frida --pid=4414 --runtime=v8 \
 *         -l frida-il2cpp-bridge \
 *         -l /mnt/hgfs/D/AOR_core/Frida/hook_a7h_collision.js
 *
 * After a hit, the user typically wants the byte[] to be saved to disk:
 *     [a7h.k] saved /tmp/a7h_collision_<unix_ts>_<len>.bin  (256 KB max)
 * so the kernel-driver scan_passability.py can validate it offline with
 * _looks_like_rgba_bitmap / _looks_like_vector3_array.
 */

const TARGET_CLASS   = 'a7h';
const TARGET_METHOD  = 'k';
const TARGET_RVA_HEX = '0x2F1E510';   // from AOdump.cs; cross-checked against the hook target

// Cap on bytes dumped per call (the bitmap is typically 512x512..1024x1024
// which is 256KB..1MB, so this only truncates pathological 2D grids).
const MAX_DUMP        = 4096;
// Cap on total hits before we auto-detach.
const MAX_HITS        = 32;
// Cap on saves to disk to avoid filling /tmp.
const MAX_SAVES       = 8;

// Where to write binary dumps (consumed by scan_passability.py --from-bin).
const DUMP_DIR = '/tmp';

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before any hook can hold the JS event loop). Without this,
//     the script never exits when class/method lookup fails (no auto-detach).
const WATCHDOG_MS    = 120 * 1000;  // FIX: было 180s — уменьшил по просьбе пользователя
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    console.log('[*] hits=' + hitCount + ' saves=' + saveCount + ' dropped=' + droppedSize);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

let hitCount   = 0;
let saveCount  = 0;
let droppedSize = 0;

function isByteArray(obj) {
    // frida-il2cpp-bridge: an Il2Cpp.Array<byte> has class.name === 'byte[]'
    // or starts with 'Il2CppArray`1<byte>' depending on version.
    if (!obj) return false;
    const cn = obj.class && obj.class.name ? obj.class.name : '';
    return cn === 'byte[]'
        || cn.startsWith('Il2CppArray`1<byte')
        || cn === 'Byte[]';
}

function nowIso() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function savePayloadToDisk(handle, length) {
    if (saveCount >= MAX_SAVES) return null;
    const n = Math.min(length, 256 * 1024);
    let bytes;
    try {
        bytes = handle.readByteArray(n);
    } catch (e) {
        console.log(`[a7h.k] readByteArray(${n}) failed: ${e.message}`);
        return null;
    }
    if (!bytes) return null;
    const fname = `${DUMP_DIR}/a7h_collision_${Date.now()}_${length}.bin`;
    try {
        const f = new File(fname, 'wb');
        f.write(bytes);
        f.close();
        saveCount++;
        return fname;
    } catch (e) {
        console.log(`[a7h.k] file write ${fname} failed: ${e.message}`);
        return null;
    }
}

function hexPreview(bytes, n) {
    n = Math.min(n || 16, bytes.length);
    let s = '';
    for (let i = 0; i < n; i++) {
        s += ('0' + bytes[i].toString(16)).slice(-2);
        if (i + 1 < n) s += ' ';
    }
    return s;
}

// FIX: ищем a7h не только в Assembly-CSharp, но и в других известных сборках Альбиона.
// Если нашли — выводим имя assembly + class.image.name, чтобы лог показывал прогресс.
function findA7hClass() {
    var domain = Il2Cpp.domain;
    var ASMS = [
        'Assembly-CSharp', 'Assembly-CSharp-firstpass',
        'Albion.Common', 'Albion.PhotonClient', 'Albion.Network',
        'Albion.Client', 'Albion.Lib', 'Albion.Shared',
        'Albion.GameLogic', 'Albion.Realm', 'Albion.Data',
    ];
    for (var i = 0; i < ASMS.length; i++) {
        var asm = safe(function(){ return domain.assembly(ASMS[i]); }, null);
        if (!asm) continue;
        var k = safe(function(){ return asm.image.class(TARGET_CLASS); }, null);
        if (k) {
            console.log('[*] ' + TARGET_CLASS + ' LOCATED in assembly: ' + ASMS[i] +
                        '  (image=' + safe(function(){return asm.image.name;}, '?') + ')');
            return k;
        }
    }
    return null;
}

function hookA7h() {
    const a7h = findA7hClass();
    if (!a7h) {
        console.log(`[!] class ${TARGET_CLASS} not found in any known assembly — попробуй сначала запустить frida_find_a7h_assembly.js`);
        return false;
    }
    const kMethod = a7h.method(TARGET_METHOD);
    if (!kMethod) {
        console.log(`[!] method ${TARGET_CLASS}.${TARGET_METHOD} not found`);
        return false;
    }
    const rva = methodRva(kMethod);
    console.log(`[*] found ${TARGET_CLASS}.${TARGET_METHOD} @ RVA ${rva} `
                + `(expected ${TARGET_RVA_HEX})`);

    kMethod.implementation = function (...args) {
        const ret = kMethod.invoke(this, ...args);

        if (hitCount >= MAX_HITS) {
            // Soft-cap reached; fall through and don't print.
            return ret;
        }
        hitCount++;

        // ret is the Il2Cpp.Array<byte> object.
        if (!ret) {
            console.log(`[a7h.k #${hitCount}] returned null`);
            return ret;
        }
        if (!isByteArray(ret)) {
            console.log(`[a7h.k #${hitCount}] returned non-byte[]: `
                        + `class=${ret.class && ret.class.name}`);
            return ret;
        }
        const length = ret.length || 0;
        if (length === 0) {
            console.log(`[a7h.k #${hitCount}] returned empty byte[]`);
            return ret;
        }
        if (length > 16 * 1024 * 1024) {
            // >16 MB is implausible for a single bitmap; skip.
            droppedSize++;
            console.log(`[a7h.k #${hitCount}] implausible length=${length}, skipping`);
            return ret;
        }

        const handle = ret.handle;          // native pointer to byte[] klass
        const dataPtr = handle.add(0x20);    // IL2CPP byte[] payload base (klass+monitor+length+pad = 0x20)
        const dumpN   = Math.min(MAX_DUMP, length);

        let bytes;
        try {
            bytes = dataPtr.readByteArray(dumpN);
        } catch (e) {
            console.log(`[a7h.k #${hitCount}] read failed: ${e.message}`);
            return ret;
        }
        const preview = hexPreview(bytes, 16);
        const retAddr = this.returnAddress
            ? '0x' + this.returnAddress.toString(16)
            : '0x0';
        const thisPtr = '0x' + this.handle.toString(16);

        // Layer 1: human.
        console.log(`\n[a7h.k #${hitCount}] this=${thisPtr} retAddr=${retAddr} `
                    + `klassPtr=0x${handle.toString(16)} `
                    + `dataPtr=0x${dataPtr.toString(16)} length=${length}`);
        console.log('    first 16 bytes: ' + preview);
        if (length <= MAX_DUMP) {
            console.log(hexdump(bytes, { ansi: true,
                length: Math.min(length, 256) }));
        } else {
            console.log(`    (truncated; full size=${length})`);
        }

        // Layer 2: machine-parseable TSV.
        //   HOOK  <thread>  <a7h.this>  <byte[]klass>  <length>  <preview16hex>
        console.log(`HOOK\t${Process.getCurrentThreadId()}\t${thisPtr}\t`
                    + `0x${handle.toString(16)}\t${length}\t${preview.replace(/ /g, '')}`);

        // Layer 3: save to disk for offline analysis.
        const saved = savePayloadToDisk(dataPtr, length);
        if (saved) {
            console.log(`    [saved] ${saved}`);
        }
        return ret;
    };
    return true;
}

// frida-il2cpp-bridge has shipped several API names for the method's RVA
// over its versions; cope with all of them.
function methodRva(m) {
    const rva = m.relativeVirtualAddress
             ?? m.virtualAddress
             ?? m.rva
             ?? null;
    if (rva == null || typeof rva !== 'number') return '?';
    return '0x' + rva.toString(16);
}

Il2Cpp.perform(() => {
    console.log(`[*] hooking ${TARGET_CLASS}.${TARGET_METHOD} (collision-grid getter)...`);
    console.log(`[*] dump dir: ${DUMP_DIR}/a7h_collision_<ts>_<len>.bin`);
    const ok = hookA7h();
    if (ok) {
        console.log(`[*] hook installed. waiting for ${MAX_HITS} call(s)...`);
    } else {
        console.log(`[!] hook NOT installed (class/method not found). aborting.`);
    }
});
