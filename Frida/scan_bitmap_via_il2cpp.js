'use strict';
/*
 * scan_bitmap_via_il2cpp.js
 *
 * Companion to /mnt/hgfs/D/AOR_linux_mem/scan_passability.py.  When the
 * kernel-driver brute-force scan can't surface the passability bitmap
 * (heuristic too aggressive / wrong-length / wrong-shape), this script
 * asks Unity IL2CPP directly: "which classes look like map / walkability
 * data, what are their fields, and what methods on them look like good
 * RVA targets for static analysis in IDA?".
 *
 * Uses frida-il2cpp-bridge so we iterate classes by NAME (with field
 * metadata) instead of byte-dancing raw-pointer headers.
 *
 * PROJECT RULE: always run under sudo
 *     echo 31271 | sudo -S frida --pid=4414 --runtime=v8 \
 *         -l frida-il2cpp-bridge \
 *         -l /mnt/hgfs/D/AOR_core/Frida/scan_bitmap_via_il2cpp.js
 *
 * The script only READS game memory; it never writes or attaches hooks.
 *
 * OUTPUT (three layers):
 *   1) Human-readable: per-class section with fields + methods, indented,
 *      tagged [own] / [1-up: BaseName] / ... for the 4-deep parent walk.
 *   2) Machine-parseable: each interesting method emits a TSV line
 *        METHOD\t<class.fullname>\t<method.name>\t<RVA>\t<nparams>\t<returntype>
 *      so the user can `grep ^METHOD | awk` to build a static-analyzer
 *      table for IDA (idc.get_name_ea_simple).
 *   3) Stats footer: total classes + total methods emitted.
 */

const INTERESTING_NAME  = /Map|Grid|Nav|Walk|Block|Terrain|Tile|Pass|Hard|Solid|World|Cluster/i;
const SKIP_NAMESPACES   = ['System.', 'UnityEngine.',
                           'Mono.', 'Microsoft.',
                           'Newtonsoft.', 'Moga.', 'UMA.'];
const IS_ARRAY          = /\[\]/;

// Method-name filter.  Only methods whose name matches one of these
// verbs are interesting for the collision-map / static-field hunt.
//
// NOTE: deliberately EXCLUDES the bare tokens "Is" and "Has" — those
// match every Unity property accessor (get_IsAlive, set_HasTarget, ...)
// and drown the TSV in noise.  If you really want them, re-add with
// word-boundary anchors: /\bIs\b|\bHas\b|.../i, but expect >5k hits.
const METHOD_NAME_RE    = /Load|Get|Set|Init|Update|Apply|Pass|Collide|Walk|Refresh|Build|Create|Destroy|Add|Remove|On|Check/i;

// Cap on classes inspected (safety against MegaLibs/Addressables noise).
const MAX_HITS          = 256;
// Cap on methods printed (TSV gets long fast).
const MAX_METHODS       = 4096;
// Maximum parent-depth to walk (0 = leaf, 1..3 = base/grand/great).
const MAX_PARENT_DEPTH  = 4;

let totalHits    = 0;
let totalMethods = 0;
let methodCapHit = false;

function fieldKind(field) {
    const name = field.type.name || '';
    if (IS_ARRAY.test(name))       return 'array';
    if (name.startsWith('Il2Cpp') || name.startsWith('System.')) return 'managed';
    if (name === 'bool')           return 'bool';
    if (name === 'int' || name === 'uint' || name === 'long') return 'int';
    return 'other';
}

// frida-il2cpp-bridge has shipped several API names for the method's
// RVA over its versions; cope with all of them.
function methodRva(m) {
    const rva = m.relativeVirtualAddress
             ?? m.virtualAddress
             ?? m.rva
             ?? null;
    if (rva == null || typeof rva !== 'number') return '?';
    return '0x' + rva.toString(16);
}

function slotIndex(m) {
    const s = m.slot ?? m.virtualSlot ?? null;
    return (s == null) ? '?' : String(s);
}

function paramCount(m) {
    // parametersCount is the frida-il2cpp-bridge property; fall back
    // to parameters.length for older versions.
    if (typeof m.parametersCount === 'number') return m.parametersCount;
    if (Array.isArray(m.parameters))           return m.parameters.length;
    return '?';
}

function returnTypeName(m) {
    if (m.returnType && m.returnType.name) return m.returnType.name;
    return '?';
}

function fullClassName(klass) {
    return (klass.namespace ? klass.namespace + '.' : '') + klass.name;
}

function printClass(klass) {
    const fullName = fullClassName(klass);
    const size = klass.instanceSize ? `0x${klass.instanceSize.toString(16)}` : '?';
    console.log(`\n=== ${fullName}  (instanceSize=${size}) ===`);

    // Walk this class + parents up to MAX_PARENT_DEPTH levels so we also
    // see inherited MonoBehaviour state (PassabilityBehaviour inherits
    // ClusterBehaviour inherits MonoBehaviour in many Unity projects).
    let cursor = klass;
    let depth  = 0;
    while (cursor && depth < MAX_PARENT_DEPTH) {
        const headerTag = depth === 0
            ? '[own]'
            : `[${depth}-up: ${cursor.name}]`;
        try {
            const fields = cursor.fields || [];
            for (const f of fields) {
                const kind = fieldKind(f);
                const highlight = (kind === 'array' || kind === 'bool')
                                  ? '  <--- LOOK HERE' : '';
                const offHex = (f.offset ?? 0).toString(16).padStart(3, '0');
                console.log(`  ${headerTag}  +0x${offHex} `
                            + `${(f.type.name || '?').padEnd(28)}  `
                            + `${f.name || '<anon>'}${highlight}`);
            }
        } catch (e) {
            console.log(`  ${headerTag}  <field-walk failed: ${e.message}>`);
            break;
        }
        cursor = cursor.parent;
        depth++;
    }
}

function printMethods(klass) {
    // Walk the same hierarchy as printClass so we surface overridden
    // methods (the leaf class's version wins, but base class members
    // can still be useful for finding virtual call sites in IDA).
    let cursor = klass;
    let depth  = 0;
    let printed = 0;
    while (cursor && depth < MAX_PARENT_DEPTH) {
        const headerTag = depth === 0
            ? '[own]'
            : `[${depth}-up: ${cursor.name}]`;
        try {
            const methods = cursor.methods || [];
            for (const m of methods) {
                if (totalMethods >= MAX_METHODS) { methodCapHit = true; return; }
                if (!m || !m.name) continue;
                if (!METHOD_NAME_RE.test(m.name)) continue;
                const rvaStr   = methodRva(m);
                const nparams  = paramCount(m);
                const ret      = returnTypeName(m);
                const slot     = slotIndex(m);
                const offHex   = rvaStr === '?' ? '????????'
                                  : rvaStr.replace(/^0x/, '').padStart(8, '0');
                // Human line.
                console.log(`  ${headerTag}  ${rvaStr}  `
                            + `${(m.name).padEnd(40)} `
                            + `(slot=${slot}, ${nparams} args) -> ${ret}`);
                // Machine-parseable line.
                const fullName = fullClassName(klass);
                console.log(`METHOD\t${fullName}\t${m.name}\t${rvaStr}\t`
                            + `${slot}\t${nparams}\t${ret}`);
                totalMethods++;
                printed++;
            }
        } catch (e) {
            console.log(`  ${headerTag}  <method-walk failed: ${e.message}>`);
            break;
        }
        cursor = cursor.parent;
        depth++;
    }
    if (printed > 0) {
        console.log(`  -- ${printed} interesting method(s) on this class hierarchy`);
    }
}

Il2Cpp.perform(() => {
    console.log('[*] scanning assemblies for map / grid / nav / walkability classes...');
    console.log('[*] method filter: /' + METHOD_NAME_RE.source + '/');
    for (const asm of Il2Cpp.domain.assemblies) {
        if (!asm.image || !Array.isArray(asm.image.classes)) continue;
        for (const klass of asm.image.classes) {
            if (totalHits >= MAX_HITS) {
                console.log(`[+] class cap hit (${MAX_HITS}); truncating`);
                return;
            }
            const ns = klass.namespace || '';
            const nm = klass.name || '';
            if (SKIP_NAMESPACES.some(p => ns.startsWith(p))) continue;
            if (!INTERESTING_NAME.test(nm) && !INTERESTING_NAME.test(ns)) continue;
            // Speculative hit. Print class + flattened fields + methods.
            printClass(klass);
            printMethods(klass);
            totalHits++;
            if (methodCapHit) {
                console.log(`[+] method cap hit (${MAX_METHODS}); truncating`);
                return;
            }
        }
    }
    console.log(`\n[*] done. ${totalHits} candidate class(es), ${totalMethods} method(s).`);
    if (methodCapHit) {
        console.log(`    (truncated at MAX_METHODS=${MAX_METHODS}; raise it if needed)`);
    }
});
