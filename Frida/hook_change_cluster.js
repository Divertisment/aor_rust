'use strict';
/*
 * Frida/hook_change_cluster.js — minimal one-shot Photon OperationResponse(35) tap.
 *
 *   OC = 35 (Operations.ChangeCluster)               Stas.AOR/Operation/Operations.cs:76
 *   handler = cr0.ahx(gyx OperationResponse, opCode) Frida/hook_all_events.js:56-66
 *                                                       RVA 0x19E9228
 *                                                       RVA 0x03A54994 (alt) — hook_dispatch_photon.js:32
 *   args[0] = this (cr0 instance)
 *   args[1] = gyx OperationResponse (decrypted payload)
 *   args[2] = opCode (short)
 *
 * Reads:
 *   opResp.Parameters[0]  = ClusterId (string)
 *   opResp.Parameters[3]  = DynamicClusterData payload (byte[])
 *
 * Writes on first hit:
 *   /tmp/cc_<ClusterId>_<ts>.bin   — raw payload bytes
 *   /tmp/cc_<ClusterId>_<ts>.json  — metadata sidecar (type byte, length, etc.)
 *
 * To stay minimal (avoid game freeze):
 *   - attach ONE interceptor
 *   - first captured hit → detach()
 *   - soft-timeout 60 s: detach() if no OC=35 captured
 */

Il2Cpp.perform(() => {
    try {
        const TARGET_OP_CODE = 35; // = Operations.ChangeCluster per Stas.AOR sources

        // ─── Locate dispatcher: class cr0 + method ahx ──────────────────────
        // Search all assemblies for class `cr0` (it's an obfuscated type-name,
        // not necessarily in Albion.Common — try every loaded assembly).
        let cr0 = null;
        let cr0Asm = '<unknown>';
        try {
            for (const a of Il2Cpp.domain.assemblies) {
                try {
                    for (const img of a.images) {
                        if (!cr0) {
                            try { cr0 = img.class('cr0'); } catch (e) {}
                            if (cr0) cr0Asm = a.name;
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
        if (!cr0) {
            console.log('[!] class cr0 not found in any loaded assembly — abort');
            return;
        }

        // Method `ahx` is the OperationResponse handler.
        // Args: (gyx OperationResponse, short opCode). See hook_all_events.js:56-66.
        const m_ahx = cr0.method('ahx');
        // frida-il2cpp-bridge API revisions: try virtualAddress → rva → handle.
        const dispatchAddr = (m_ahx && (m_ahx.virtualAddress || m_ahx.rva || m_ahx.handle)) || null;
        if (!m_ahx) {
            console.log('[!] cr0.ahx not found on cr0 (' + cr0Asm + ')');
            return;
        }
        if (!dispatchAddr || (typeof dispatchAddr === 'object' && dispatchAddr.isNull && dispatchAddr.isNull()) || dispatchAddr === 0 || dispatchAddr === '0') {
            console.log('[!] cr0.ahx found but RVA is null/zero on cr0 (' + cr0Asm + ')');
            return;
        }
        console.log('[*] Hooking cr0.ahx @ ' + dispatchAddr + ' (asm=' + cr0Asm + ', OC=' + TARGET_OP_CODE + ')');

        // ─── Helper: read Il2CppString (x64 IL2CPP layout) ─────────────────
        // Il2CppString layout (x64):
        //   +0x00  klass*                 (8 B)
        //   +0x08  monitor                (8 B)
        //   +0x10  m_length               (4 B signed int32)
        //   +0x14  m_chars[…]             (UTF16LE, length cells of 2 B)
        function readIl2CppString(objOrHandle) {
            try {
                const h = (objOrHandle && objOrHandle.handle) ? objOrHandle.handle : objOrHandle;
                if (!h) return null;
                const len = h.add(0x10).readS32();
                if (!len || len < 0 || len > 256) return null;
                return h.add(0x14).readUtf16String(len);
            } catch (e) {
                return null;
            }
        }

        // ─── Helper: read Il2Cpp byte[] length + data pointer ──────────────
        // Il2CppArray<byte>:
        //   +0x00  klass*                 (8 B)
        //   +0x08  monitor                (8 B)
        //   +0x10  bounds*                (8 B)   [Il2CppArrayBounds]
        //   +0x18  max_length             (4 B)
        //   +0x1C  pad                    (4 B)
        //   +0x20  data[…]                (byte cells)
        function readIl2CppByteArray(obj) {
            try {
                if (!obj || !obj.handle) return null;
                const arrLen = obj.handle.add(0x18).readU32();
                if (!arrLen || arrLen > 50_000_000) return null;
                const dataPtr = obj.handle.add(0x20);
                return dataPtr.readByteArray(arrLen);
            } catch (e) {
                return null;
            }
        }

        // ─── One-shot state ─────────────────────────────────────────────────
        let fired = 0;
        const SOFT_TIMEOUT_MS = 60000;

        // ─── Attach interceptor on cr0.ahx ──────────────────────────────────
        const interceptor = Interceptor.attach(dispatchAddr, {
            onEnter(args) {
                if (fired) {
                    return;
                }
                try {
                    // arg layout per hook_all_events.js:56-66:
                    //   args[0] = this (cr0 instance)
                    //   args[1] = gyx OperationResponse (decrypted)
                    //   args[2] = opCode (short)
                    const opResp = args[1];
                    if (!opResp || opResp.isNull()) {
                        return;
                    }
                    let opCode = -1;
                    try {
                        opCode = args[2].toInt32() & 0xFFFF;
                    } catch (e) {
                        // try reading from field directly
                        try {
                            opCode = opResp.field('OperationCode').value & 0xFF;
                        } catch (e2) {
                            return;
                        }
                    }
                    if (opCode !== TARGET_OP_CODE) {
                        return;
                    }

                    // Read Parameters Dictionary<byte, object>.
                    // frida-il2cpp-bridge exposes indexer -> param.get_Item(k).
                    // Use it directly instead of enumerator-loop.
                    let clusterId = null;
                    let payloadBytes = null;
                    try {
                        const paramsTbl = opResp.field('Parameters').value;
                        if (paramsTbl && paramsTbl.handle) {
                            // param[0] — ClusterId string
                            try {
                                const p0 = paramsTbl.method('get_Item').invoke(0);
                                clusterId = readIl2CppString(p0);
                            } catch (e0) {
                                clusterId = null;
                            }
                            // param[3] — payload byte[]
                            try {
                                const p3 = paramsTbl.method('get_Item').invoke(3);
                                payloadBytes = readIl2CppByteArray(p3);
                            } catch (e3) {
                                payloadBytes = null;
                            }
                        }
                    } catch (eP) {
                        // parameters read failed entirely — bail this hit silently
                        return;
                    }

                    if (!payloadBytes || !payloadBytes.length) {
                        // we filtered for OC=35, so payload is expected.
                        // Instead of looping forever on every OC=35 hit, leave one warning then exit.
                        if (!fired) {
                            console.log('[?] OC=35 hit but no payload extracted (param[3] missing). ');
                            console.log('    opResp.toString=' + (opResp.toString ? opResp.toString() : '?'));
                        }
                        return;
                    }

                    fired = 1;
                    const ts = Date.now();
                    // Preserve `.` and `-` for readability (Albion ids like `MORGANA_3003.0001`).
                    // Also strip path separators explicitly for safety on OSS/CI.
                    const safeCluster = (clusterId || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
                    const binPath = '/tmp/cc_' + safeCluster + '_' + ts + '.bin';
                    const metaPath = '/tmp/cc_' + safeCluster + '_' + ts + '.json';

                    // ─── Write payload bytes ─────────────────────────────────
                    try {
                        const f = new File(binPath, 'wb');
                        f.write(payloadBytes);
                        f.close();
                    } catch (ioErr) {
                        console.log('[!] file write failed: ' + (ioErr && ioErr.message ? ioErr.message : ioErr));
                        return;
                    }

                    // ─── Build sidecar JSON ─────────────────────────────────
                    const typeByte = payloadBytes[0] & 0xFF;
                    let typeLabel = 'unknown';
                    if (typeByte === 1) typeLabel = 'dungeon';
                    else if (typeByte === 2) typeLabel = 'mist';
                    else if (typeByte === 3) typeLabel = 'standard_map';

                    const meta = {
                        captured_at: new Date().toISOString(),
                        op_code: TARGET_OP_CODE,
                        cluster_id: clusterId || null,
                        payload_len: payloadBytes.length,
                        type_byte: typeByte,
                        type_label: typeLabel,
                        bin: binPath,
                        asm: cr0Asm,
                        dispatch_rva: dispatchAddr.toString(),
                    };
                    try {
                        const mf = new File(metaPath, 'wb');
                        mf.write(JSON.stringify(meta, null, 2));
                        mf.close();
                    } catch (mErr) {
                        // non-fatal
                    }

                    console.log('[+] CC HIT: type=' + typeLabel + ' (byte=' + typeByte + ') cluster=' + (clusterId || '?') + ' len=' + payloadBytes.length);
                    console.log('[+]   bin :  ' + binPath);
                    console.log('[+]   meta:  ' + metaPath);

                    // ─── Detach immediately ─────────────────────────────────
                    try {
                        interceptor.detach();
                    } catch (e) {}
                } catch (e) {
                    // Never let one bad packet kill us — log and keep hook armed.
                    if (!fired) {
                        console.log('[?] onEnter exception: ' + (e && e.message ? e.message : e));
                    }
                }
            },
        });

        // ─── Soft-timeout: detach if no hit in 60 s ────────────────────────
        setTimeout(function () {
            if (!fired) {
                console.log('[!] ' + (SOFT_TIMEOUT_MS / 1000) + 's timeout — no OC=' + TARGET_OP_CODE + ' captured');
                try {
                    interceptor.detach();
                } catch (e) {}
            }
        }, SOFT_TIMEOUT_MS);

    } catch (e) {
        console.log('[!] hook setup failed: ' + (e && e.message ? e.message : e));
    }
});
