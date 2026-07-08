'use strict';
/*
 * hook_a7h_collision.js — MINIMAL one-shot trap for a7h.k().
 *
 * Rewritten to NOT freeze the game. Differences vs the previous version:
 *   - bypasses frida-il2cpp-bridge method-implementation replacement
 *     (which on every call allocated a JS-side `instance` argument and
 *      made IL2CPP reflection calls — enough to stall the rendering loop),
 *   - uses raw `Interceptor.attach` on `kMethod.virtualAddress` — the
 *     onLeave runs in C, only the post-call JS payload handler runs
 *     and only ONCE,
 *   - direct lookup of class a7h in `Albion.Common` (no 10-assembly
 *     enumeration loop, no `safe()` log spam on misses),
 *   - one disk write per attach, max 64 KB, to `/tmp/aor_a7h_one.bin`,
 *   - 1-second soft timeout: if no call is intercepted within 1 s of
 *     attach, detach cleanly (no 120-second loop),
 *   - exit cleanly; the panel's Python-side 120-second watchdog is
 *     still in place as a safety net.
 *
 * Behavior on success:
 *   console:  `[*] ONESHOT HIT: a7h.k() returned byte[<len>]`
 *   file:     /tmp/aor_a7h_one.bin (up to 65536 bytes, clamped)
 *
 * Behavior on miss/timeout:
 *   console:  `[!] 1s timeout reached. No a7h.k() calls intercepted.`
 *   file:     not written
 *
 * Call chain (verified by previous hook script):
 *   CollisionTester (MonoBehaviour, in GOM)
 *      └─ GetCollisionGrid()  returns  ──┐
 *                                       v
 *                              a7h instance
 *                              ├─ b @ +0x18 (byte[])  <also a candidate>
 *                              └─ k @ +0x58 (byte[] getter, hooked HERE)
 */

Il2Cpp.perform(() => {
    try {
        // 1. ONE-SHOT DIRECT LOOKUP — fail-fast. No enumeration.
        const asm = Il2Cpp.domain.assembly('Albion.Common');
        if (!asm) {
            console.log('[!] Albion.Common assembly not loaded');
            return;
        }
        const a7h = asm.image.class('a7h');
        if (!a7h) {
            console.log('[!] class a7h not in Albion.Common');
            return;
        }
        const kMethod = a7h.method('k');
        if (!kMethod) {
            console.log('[!] method a7h.k not found');
            return;
        }
        const addr = kMethod.virtualAddress;
        if (!addr) {
            console.log('[!] a7h.k has no virtualAddress (RVA unknown)');
            return;
        }

        console.log(`[*] One-shot attach on a7h.k @ ${addr}`);

        let fired = false;
        const timeoutMs = 1000;

        const listener = Interceptor.attach(addr, {
            onLeave: function (retval) {
                if (fired) return;
                if (retval.isNull()) return;
                fired = true;

                try {
                    // Il2CppArray<byte> layout (Unity6/.NET10):
                    //   +0x00 Il2CppClass*    (8 B)
                    //   +0x08 monitor         (8 B)
                    //   +0x10 pad             (8 B)
                    //   +0x18 uint32 length   (4 B)
                    //   +0x20 payload[0]      (start of bytes)
                    const len = retval.add(0x18).readU32();
                    if (len === 0) {
                        console.log('[!] a7h.k returned empty byte[]');
                        listener.detach();
                        return;
                    }
                    const dumpN = Math.min(len, 0x10000); // 64 KB cap
                    const dataPtr = retval.add(0x20);
                    const bytes = dataPtr.readByteArray(dumpN);

                    const fname = '/tmp/aor_a7h_one.bin';
                    try {
                        const f = new File(fname, 'wb');
                        f.write(bytes);
                        f.close();
                        console.log(`[*] ONESHOT HIT: byte[${len}] (dumped ${dumpN} B to ${fname})`);
                    } catch (ioErr) {
                        console.log(`[?] readByteArray ok but file write failed: ${ioErr.message}`);
                    }
                } catch (e) {
                    console.log(`[?] post-call payload read failed: ${e.message}`);
                }
                listener.detach();
            }
        });

        // 2. SHORT SOFT TIMEOUT — if the getter isn't hit within 1 s of
        // attach (e.g. wrong game state, player in menu, hook already
        // detached by a previous attach…), give up immediately.
        const softTimeout = setTimeout(() => {
            if (!fired) {
                console.log(`[!] ${timeoutMs}ms timeout: no a7h.k() call intercepted`);
                listener.detach();
            }
        }, timeoutMs);

    } catch (e) {
        console.log(`[!] hook setup failed: ${e && e.message ? e.message : e}`);
    }
});
