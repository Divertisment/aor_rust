'use strict';
/*
 * hook_map_render.js
 *
 * Цель: перехватить рендер карты коллизий в Albion Online через Texture2D.GetPixels32 / GetPixels.
 *
 * КАК ЭТО РАБОТАЕТ:
 *   1. Альбион рисует worldmap/minimap = Atlas коллизий, преобразованный в текстуру.
 *   2. На каждый кадр рендерера (или на клик зума) движок зовёт `GetPixels32(0)` /
 *      `GetPixels(0)` на большой Texture2D, чтобы пиксельнуть её в Canvas.
 *   3. Если width × height = 656100 (= 810×810), это наш atlas.
 *
 * ЮЗЕР-ФЛОУ:
 *   - Игра запущена, ты в любой зоне.
 *   - Запускаешь: echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *       -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *       -l /mnt/hgfs/D/AOR_core/Frida/hook_map_render.js
 *   - В игре: нажми M (открой карту), покрути scroll-zoom (in/out несколько раз).
 *   - На каждый zoom движок вызовет GetPixels32 → наш hook сработает → дамп в /tmp.
 *
 * ЧТО ВЫВЕДЕТ:
 *   При совпадении размера: "[★] DUMPED <bytes> -> /tmp/aor_map_Color32_<w>x<h>_<pixels>.bin"
 *   При ошибке: "[!] <msg>"
 *
 * Запуск:
 *   echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/hook_map_render.js
 */

const TARGET_AREAS = [656100, 10497600, 2624400, 1312200];  // 810×810 × {1,16,4,2} bytes/cell
const DUMP_DIR = '/tmp';
const MAX_DUMPS = 8;
const WATCHDOG_MS = 120 * 1000;  // FIX: было 180s — уменьшил по просьбе пользователя
const MAX_DUMP_BYTES = 16 * 1024 * 1024;  // atlas candidates are <= 12 MB

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before the bridge dispatches any native work). Without this,
//     the bottom-of-file setTimeout never fires when hooks or setInterval
//     callbacks hold the JS event loop. ────────────────────────────────────
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    console.log('[*] dumps: ' + dumpCount + '/' + MAX_DUMPS + '  hits: ' + hitCount);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

let dumpCount = 0;
let hitCount = 0;
let alertOnce = true;   // FIX: was ReferenceError на каждом GetPixels32 (раньше использовался без объявления)
const PER_HOOK_HITS = 16;

function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }
function sanitize(s){ try { return String(s).replace(/[^a-zA-Z0-9_]/g, '_'); } catch (e) { return 'X'; } }

function dumpIl2CppArray(handle, pixelCount, bytesPerPixel, label, w, h) {
    if (dumpCount >= MAX_DUMPS) { console.log('   [!] MAX_DUMPS reached, skip'); return; }
    if (!handle || handle.isNull()) return;
    var sizeInBytes = pixelCount * bytesPerPixel;
    if (sizeInBytes <= 0) return;
    try {
        var n = Math.min(sizeInBytes, MAX_DUMP_BYTES);
        var bytes = handle.add(0x20).readByteArray(n);
        if (!bytes) return;
        var truncated = n < sizeInBytes;
        var fname = DUMP_DIR + '/aor_map_' + sanitize(label) + '_' + w + 'x' + h + '_' + sizeInBytes + 'b.bin';
        var f = new File(fname, 'wb'); f.write(bytes); f.close();
        dumpCount++;
        console.log('   ★ DUMPED ' + n + ' B → ' + fname + (truncated ? '  [TRUNCATED from ' + sizeInBytes + ' B]' : ''));
    } catch (e) { console.log('   [!] dump failed: ' + (e.message || e)); }
}

Il2Cpp.perform(function () {
    console.log('[*] === HOOK_MAP_RENDER ===\n');

    var coreAsm = safe(function(){ return Il2Cpp.domain.assembly('UnityEngine.CoreModule'); }, null);
    if (!coreAsm) { console.log('[!] UnityEngine.CoreModule not found'); return; }

    var texClass = safe(function(){ return coreAsm.image.class('UnityEngine.Texture2D'); }, null);
    if (!texClass) { console.log('[!] UnityEngine.Texture2D class not found'); return; }

    console.log('[*] UnityEngine.Texture2D found. Hooking GetPixels32 + GetPixels...');

    // ─── Hook Texture2D.GetPixels32(int mipLevel) → Color32[] ───
    // FIX: enumerate ALL overloads of GetPixels32 (0-arg, 1-arg, Rect-arg, etc.) because
    // .method('GetPixels32', 1) may resolve to the wrong overload in some Unity builds,
    // leading to 0 hits. frida-il2cpp-bridge .methods(name) returns array of all overloads.
    var getPixels32Overloads = safe(function(){ return texClass.methods('GetPixels32'); }, []);
    console.log('[*] GetPixels32 overloads found: ' + getPixels32Overloads.length);
    // FIX: unified factory for both GetPixels32 + GetPixels hooks (was duplicated logic).
    function makePixelsHook(getPixels, bytesPerPixel, label) {
        return function (mipLevel) {
            var ret;
            try { ret = getPixels.invoke(this, mipLevel); } catch (e) {
                console.log('   [!] ' + label + ' invoke failed: ' + e.message);
                return undefined;
            }
            // skip non-mip0 (different LODs, sub-rects)
            if (mipLevel !== 0 && mipLevel !== undefined) return ret;
            // FIX: 'this.width' не работает в frida-il2cpp-bridge. Читаем через .property().get(this).
            var w = -1, h = -1;
            try {
                var wProp = safe(function(){ return texClass.property('width'); }, null);
                if (wProp) w = wProp.get(this);
            } catch (e) {}
            try {
                var hProp = safe(function(){ return texClass.property('height'); }, null);
                if (hProp) h = hProp.get(this);
            } catch (e) {}
            if (typeof w !== 'number' || typeof h !== 'number' || w < 0 || h < 0) {
                if (alertOnce) { console.log('   [!] ' + label + ' fired but could not read w/h — skipping dump'); alertOnce = false; }
                return ret;
            }
            var area = w * h;
            if (hitCount >= PER_HOOK_HITS) return ret; hitCount++;
            if (TARGET_AREAS.indexOf(area) >= 0) {
                console.log('\n[!] Texture2D.' + label + ' HIT: ' + w + 'x' + h + ' = ' + area + ' pixels, mip=' + mipLevel);
                if (ret && ret.handle) dumpIl2CppArray(ret.handle, area, bytesPerPixel, label, w, h);
            }
            return ret;
        };
    }
    for (var gpi = 0; gpi < getPixels32Overloads.length; gpi++) {
        var gp = getPixels32Overloads[gpi];
        try {
            gp.implementation = makePixelsHook(gp, 4, 'GetPixels32');
            console.log('[+] hooked GetPixels32 overload ' + gpi + ' (paramCount=' + gp.parameterTypes.length + ')');
        } catch (e) {
            console.log('[-] failed to hook GetPixels32 overload ' + gpi + ': ' + e.message);
        }
    }
    if (getPixels32Overloads.length === 0) {
        console.log('[-] UnityEngine.Texture2D.GetPixels32 NOT found (any overload)');
    }

    // ─── Hook Texture2D.GetPixels(int mipLevel) → Color[] ───
    // FIX: same overload enumeration as GetPixels32. Reuses unified makePixelsHook factory.
    var getPixelsOverloads = safe(function(){ return texClass.methods('GetPixels'); }, []);
    console.log('[*] GetPixels overloads found: ' + getPixelsOverloads.length);
    for (var gei = 0; gei < getPixelsOverloads.length; gei++) {
        var ge = getPixelsOverloads[gei];
        try {
            ge.implementation = makePixelsHook(ge, 16, 'GetPixels');
            console.log('[+] hooked GetPixels overload ' + gei + ' (paramCount=' + ge.parameterTypes.length + ')');
        } catch (e) {
            console.log('[-] failed to hook GetPixels overload ' + gei + ': ' + e.message);
        }
    }
    if (getPixelsOverloads.length === 0) {
        console.log('[-] UnityEngine.Texture2D.GetPixels NOT found (any overload)');
    }

    // ─── Hook Texture2D.EncodeToPNG() → byte[] (capture PNG-encoded atlas) ───
    var encodePng = safe(function(){ return texClass.method('EncodeToPNG'); }, null);
    if (encodePng) {
        console.log('[+] hooked UnityEngine.Texture2D.EncodeToPNG()');
        encodePng.implementation = function () {
            var ret;
            try { ret = encodePng.invoke(this); } catch (e) {
                console.log('   [!] EncodeToPNG invoke failed: ' + e.message);
                return undefined;
            }
            if (!ret || !ret.handle) return ret;
            var w = -1, h = -1;
            try { w = this.width; } catch (e) {}
            try { h = this.height; } catch (e) {}
            if (w > 0 && h > 0) {
                console.log('\n[!] Texture2D.EncodeToPNG called on ' + w + 'x' + h + ' texture, len=' + (ret.length||0));
            }
            // auto-dump any PNG byte[] > 100KB
            var len = safe(function(){ return ret.length; }, 0);
            if (len > 100*1024 && dumpCount < MAX_DUMPS) {
                var fname = DUMP_DIR + '/aor_map_EncodeToPNG_' + (w||'?') + 'x' + (h||'?') + '_' + len + 'b.bin';
                try {
                    var n = Math.min(len, MAX_DUMP_BYTES);
                    var bytes = ret.handle.add(0x20).readByteArray(n);
                    var f = new File(fname, 'wb'); f.write(bytes); f.close();
                    dumpCount++;
                    console.log('   ★ dumped PNG payload ' + n + ' B → ' + fname);
                } catch (e) { console.log('   [!] PNG dump failed: ' + e); }
            }
            return ret;
        };
    }

    console.log('\n[*] ALL HOOKS ARMED. Open map (M), scroll-zoom in/out, wait for [★] HIT lines.');
    console.log('[*] watchdog: ' + (WATCHDOG_MS/1000) + 's auto-detach.\n');
});

setTimeout(function () {
    console.log('\n[*] === watchdog detach ===');
    console.log('[*] dumps: ' + dumpCount + '/' + MAX_DUMPS + '  hits: ' + hitCount);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);
