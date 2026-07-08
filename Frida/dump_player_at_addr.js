'use strict';
// AOR_core/Frida/dump_player_at_addr.js
// Read-only inspector: given the managed address of a Hero/co6 MonoBehaviour,
// prints all standard fields + tries to reach the native GameObject.m_Name
// and (if reachable) the player's display name "KpAcuBa" via UI/CharacterName.
//
// Usage (all under sudo 31271):
//   PID=$(pgrep -f 'Albion-Online' | head -1)
//   echo 31271 | sudo -S sysctl -w kernel.yama.ptrace_scope=0
//   echo 31271 | sudo -S frida -p $PID \
//     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
//     -l dump_player_at_addr.js \
//     --runtime=v8
//
//   # When attached, in the Frida console:
//   rpc.exports.set_addr('0x7f1234567890')
//   # ...or set via env var before attach:
//   PLAYER_ADDR=0x7f1234567890 frida -p ...  (but env vars not auto-propagated to attached script;
//     use the rpc.exports.set_addr() channel after attach)

const MOD = {
    cache_ptr_runtime: 0x18,
    instance_id_runtime: 0x10,
    x_runtime: 0x38,
    y_runtime: 0x3C,
    angle_runtime: 0x40,
    ptr_runtime: 0x48,
    // candidate offsets to try for native UnityEngine.GameObject.m_Name (UTF-8)
    NATIVE_MNAME_CANDIDATES: [0x10, 0x30, 0x48, 0x58, 0x60, 0x68, 0x70, 0x78],
};

function safeReadU8(ptrObj, off) { try { return ptrObj.add(off).readU8(); } catch (e) { return null; } }
function safeReadS32(ptrObj, off) { try { return ptrObj.add(off).readS32(); } catch (e) { return null; } }
function safeReadF32(ptrObj, off) { try { return ptrObj.add(off).readFloat(); } catch (e) { return null; } }
function safeReadPtr(ptrObj, off) { try { return ptrObj.add(off).readPointer(); } catch (e) { return null; } }
function safeReadCString(ptrObj) { try { return ptrObj.readCString(); } catch (e) { return null; } }
function safeReadUtf16(ptrObj, maxLen) {
    try { return ptrObj.readUtf16String(maxLen || 64); } catch (e) { return null; }
}

function readHero(addr) {
    if (!addr) { console.log('[!] no address set yet — call rpc.exports.set_addr("0x...")'); return; }
    const m = ptr(addr);
    console.log('=== Hero MonoBehaviour @ ' + m + ' ===');

    const id    = safeReadS32(m, MOD.instance_id_runtime);
    const cached = safeReadPtr(m, MOD.cache_ptr_runtime);
    const x     = safeReadF32(m, MOD.x_runtime);
    const y     = safeReadF32(m, MOD.y_runtime);
    const angle = safeReadF32(m, MOD.angle_runtime);
    const ptr   = safeReadPtr(m, MOD.ptr_runtime);

    console.log('  +0x10 m_InstanceID = ' + id + '   (== PhotonViewID)');
    console.log('  +0x18 m_CachedPtr  = ' + cached);
    console.log('  +0x38 X            = ' + (x != null ? x.toFixed(3) : 'null'));
    console.log('  +0x3C Y            = ' + (y != null ? y.toFixed(3) : 'null'));
    console.log('  +0x40 angle        = ' + (angle != null ? angle.toFixed(3) : 'null'));
    console.log('  +0x48 ptr          = ' + ptr);

    if (cached && !cached.isNull()) {
        console.log('\n=== Native GameObject via m_CachedPtr ===');
        // probe each candidate m_Name offset; print first one with printable string
        for (const off of MOD.NATIVE_MNAME_CANDIDATES) {
            const p = safeReadPtr(cached, off);
            if (!p || p.isNull()) continue;
            const s = safeReadCString(p);
            if (s && s.length > 0 && s.length < 64) {
                console.log('  candidate native+0x' + off.toString(16) + ' → ptr=' + p + ' utf8="' + s + '"');
                if (/^[A-Za-z0-9_()]+$/.test(s)) { console.log('  ^^ accepted as technical name (UTF-8)'); }
            }
        }
        // also try direct m_Name as inline std::string (read first 64 bytes as bytes)
        for (const off of MOD.NATIVE_MNAME_CANDIDATES) {
            try {
                const bytes = cached.add(off).readByteArray(64);
                const u8 = new Uint8Array(bytes);
                // detect simple ascii inline string
                let ascii = '';
                for (let i = 0; i < u8.length && u8[i] !== 0; i++) {
                    if (u8[i] >= 0x20 && u8[i] < 0x7f) ascii += String.fromCharCode(u8[i]);
                    else break;
                }
                if (ascii.length >= 3 && /^[A-Za-z0-9_()]+$/.test(ascii)) {
                    console.log('  inline native+0x' + off.toString(16) + ' ascii="' + ascii + '"');
                }
            } catch (e) { /* skip */ }
        }
    } else {
        console.log('[!] m_CachedPtr is null — co6 instance not yet initialized?');
    }
}

// Frida RPC channel
const stash = { addr: null };
rpc.exports = {
    set_addr: function (a) {
        stash.addr = a;
        console.log('[*] PLAYER_ADDR set to: ' + a);
        readHero(a);
    },
    get_addr: function () { return stash.addr; },
    read_now: function () { readHero(stash.addr); },
};

// Auto-read at attach if PLAYER_ADDR is provided in env (Frida injects it as getenv)
const envAddr = (typeof getenv === 'function') ? getenv('PLAYER_ADDR') : null;
if (envAddr) {
    console.log('[*] PLAYER_ADDR from env: ' + envAddr);
    setTimeout(function () { readHero(envAddr); }, 100);
}
