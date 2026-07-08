// /home/stas/AOR_rust/AOR_core/Frida/inspect_hero_binding_v2.js
// Read-only Frida introspection: discovers how IL2CPP Hero MonoBehaviour
// binds to its GameObject and where the player name string lives.
//
// Run under sudo (game pid is owned by the same user, but frida attach needs
// ptrace rights — running via `echo pw | sudo -S -E frida -p <pid>` works):
//   echo '31271' | sudo -S -E frida -p 2539 \
//     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
//     -l <this file>.js
'use strict';

const TARGET_ASSEMBLY = 'Assembly-CSharp';

Il2Cpp.perform(() => {
    console.log('[*] === diagnostic: Assembly-CSharp scan ===');

    const assembly = Il2Cpp.domain.assembly(TARGET_ASSEMBLY);
    if (!assembly) { console.error('[!] Assembly-CSharp missing'); return; }
    if (!assembly.image || !Array.isArray(assembly.image.classes)) {
        console.error('[!] Assembly-CSharp has no image.classes'); return;
    }

    // ─── helpers (null-safe) ───────────────────────────────────────────
    function nameOf(klass) {
        const ns = klass?.namespace ?? '';
        const n  = klass?.name ?? '<anon>';
        return ns ? `${ns}.${n}` : n;
    }
    function safeFields(klass) {
        const arr = klass?.fields;
        return Array.isArray(arr) ? arr : [];
    }
    function flatFields(klass) {
        const all = [];
        let cur = klass, d = 0;
        while (cur && d < 64) {
            try {
                for (const f of safeFields(cur)) all.push(f);
            } catch (e) { /* skip broken class */ }
            try { cur = cur.parent; } catch (e) { cur = null; }
            d++;
        }
        return all;
    }
    function fmtOffset(off) {
        const n = (off ?? 0);
        return '0x' + n.toString(16).padStart(4, '0');
    }
    function fmtField(f) {
        const typeName = f?.type?.name ?? '?';
        const fieldName = f?.name ?? '<unnamed>';
        return `${fmtOffset(f?.offset)}  ${typeName.padEnd(15)}  "${fieldName}"`;
    }

    // ─── 1. Hero candidates by signature (loose) ─────────────────--------
    const sigHits = [];
    for (const klass of assembly.image.classes) {
        const all = flatFields(klass);
        const idx = new Map();
        for (const f of all) {
            const tname = f?.type?.name ?? '';
            const key = `${f?.offset ?? -1}:${tname}`;
            if (!idx.has(key)) idx.set(key, f);
        }
        const idOk   = idx.has('16:Int32')  || idx.has('10:Int32');       // 0x10 = 16
        const xOk    = idx.has('56:Single') || idx.has('38:Single');       // 0x38 = 56
        const yOk    = idx.has('60:Single') || idx.has('3c:Single');       // 0x3c = 60
        if (idOk && xOk && yOk) {
            sigHits.push({ klass, all, idx });
        }
    }
    console.log(`[+] signature match (id@0x10 + X@0x38 + Y@0x3c, all Single): ${sigHits.length}`);

    for (const m of sigHits) {
        try {
            console.log(`\n========== ${nameOf(m.klass)} ==========`);
            console.log(`size=${m.klass.instanceSize}b abstract=${m.klass.isAbstract ?? '?'} sealed=${m.klass.isSealed ?? '?'}`);
            let cur = m.klass, d = 0;
            while (cur && d < 64) {
                try {
                    console.log(`-- depth=${d} ${nameOf(cur)} --`);
                    for (const f of safeFields(cur)) console.log('  ' + fmtField(f));
                } catch (e) { console.log(`-- depth=${d} [broken: ${e?.message ?? e}] --`); }
                try { cur = cur.parent; } catch (e) { cur = null; }
                d++;
            }
            console.log('matched keys:');
            for (const [k, f] of m.idx) console.log(`   ${k.padEnd(11)} → "${f?.name ?? '?'}"`);
        } catch (e) {
            console.log(`[!] signature match dump failed for one class:`, e?.message ?? e);
        }
    }

    // ─── 2. Hero candidates by NAME (broader) ───────────────────────────
    const nameHits = [];
    for (const klass of assembly.image.classes) {
        const fullName = nameOf(klass);
        if (/player|character|hero|local|hero|silver/i.test(fullName)) {
            nameHits.push({ klass, name: fullName });
        }
    }
    console.log(`\n[+] name match (Player/Character/Hero/Local): ${nameHits.length}`);
    for (const m of nameHits) {
        console.log(`  - ${m.name}`);
    }
    for (const m of nameHits) {
        const all = flatFields(m.klass);
        if (all.length === 0) continue;
        console.log(`\n  -- ${m.name} --`);
        for (const f of all.slice(0, 16)) console.log('    ' + fmtField(f));
    }

    // ─── 3. UnityEngine.Object / Component (cachedPtr / m_GameObject) ─
    const coreImg = Il2Cpp.image('UnityEngine.CoreModule');
    if (!coreImg) { console.log('\n[!] UnityEngine.CoreModule missing'); return; }

    function dumpFieldsWithFilter(klass, depthLimit, keyFn) {
        if (!klass) return;
        let cur = klass, d = 0;
        while (cur && d < depthLimit) {
            const cName = nameOf(cur);
            for (const f of safeFields(cur)) {
                try {
                    if (keyFn(f)) {
                        console.log(`  [${cName}] ${fmtField(f)}`);
                    }
                } catch (e) { /* skip broken field */ }
            }
            cur = cur.parent; d++;
        }
    }

    console.log('\n=== UnityEngine.Object (cached / m_/gameobject/name) ===');
    try {
        dumpFieldsWithFilter(coreImg ? coreImg.class('Object') : null, 10,
            f => {
                const n = (f?.name ?? '').toLowerCase();
                return n.includes('cached') || n.includes('gameobject') || (n === 'name');
            });
    } catch (e) {
        console.log('[!] Object dump failed:', e?.message ?? e);
    }

    console.log('\n=== UnityEngine.GameObject (m_Name) ===');
    try {
        dumpFieldsWithFilter(coreImg ? coreImg.class('GameObject') : null, 10,
            f => {
                const n = (f?.name ?? '').toLowerCase();
                return n.includes('name');
            });
    } catch (e) {
        console.log('[!] GameObject dump failed:', e?.message ?? e);
    }

    // ─── 4. Display name classes (where 'KpAcuBa' string actually lives) ─
    const TARGET_CLASSES = [
        'DisplayCharacterNameWorldObjectAnchoredGui',
        'LinkedCharacterNameLabel',
    ];
    console.log('\n=== Target name-binder classes (full layout) ===');
    for (const cn of TARGET_CLASSES) {
        try {
            let k = null;
            try { k = assembly.image.class(cn); } catch (e) { /* skip */ }
            if (!k && coreImg) { try { k = coreImg.class(cn); } catch (e) { /* skip */ } }
            if (!k) { console.log(`[!] ${cn} not found`); continue; }
            console.log(`\n--- ${nameOf(k)} (instanceSize=${k.instanceSize}) ---`);
            try {
                const all = flatFields(k);
                for (const f of all) console.log('  ' + fmtField(f));
            } catch (e) {
                console.log('  [!] flatFields failed:', e?.message ?? e);
            }
        } catch (e) {
            console.log(`[!] ${cn} access failed:`, e?.message ?? e);
        }
    }

    console.log('\n[*] === done ===');
});
