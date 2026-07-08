'use strict';
/*
 * lib_offsets_discovery.js
 *
 * Shared module: provides C++ GameObject offset discovery via Camera.main.
 * Loaded via `frida -l lib_offsets_discovery.js -l main_script.js` chain.
 * After this loads, the following globals are available to all subsequent scripts:
 *
 *   FALLBACK_GO_ID_OFF    int   — fallback offset for m_InstanceID
 *   FALLBACK_NODE_TO_GO   int   — fallback offset for Node↔GO delta
 *   FALLBACK_COMP_PROBES  list  — fallback probe offsets for m_Components
 *   discoverGameObjectOffsets()   — returns fresh {instanceIdOff, nodeToGo, compArrOff, compStride}
 *
 * Standalone (no bridge connection) safe: the discover function gracefully returns
 * fallback values if the bridge isn't ready or Camera.main is null.
 */

// ─── Default fallback constants (overridable per-script by re-assigning) ───
var FALLBACK_GO_ID_OFF    = 0x10;   // try in order: 0x08, 0x10, 0x0c, etc.
var FALLBACK_NODE_TO_GO   = 0x68;
var FALLBACK_COMP_PROBES = [
    { arr: 0x28, cnt: 0x30, s: 8 },
    { arr: 0x30, cnt: 0x38, s: 8 },
    { arr: 0x38, cnt: 0x40, s: 8 },
    { arr: 0x40, cnt: 0x48, s: 8 },
    { arr: 0x48, cnt: 0x50, s: 8 },
    { arr: 0x30, cnt: 0x38, s: 16 },
    { arr: 0x38, cnt: 0x40, s: 16 },
    { arr: 0x40, cnt: 0x48, s: 16 },
];

// ─── Shared helpers (used by this lib + reusable) ──────────────────────────
function _safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }

// ─── CORE: discoverGameObjectOffsets() ──────────────────────────────────────
// Probe C++ GameObject memory via bridge to discover m_InstanceID + m_Components.
// Uses Camera.main as ground-truth (cam.gameObject gives m_CachedPtr + GetInstanceID).
// Returns {instanceIdOff, nodeToGo, compArrOff|null, compStride|8}.
function discoverGameObjectOffsets() {
    var R = {
        instanceIdOff: FALLBACK_GO_ID_OFF,
        nodeToGo:      FALLBACK_NODE_TO_GO,
        compArrOff:    null,
        compStride:    8,
    };
    try {
        var coreAsm = Il2Cpp.domain.assembly('UnityEngine.CoreModule');
        if (!coreAsm) { console.log('[!] lib: CoreModule not loaded'); return R; }
        var Camera = coreAsm.image.class('UnityEngine.Camera');
        if (!Camera)  { console.log('[!] lib: no Camera class'); return R; }
        var getMain = Camera.method('get_main');
        if (!getMain) { console.log('[!] lib: no get_main method'); return R; }

        var cam = _safe(function(){ return getMain.invoke(null); }, null);
        if (!cam || !cam.handle || cam.handle.isNull()) { console.log('[!] lib: Camera.main null — using fallback'); return R; }

        var go = _safe(function(){ return cam.method('get_gameObject').invoke(); }, null);
        if (!go || !go.handle || go.handle.isNull()) { console.log('[!] lib: cam.gameObject null'); return R; }

        var nativeGo  = _safe(function(){ return go.field('m_CachedPtr').value; }, null);
        var nativeCam = _safe(function(){ return cam.field('m_CachedPtr').value; }, null);
        var expectedId = _safe(function(){ return go.method('GetInstanceID').invoke(); }, 0);

        if (!nativeGo || (nativeGo.isNull && nativeGo.isNull())) { console.log('[!] lib: nativeGo m_CachedPtr null'); return R; }

        // 1. m_InstanceID — scan int32 slots in first 0x20 bytes
        for (var off = 0x00; off <= 0x20; off += 4) {
            try {
                if (nativeGo.add(off).readS32() === expectedId) {
                    R.instanceIdOff = off;
                    console.log('[+] lib: m_InstanceID @ +0x' + off.toString(16));
                    break;
                }
            } catch (e) {}
        }

        // 2. m_Components buffer — looking for nativeCam pointer in nearby arrays
        for (var off = 0x10; off <= 0x100; off += 8) {
            try {
                var arr = nativeGo.add(off).readPointer();
                if (!arr || (arr.isNull && arr.isNull())) continue;
                if (arr.compare && arr.compare(0x10000) < 0) continue;
                for (var j = 0; j < 4; j++) {
                    try {
                        if (nativeCam && arr.add(j * 8).readPointer().equals(nativeCam)) {
                            R.compArrOff = off; R.compStride = 8;
                            console.log('[+] lib: m_Components @ +0x' + off.toString(16) + ' stride=8 (cam idx '+j+')');
                            break;
                        }
                        if (nativeCam && arr.add(j * 16 + 8).readPointer().equals(nativeCam)) {
                            R.compArrOff = off; R.compStride = 16;
                            console.log('[+] lib: m_Components @ +0x' + off.toString(16) + ' stride=16 (cam idx '+j+'+8)');
                            break;
                        }
                    } catch (e) {}
                }
                if (R.compArrOff !== null) break;
            } catch (e) {}
        }
    } catch (e) {
        console.log('[!] lib: discover error: ' + e.message);
    }
    return R;
}

console.log('[*] lib_offsets_discovery.js loaded — discoverGameObjectOffsets() ready');
