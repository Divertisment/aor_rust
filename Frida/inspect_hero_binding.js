// /home/stas/AOR_rust/AOR_core/Frida/inspect_hero_binding.js
// Read-only Frida-introspection: discovers how the IL2CPP Hero MonoBehaviour
// binds to its GameObject and where the player name string lives.
//
// Usage:
//   frida -p 2539 --no-pause -q \
//     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/agent/index.js \
//     -l <this file>.js
'use strict';

const TARGET_ASSEMBLY = 'Assembly-CSharp';
const SIGNATURE = Object.freeze([
    { offset: 0x10, type: 'Int32',  label: 'id' },
    { offset: 0x38, type: 'Single', label: 'X'  },
    { offset: 0x3c, type: 'Single', label: 'Y'  },
]);

function collectInstanceFields(klass) {
    const out = [];
    let cur = klass, depth = 0;
    while (cur && depth < 64) {
        for (const f of cur.fields) out.push(f);
        cur = cur.parent; depth++;
    }
    return out;
}

Il2Cpp.perform(() => {
    console.log('[*] === Hero class field/offset discovery ===');

    const assembly = Il2Cpp.domain.assembly(TARGET_ASSEMBLY);
    if (assembly === null) { console.error('[!] Assembly-CSharp not loaded'); return; }

    const matches = [];
    for (const klass of assembly.image.classes) {
        let hasSmall = false;
        for (const f of collectInstanceFields(klass)) {
            if (f.offset <= 0x3c) { hasSmall = true; break; }
        }
        if (!hasSmall) continue;
        const idx = new Map();
        for (const f of collectInstanceFields(klass)) {
            const key = `${f.offset}:${f.type.name}`;
            if (!idx.has(key)) idx.set(key, f);
        }
        let ok = true;
        for (const req of SIGNATURE) {
            if (!idx.has(`${req.offset}:${req.type}`)) { ok = false; break; }
        }
        if (ok) matches.push(klass);
    }

    console.log(`[+] Hero candidates (id@0x10 + X@0x38 + Y@0x3c): ${matches.length}`);

    for (const k of matches) {
        const name = k.namespace ? `${k.namespace}.${k.name}` : k.name;
        console.log(`\n========== ${name} ==========`);
        console.log(`size=${k.instanceSize}b abstract=${k.isAbstract} sealed=${k.isSealed}`);

        let cur = k, depth = 0;
        while (cur && depth < 64) {
            const cName = cur.namespace ? `${cur.namespace}.${cur.name}` : cur.name;
            console.log(`\n-- depth=${depth} class ${cName} --`);
            let fcount = 0;
            for (const f of cur.fields) {
                console.log(`  +0x${f.offset.toString(16).padStart(4,'0')}  ${f.type.name.padEnd(15)}  "${f.name}"`);
                fcount++;
            }
            for (const p of cur.properties) {
                const flags = (p.get ? 'get ' : '    ') + (p.set ? 'set ' : '    ');
                console.log(`  PROPERTY   ${flags}${p.type.name.padEnd(15)}  "${p.name}"`);
            }
            console.log(`  (${fcount} instance fields)`);
            cur = cur.parent; depth++;
        }
    }

    console.log(`\n=== UnityEngine.Component / Object (back-reference / cachedPtr) ===`);
    const obj = Il2Cpp.image('UnityEngine.CoreModule').class('Object');
    if (obj) {
        let cur = obj, depth = 0;
        while (cur && depth < 10) {
            const cName = cur.namespace ? `${cur.namespace}.${cur.name}` : cur.name;
            for (const f of cur.fields) {
                const n = f.name.toLowerCase();
                if (n.includes('cached') || n.includes('gameobject') || n.startsWith('m_') || n === 'name') {
                    console.log(`  [${cName}] +0x${f.offset.toString(16).padStart(4,'0')}  ${f.type.name.padEnd(15)}  "${f.name}"`);
                }
            }
            cur = cur.parent; depth++;
        }
    }

    console.log(`\n=== UnityEngine.GameObject (m_Name) ===`);
    const go = Il2Cpp.image('UnityEngine.CoreModule').class('GameObject');
    if (go) {
        let cur = go, depth = 10;
        while (cur && depth >= 0) {
            const cName = cur.namespace ? `${cur.namespace}.${cur.name}` : cur.name;
            for (const f of cur.fields) {
                if (f.name.toLowerCase().includes('name')) {
                    console.log(`  [${cName}] +0x${f.offset.toString(16).padStart(4,'0')}  ${f.type.name.padEnd(15)}  "${f.name}"`);
                }
            }
            for (const p of cur.properties) {
                if (p.name === 'name') {
                    const flags = (p.get ? 'get;' : '') + (p.set ? 'set;' : '');
                    console.log(`  PROPERTY [${cName}] "${p.name}" : ${p.type.name}  ${flags}`);
                }
            }
            cur = cur.parent; depth--;
        }
    }

    console.log(`[*] === dump complete ===`);
});
