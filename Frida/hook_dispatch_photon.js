'use strict';
/*
 * hook_dispatch_photon.js
 *
 * Comprehensive Photon packet dispatch hook for Albion Online (Unity 6 IL2CPP):
 *   - GameAssembly.so holds the IL2CPP-managed code (dispatcher + handlers)
 *   - Hooks af(EventCodes, cwt) at RVA 0x36BCBF0 (the central Photon dispatcher in client code)
 *   - Hooks all known game-handler entrypoints:
 *       cr0.ael#1, cr0.ael#2,  cr0.v#1, cr0.v#2,
 *       cr0.u#1, cr0.u#2,      cr0.ahx#1, cr0.ahx#2,
 *       cqy.ael (login-level), ck1.af (handler registration)
 *   - Runtime correlates dispatch(code=N) → handler_fired to build a table.
 *
 * Output:
 *   [DISPATCHER] LoginClient.OnEvent code=N  (total=K)
 *   [ROUTED code=N → handler_name]
 *   + summary of dispatchTable[code] = { handler: count }
 *
 * Запуск:
 *   echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/hook_dispatch_photon.js
 */

const HANDLERS = [
    { name: 'cr0.ael#1', rva: 0x03A50194, kind: 'OnEvent' },
    { name: 'cr0.ael#2', rva: 0x03A50344, kind: 'OnEvent' },
    { name: 'cr0.v#1',   rva: 0x03A505E4, kind: 'OnEvent' },
    { name: 'cr0.v#2',   rva: 0x03A50604, kind: 'OnEvent' },
    { name: 'cr0.u#1',   rva: 0x03A52D84, kind: 'OnEvent' },
    { name: 'cr0.u#2',   rva: 0x03A52DC4, kind: 'OnEvent' },
    { name: 'cr0.ahx#1', rva: 0x03A54994, kind: 'OnOperationResponse' },
    { name: 'cr0.ahx#2', rva: 0x03A54A14, kind: 'OnOperationResponse' },
    { name: 'cqy.ael',   rva: 0x19EA0E4,  kind: 'OnEvent(login)' },
    { name: 'ck1.af',    rva: 0x1BBAB10,  kind: 'RegisterHandler' },
];

// Central Photon dispatcher for the current build:
//   class af(EventCodes A_0, cwt A_1)  // RVA: 0x36BCBF0
//   args[0] = this, args[1] = EventCodes (event code, enum), args[2] = cwt (event data object)
const DISPATCHER_RVA  = 0x36BCBF0;

// FOCUS MODE: only EventCodes.KeySync (598) is logged
const KEYSYNC_CODE    = 598;
const PER_HANDLER_CAP  = 32;
const WATCHDOG_MS      = 180 * 1000;

// State
const dispatchHistory = [];                 // recent codes pushed by dispatcher
const dispatchTable   = {};                 // code → { handler: count }
let totalDispatcherHits  = 0;
let totalKeySyncHits     = 0;
let totalHandlerHits     = 0;
let dispatcherHitCapLeft = 200;

function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }
function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }

// ─── Hook all 10 known handler entrypoints ────────────────────────
function attachHandler(gameBase, h) {
    var callsLeft = PER_HANDLER_CAP;
    try {
        Interceptor.attach(gameBase.add(h.rva), {
            onEnter: function(args) {
                if (callsLeft <= 0) return;
                callsLeft--;
                var code = -1;
                try {
                    if (h.kind === 'OnEvent' || h.kind === 'OnEvent(login)' || h.kind === 'RegisterHandler') {
                        code = args[2].toInt32();
                    } else if (h.kind === 'OnOperationResponse') {
                        code = args[2].toInt32();
                    }
                } catch (e) {}
                var displayCode = (code === -1) ? '?' : code;
                // Pair with most recent dispatcher push for same code (heuristic).
                var pairedIdx = -1;
                for (var i = dispatchHistory.length - 1; i >= 0; i--) {
                    if (dispatchHistory[i] === code) { pairedIdx = i; break; }
                }
                if (pairedIdx >= 0) {
                    console.log('   [↳ ' + h.name + ']  code=' + displayCode + ' kind=' + h.kind + '  (correlated with dispatcher push)');
                } else {
                    console.log('   [' + h.name + ']  code=' + displayCode + ' kind=' + h.kind + '  (no recent dispatcher match — handler fired directly?)');
                }
                // Aggregate
                if (!dispatchTable[code]) dispatchTable[code] = {};
                if (!dispatchTable[code][h.name]) dispatchTable[code][h.name] = 0;
                dispatchTable[code][h.name]++;
                totalHandlerHits++;
            }
        });
        console.log('[+] armed ' + h.name.padEnd(13) + ' RVA=0x' + h.rva.toString(16) + ' kind=' + h.kind);
    } catch (e) {
        console.log('[!] FAILED to arm ' + h.name + ' @ RVA=0x' + h.rva.toString(16) + ' => ' + e.message);
    }
}

// ─── static IL2CPP discovery: try to find LoginClient fields ────
function discoverDispatchTableViaBridge() {
    try {
        var lines = [];
        lines.push('[*] bridge: scanning Assembly-CSharp for LoginClient / NetworkPeer classes...');
        var asm = Il2Cpp.domain.assembly('Assembly-CSharp');
        if (!asm) { lines.push('[!] Assembly-CSharp not loaded'); return lines; }
        var image = asm.image;
        var candidates = ['LoginClient', 'NetworkClient', 'GameClient', 'PhotonPeer'];
        for (var ci = 0; ci < candidates.length; ci++) {
            var cls = safe(function(){ return image.class(candidates[ci]); }, null);
            if (!cls) continue;
            lines.push('   found: ' + candidates[ci] + '  instanceSize=' + (cls.instanceSize||'?'));
            var fields = safe(function(){ return cls.fields; }, null);
            if (fields) {
                for (var i = 0; i < fields.length; i++) {
                    var f = fields[i];
                    var tn = safe(function(){ return f.type && f.type.name || ''; }, '');
                    if (/Dictionary/.test(tn) || /List/.test(tn) || /Action/.test(tn) || /byte/.test(tn)) {
                        lines.push('      field: ' + (f.name||'?') + ' : ' + tn + ' @+0x' + (f.offset||0).toString(16));
                    }
                }
            }
            // Walk methods looking for OnEvent/OnOperationResponse
            var methods = safe(function(){ return cls.methods; }, null);
            if (methods) {
                var mlist = Array.from(methods);
                for (var mi = 0; mi < mlist.length; mi++) {
                    var m = mlist[mi];
                    if (m && m.name && /OnEvent|OnOperation|HandleEvent|Dispatch/.test(m.name)) {
                        lines.push('      method: ' + m.name);
                    }
                }
            }
        }
        return lines;
    } catch (e) {
        return ['[!] bridge-scan error: ' + e.message];
    }
}

// ─── ce1 static-registry dump: full EventCodes/OperationCodes → Type at startup ────
// ce1 is the PhotonRegistry class (TypeDefIndex 16970):
//   c: Dictionary<EventCodes,      Type>
//   d: Dictionary<EventCodes,      List<Type>>
//   a: Dictionary<OperationCodes,  Type>
//   b: Dictionary<OperationCodes,  List<Type>>
//   e/f: reverse maps (Type → short code)
function dumpCe1Registry() {
    try {
        var lines = [];
        Il2Cpp.perform(function() {
            var asm = Il2Cpp.domain.assembly('Assembly-CSharp');
            if (!asm) { lines.push('[!] Assembly-CSharp not loaded'); return; }

            // Find ce1 class (obfuscated name; TypeDefIndex 16970)
            var ce1 = null;
            try { ce1 = asm.image.class('ce1'); } catch (e) {}
            if (!ce1) {
                try {
                    var classes = asm.image.classes;
                    for (var i = 0; i < classes.length; i++) {
                        if (classes[i].name === 'ce1') { ce1 = classes[i]; break; }
                    }
                } catch (e) {}
            }
            if (!ce1) { lines.push('[!] ce1 (TypeDefIndex 16970) not found in Assembly-CSharp'); return; }
            lines.push('[*] ce1 found (TypeDefIndex=' + (ce1.typeDefinitionIndex||'?') + ', instanceSize=' + (ce1.instanceSize||'?') + ')');

            // Helper: try to resolve a value object to its type/class name
            function resolveTypeName(v) {
                try {
                    if (v === null || v === undefined) return 'null';
                    if (v.class && v.class.name) {
                        var ns = v.class.namespace || '';
                        return ns ? ns + '.' + v.class.name : v.class.name;
                    }
                    if (v.name) return String(v.name);
                    if (typeof v === 'string') return v;
                    return String(v);
                } catch (e) { return '?'; }
            }

            // Helper: enumerate a Dictionary<TKey, TValue> via three fallback strategies
            function dumpDict(fieldName, label) {
                try {
                    var field = ce1.field(fieldName);
                    if (!field) { lines.push('   ' + label + ': field "' + fieldName + '" not found'); return; }
                    var dict = field.readStaticValue();
                    if (!dict) { lines.push('   ' + label + ': null (registry not yet populated)'); return; }

                    var entries = [];

                    // Strategy 1: bridge .entries() iterator (newer bridge)
                    if (!entries.length && typeof dict.entries === 'function') {
                        try {
                            for (var it = dict.entries(); !it.done; ) {
                                var pair = it.value;
                                entries.push({ key: pair[0], value: pair[1] });
                            }
                        } catch (e) {}
                    }

                    // Strategy 2: walk _entries[0.._count) using key/value fields
                    if (!entries.length) {
                        try {
                            var dictCls = dict.class;
                            var entriesField = dictCls.field('_entries');
                            var countField = dictCls.field('_count');
                            if (entriesField && countField) {
                                var arr = entriesField.readValue(dict);
                                var total = countField.readValue(dict).toInt32();
                                for (var i = 0; i < total; i++) {
                                    try {
                                        var e = arr.get(i);
                                        var k = e.field('key').readValue(e);
                                        var v = e.field('value').readValue(e);
                                        entries.push({ key: k, value: v });
                                    } catch (e2) {}
                                }
                            }
                        } catch (e) {}
                    }

                    // Strategy 3: walk _buckets + _entries via next-chain (hash-map traversal)
                    if (!entries.length) {
                        try {
                            var buckets = dict.class.field('_buckets').readValue(dict);
                            var entriesArr = dict.class.field('_entries').readValue(dict);
                            var count = dict.class.field('_count').readValue(dict).toInt32();
                            var seen = 0;
                            for (var bi = 0; bi < buckets.length && seen < count; bi++) {
                                var idx = buckets.get(bi).toInt32();
                                while (idx >= 0 && seen < count) {
                                    try {
                                        var e = entriesArr.get(idx);
                                        var k = e.field('key').readValue(e);
                                        var v = e.field('value').readValue(e);
                                        entries.push({ key: k, value: v });
                                        idx = e.field('next').readValue(e).toInt32();
                                        seen++;
                                    } catch (e2) { break; }
                                }
                            }
                        } catch (e) {}
                    }

                    if (!entries.length) {
                        lines.push('   ' + label + ': enumeration failed (tried entries() / _entries / _buckets, all empty)');
                        return;
                    }

                    lines.push('[*] ' + label + ': ' + entries.length + ' entries (FOCUS: only KeySync=' + KEYSYNC_CODE + ')');
                    var foundKeySync = false;
                    for (var i = 0; i < entries.length; i++) {
                        var en = entries[i];
                        var code = '?';
                        try { code = en.key.toInt32(); } catch (e) { try { code = String(en.key); } catch (e2) {} }
                        if (code !== KEYSYNC_CODE) continue;   // FOCUS MODE
                        foundKeySync = true;
                        lines.push('   >>> KeySync handler  code=' + code + '  →  ' + resolveTypeName(en.value));
                    }
                    if (!foundKeySync) {
                        lines.push('   (no entry for code=' + KEYSYNC_CODE + ' in this dict)');
                    }
                } catch (e) {
                    lines.push('   ' + label + ': error: ' + e.message);
                }
            }

            // Dump all 4 forward maps (events + operations, single + list)
            dumpDict('c', 'ce1.c (Dictionary<EventCodes,     Type>)');
            dumpDict('d', 'ce1.d (Dictionary<EventCodes,     List<Type>>)');
            dumpDict('a', 'ce1.a (Dictionary<OperationCodes, Type>)');
            dumpDict('b', 'ce1.b (Dictionary<OperationCodes, List<Type>>)');
        });
        return lines;
    } catch (e) {
        return ['[!] dumpCe1Registry error: ' + e.message];
    }
}

// ─── main ───────────────────────────────────────────────────────
function init() {
    var gameBase = null;
    Process.enumerateModules().forEach(function(m) {
        if (m.name === 'GameAssembly.so') gameBase = m.base;
    });
    if (!gameBase) {
        console.log('[!] GameAssembly.so not found — abort');
        return;
    }
    console.log('[*] GameAssembly.so base = ' + hp(gameBase));
    console.log('[*] === HOOK_DISPATCH_PHOTON (FOCUS: only KeySync=' + KEYSYNC_CODE + ') ===\n');

    // ─── Hook central dispatcher first so its push lands in dispatchHistory ───
    var dispAddr = gameBase.add(DISPATCHER_RVA);
    Interceptor.attach(dispAddr, {
        onEnter: function(args) {
            if (dispatcherHitCapLeft <= 0) return;
            dispatcherHitCapLeft--;
            var code = -1;
            try { code = args[1].toInt32(); } catch (e) {}    // af(EventCodes A_0, cwt A_1) → args[1] is EventCodes
            if (code === -1) code = '?';
            totalDispatcherHits++;
            // FOCUS MODE: log only KeySync (598), other codes are counted but silent
            if (code !== KEYSYNC_CODE) return;
            totalKeySyncHits++;
            dispatchHistory.push(code);
            if (dispatchHistory.length > 128) dispatchHistory.shift();
            console.log('\n[KeySync #' + totalKeySyncHits + ']  af(EventCodes, cwt)  code=' + code + '   totalDispatcher=' + totalDispatcherHits);
            // === Extract the 8-byte salt from cwt.Parameters ===
            extractKeySyncSalt(args[2]);
        }
    });
    console.log('[+] armed af(EventCodes, cwt)  RVA=0x' + DISPATCHER_RVA.toString(16) + '   (the central Photon dispatcher for this build)');

    // ─── Hook all 10 known handler entrypoints ────────────────
    HANDLERS.forEach(function(h) { attachHandler(gameBase, h); });

    // ─── Static discovery via frida-il2cpp-bridge (best-effort) ───
    try {
        Il2Cpp.perform(function() {
            var lines = discoverDispatchTableViaBridge();
            for (var i = 0; i < lines.length; i++) console.log(lines[i]);
        });
    } catch (e) {
        console.log('[!] bridge-discovery error: ' + e.message);
    }

    // ─── ce1 static-registry dump: full code→handler_type table at startup ───
    try {
        var regLines = dumpCe1Registry();
        for (var ri = 0; ri < regLines.length; ri++) console.log(regLines[ri]);
        console.log('[*] ce1 registry dump done. (если пусто — реестр ещё не заполнен; hook продолжит работать)');
    } catch (e) {
        console.log('[!] ce1-registry-dump error: ' + e.message);
    }

    // ─── Watchdog + dump final dispatch table ────────
    setTimeout(function() {
        console.log('\n[*] === watchdog detach ===');
        console.log('[*] === DISPATCH TABLE (built from runtime correlation) ===');
        var codes = Object.keys(dispatchTable);
        if (!codes.length) {
            console.log('   (empty — нужно поиграть и сгенерировать Photon-трафик)');
        } else {
            codes.forEach(function(c) {
                var handlers = dispatchTable[c];
                var handlerNames = Object.keys(handlers);
                var pairings = handlerNames.map(function(h) { return h + '×' + handlers[h]; });
                var displayCode = (c === '?' || c === -1) ? '?' : c;
                console.log('   code=' + displayCode + '  →  ' + pairings.join(', '));
            });
        }
        console.log('\nSummary:');
        console.log('  total dispatcher calls   : ' + totalDispatcherHits);
        console.log('  total KeySync (598) calls: ' + totalKeySyncHits);
        console.log('  total handler calls      : ' + totalHandlerHits);
        console.log('  unique codes correlated  : ' + codes.length);
        console.log('===========================================\n');
        /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
    }, WATCHDOG_MS);

    console.log('\n[*] all hooks armed. Watchdog ' + (WATCHDOG_MS/1000) + 's.');
    console.log('[*] Чтобы наполнить таблицу: открой Albion, поброди по карте,');
    console.log('[*] поатакуй мобов / подбери лут / заглянь в магазин — каждое действие');
    console.log('[*] триггерит Photon event code которое будет скоррелирован.');
}

// Boot — просто вызываем init(); bridge-scan уже inline внутри init()
// (ранее была nested Il2Cpp.perform — FIX: убрано)
try {
    init();
} catch (e) {
    console.log('[!] init error: ' + e.message);
}

// ─── KeySync salt extraction ────────────────────────────────────────────
// KeySync event (code 598) carries an 8-byte salt that, combined with the
// session key from handshake, derives the AES key used for subsequent
// encrypted packets (movement coordinates, dungeon layouts, etc.).
//
// We try to extract the salt from cwt (EventData) → Parameters Dictionary.
// The Parameters entry is typically a byte[] of length 8, but we don't
// hardcode the key — we walk every entry and pick any Byte[] with length 8
// (or Int16[4] / Int32[2] as alternates). Function is hoisted, so it works
// from the dispatcher onEnter even though it's declared here.
function extractKeySyncSalt(evObj) {
    if (!evObj) { console.log('   [SALT] no event object'); return; }
    try {
        var paramField = evObj.class ? evObj.class.field('Parameters') : null;
        if (!paramField) { console.log('   [SALT] no Parameters field on cwt (class=' + (evObj.class && evObj.class.name) + ')'); return; }
        var paramsDict = paramField.readValue(evObj);
        if (!paramsDict) { console.log('   [SALT] Parameters is null'); return; }

        // Walk Dictionary via _entries[0.._count) (most reliable across IL2CPP versions)
        var dictCls = paramsDict.class;
        if (!dictCls) { console.log('   [SALT] Parameters has no class'); return; }
        var entriesField = dictCls.field('_entries');
        var countField = dictCls.field('_count');
        if (!entriesField || !countField) { console.log('   [SALT] Dictionary internals (_entries/_count) not found'); return; }

        var arr = entriesField.readValue(paramsDict);
        var total = 0;
        try { total = countField.readValue(paramsDict).toInt32(); } catch (e) { total = 0; }

        var foundAny = false;
        for (var i = 0; i < total; i++) {
            try {
                var ent = arr.get(i);
                if (!ent || !ent.field) continue;
                var k = ent.field('key').readValue(ent).toInt32();
                var v = ent.field('value').readValue(ent);
                if (!v || !v.class) continue;
                var vname = v.class.name || '';

                // Strategy 1: Byte[] of length 8 → THE SALT
                // (Photon salt is always byte[8] in standard protocol; per code-reviewer,
                //  alt-encoding strategies were speculative noise — removed.)
                if (vname === 'Byte[]') {
                    var len = -1;
                    try {
                        if (typeof v.length === 'number') len = v.length;
                        else {
                            var lf = v.class.field('_length') || v.class.field('Length');
                            if (lf) len = lf.readValue(v).toInt32();
                        }
                    } catch (e) {}
                    if (len === 8) {
                        var hex = '';
                        for (var bi = 0; bi < 8; bi++) {
                            var b = v.get(bi).toInt32() & 0xff;
                            hex += ('0' + b.toString(16)).slice(-2);
                        }
                        console.log('   [SALT] key=' + k + '  len=8  bytes=' + hex);
                        foundAny = true;
                    } else {
                        console.log('   [SALT-DBG] key=' + k + '  Byte[] len=' + len + '  (not 8 — skip)');
                    }
                }
                // Debug: log other param types so we can see what else is in the packet
                else {
                    try {
                        if (vname === 'String' && typeof v.readCString === 'function') {
                            var s = v.readCString();
                            if (s && s.length < 80) console.log('   [SALT-DBG] key=' + k + '  String="' + s + '"');
                        } else if (/^Int/.test(vname) && typeof v.toInt32 === 'function') {
                            console.log('   [SALT-DBG] key=' + k + '  ' + vname + '=' + v.toInt32());
                        } else if (/^Boolean/.test(vname)) {
                            console.log('   [SALT-DBG] key=' + k + '  Boolean=' + (v.toInt32() !== 0));
                        } else {
                            console.log('   [SALT-DBG] key=' + k + '  ' + vname);
                        }
                    } catch (e) {}
                }
            } catch (e3) {}
        }
        if (!foundAny) {
            console.log('   [SALT] no 8-byte salt found in Parameters (total=' + total + ' entries)');
        }
    } catch (e) {
        console.log('   [SALT] extract error: ' + e.message);
    }
}
