'use strict';
/*
 * hook_camera_matrix.js
 *
 * Цель: каждые 0.2с дампить view-матрицу активной Unity Camera в файл
 *       /tmp/aor_camera_matrix.json — затем её можно использовать
 *       в radar_server (читать JSON, применять transform_point_3x4 на
 *       координаты entity из /tmp/aor_entities.json).
 *
 * Что выдаём:
 *   {
 *     "ts": 1234567890,
 *     "w2c": [m00, m10, m20, m01, m11, m21, m02, m12, m22, m03, m13, m23],
 *     "proj": [16 floats],
 *     "w": 1920, "h": 1080,
 *     "pos": [camera.x, camera.y, camera.z]
 *   }
 *
 * w2c: 12 floats — column-major хранилище 3x4 матрицы (rows 0,1,2 of
 *      worldToCameraMatrix). Именно это и нужно для функции:
 *         screen_x = x*m[0] + y*m[3] + z*m[6] + m[9]
 *         screen_y = x*m[1] + y*m[4] + z*m[7] + m[10]
 *         w       = x*m[2] + y*m[5] + z*m[8] + m[11]
 *
 * Запуск:
 *   echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
 *     -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
 *     -l /mnt/hgfs/D/AOR_core/Frida/hook_camera_matrix.js
 *
 * Остановить — Ctrl+C (или watchdog 180с).
 */

const POLL_MS = 200;        // 5 Hz
const OUT_FILE = '/tmp/aor_camera_matrix.json';
const WATCHDOG_MS = 120 * 1000;  // FIX: было 180s — уменьшил по просьбе пользователя
const MAX_BYTES = 2048;

// ─── EARLY WATCHDOG (registered BEFORE Il2Cpp.perform so V8 queues the
//     callback before the bridge dispatches any native work). Without this,
//     the bottom-of-file setTimeout never fires when setInterval callbacks
//     hold the JS event loop. ───────────────────────────────────────────
setTimeout(function () {
    console.log('\n[*] === early watchdog (' + (WATCHDOG_MS/1000) + 's) — exiting ===');
    console.log('[*] ticks: ' + pollTickNum + '  lastWriteOk: ' + lastWriteOk);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);

function safe(fn, dflt){ try { return fn(); } catch (e) { return dflt; } }
function hp(p){ try { return '0x' + p.toString(16); } catch (e) { return String(p); } }
function sanitize(s){ try { return String(s).replace(/[^a-zA-Z0-9_.-]/g, '_'); } catch (e) { return 'X'; } }

let pollTickNum = 0;
let lastWriteOk = true;

Il2Cpp.perform(function () {
    console.log('[*] === HOOK_CAMERA_MATRIX ===\n');
    var coreAsm = safe(function(){ return Il2Cpp.domain.assembly('UnityEngine.CoreModule'); }, null);
    if (!coreAsm) { console.log('[!] UnityEngine.CoreModule not loaded'); return; }
    var camClass = safe(function(){ return coreAsm.image.class('UnityEngine.Camera'); }, null);
    if (!camClass) { console.log('[!] UnityEngine.Camera class missing'); return; }
    console.log('[*] UnityEngine.Camera found. Polling Camera.main every ' + POLL_MS + 'ms');

    // Try to access these properties on Camera. We will use static getter "main"
    // then read its instance properties worldToCameraMatrix + projectionMatrix.
    var wtcmProp = safe(function(){ return camClass.property('worldToCameraMatrix'); }, null);
    var projProp = safe(function(){ return camClass.property('projectionMatrix'); }, null);
    // Camera.main getter: frida-il2cpp-bridge v0.13.1 иногда не экспортирует статические
    // Unity getters через .property(); пробуем сначала method('get_main') (.invoke(null)),
    // и только если его нет — fallback на .property('main').get(null).
    var getMain = safe(function(){ return camClass.method('get_main'); }, null);
    var mainProp = safe(function(){ return camClass.property('main'); }, null);
    // FIX: Camera.main может быть null если в сцене нет камеры с тегом 'MainCamera'
    // (Albion использует свой CameraManager без стандартного тега). Fallback: взять
    // любую активную камеру через статический геттер Camera.allCameras.
    var getAllCameras = safe(function(){ return camClass.method('get_allCameras'); }, null);
    var widthProp = safe(function(){ return camClass.property('pixelWidth'); }, null);
    var heightProp = safe(function(){ return camClass.property('pixelHeight'); }, null);
    var transformProp = safe(function(){ return camClass.property('transform'); }, null);

    var tickInterval = setInterval(function () {
        pollTickNum++;
        try {
            var cam = null;
            // Сначала method('get_main').invoke(null) — он точно работает для статиков
            if (getMain) {
                try { cam = getMain.invoke(null); } catch (e) {}
            }
            // Fallback: property('main').get(null) — если method-call не сработал
            if (!cam && mainProp) {
                try { cam = mainProp.get(null); } catch (e) {}
            }
            // FIX: fallback на Camera.allCameras[0] — выбирает первую валидную камеру в сцене.
            // Работает даже если MainCamera не тегирована. Возвращает Il2Cpp-объект или Il2CppArray.
            if (!cam && getAllCameras) {
                try {
                    var arr = getAllCameras.invoke(null);
                    if (arr && arr.length > 0) {
                        cam = safe(function(){ return arr.get(0); }, null);
                        if (pollTickNum === 1) console.log('[*] tick#1: using Camera.allCameras[0] fallback (no MainCamera tagged)');
                    }
                } catch (e) {}
            }
            // Guard: Unity 6 иногда возвращает cam-объект с Int64 handle == 0
            // (deferred-loaded backing pointer в s_Instance). Без этой проверки
            // matrix4x4ToFloats прочитает 16 нулей и запишет мусор в JSON
            // каждые 200мс в течение ~5с.
            if (!cam || !cam.handle || (cam.handle.isNull && cam.handle.isNull())) {
                if (pollTickNum === 1) console.log('[!] Camera.main handle is null — main-камера ещё не готова; продолжу опрашивать');
                if (pollTickNum % 25 === 0) console.log('[*] tick#' + pollTickNum + ' Camera.main still null');
                return;
            }
            if (!cam || !cam.handle || cam.handle.isNull()) {
                if (pollTickNum % 25 === 0) console.log('[*] tick#' + pollTickNum + ' Camera.main returned null (no main camera tagged?)');
                return;
            }

            // Read worldToCameraMatrix — try as bridge property (returns Matrix4x4)
            var w2c = null;
            if (wtcmProp) {
                try { w2c = wtcmProp.get(cam); } catch (e) {}
            }

            // Read projectionMatrix
            var proj = null;
            if (projProp) {
                try { proj = projProp.get(cam); } catch (e) {}
            }

            // Read camera position (Vector3)
            var pos = null;
            var transform = safe(function(){ return transformProp ? transformProp.get(cam) : null; }, null);
            if (transform) {
                var posProp = safe(function(){ return transform.class.property('position'); }, null);
                if (posProp) {
                    try {
                        var v = posProp.get(transform);
                        if (v && v.handle) {
                            pos = [v.handle.add(0).readFloat(), v.handle.add(4).readFloat(), v.handle.add(8).readFloat()];
                        }
                    } catch (e) {}
                }
            }

            // Read pixel dims
            var w = safe(function(){ return widthProp ? widthProp.get(cam) : 0; }, 0);
            var h = safe(function(){ return heightProp ? heightProp.get(cam) : 0; }, 0);

            // Convert Matrix4x4 (Il2Cpp struct holding 16 floats) to flat array
            function matrix4x4ToFloats(m) {
                if (!m) return null;
                if (m.handle) {
                    var out = [];
                    for (var i = 0; i < 16; i++) {
                        try { out.push(m.handle.add(i * 4).readFloat()); } catch (e) { out.push(0); }
                    }
                    return out;
                }
                if (Array.isArray(m)) return m.slice(0, 16);
                return null;
            }
            var w2cF = matrix4x4ToFloats(w2c);
            var projF = matrix4x4ToFloats(proj);

            if (!w2cF) {
                // FIX: более информативный лог на tick#1 — показываем, что именно не нашли,
                // чтобы пользователь видел причину и не думал, что скрипт висит.
                if (pollTickNum === 1) {
                    var why = 'unknown';
                    if (!cam || !cam.handle || (cam.handle.isNull && cam.handle.isNull())) why = 'Camera.main handle is null';
                    else if (!getMain && !mainProp) why = 'no get_main method AND no main property on Camera class';
                    else if (!wtcmProp) why = 'no worldToCameraMatrix property on Camera class';
                    else why = 'wtcmProp.get(cam) returned null/unreadable';
                    console.log('[*] tick#1: worldToCameraMatrix not readable — ' + why);
                }
                if (pollTickNum % 25 === 0) console.log('[*] tick#' + pollTickNum + ' w=' + w + ' h=' + h + ' (no matrix)');
                return;
            }

            // First 12 floats of column-major Matrix4x4 = 3x4 world->camera transform.
            // w2cF is the FULL 16-float column-major layout, so:
            //   col 0 (m[0..3]), col 1 (m[4..7]), col 2 (m[8..11]), col 3 (m[12..15])
            // For 3x4 matrix unrolled in user's M indexing:
            //   m[0]=col0[0]  m[3]=col1[0]  m[6]=col2[0]  m[9]=col3[0]
            //   m[1]=col0[1]  m[4]=col1[1]  m[7]=col2[1]  m[10]=col3[1]
            //   m[2]=col0[2]  m[5]=col1[2]  m[8]=col2[2]  m[11]=col3[2]
            // = [col0[0..2], col1[0..2], col2[0..2], col3[0..2]]
            // = [w2cF[0], w2cF[1], w2cF[2], w2cF[4], w2cF[5], w2cF[6], w2cF[8], w2cF[9], w2cF[10], w2cF[12], w2cF[13], w2cF[14]]
            var m12 = [w2cF[0], w2cF[1], w2cF[2],
                       w2cF[4], w2cF[5], w2cF[6],
                       w2cF[8], w2cF[9], w2cF[10],
                       w2cF[12], w2cF[13], w2cF[14]];

            var payload = {
                ts: Date.now(),
                tick: pollTickNum,
                cam_handle: hp(cam.handle),
                w: w, h: h,
                pos: pos,
                w2c: m12,                  // 12 floats — the matrix for transform_point_3x4
                proj_full: projF,         // full 4x4 projection matrix
                w2c_full: w2cF            // full 4x4 world-to-camera (for debug)
            };
            var json = JSON.stringify(payload);
            try {
                var f = new File(OUT_FILE, 'wb'); f.write(json); f.close();
                if (pollTickNum === 1 || pollTickNum % 25 === 0) {
                    console.log('[*] tick#' + pollTickNum + ' camera=' + hp(cam.handle) +
                        ' w=' + w + ' h=' + h + ' pos=' + JSON.stringify(pos) +
                        ' m[0..11]=' + m12.slice(0,6).map(function(x){return x.toFixed(3);}).join(',') + '...');
                }
                // FIX: первый успешный tick — громко объявляем, что скрипт реально работает
                // (раньше первый tick выводился только в логе, но без явного 'OK')
                if (pollTickNum === 1) {
                    console.log('[*] === FIRST VALID TICK — camera matrix is being dumped to ' + OUT_FILE + ' ===');
                }
                lastWriteOk = true;
            } catch (e) {
                if (lastWriteOk) console.log('[!] write failed (tick#' + pollTickNum + '): ' + e.message);
                lastWriteOk = false;
            }
        } catch (e) {
            if (pollTickNum === 1) console.log('[!] tick#1 error: ' + e.message);
        }
    }, POLL_MS);

    console.log('[*] matrix polling started (every ' + POLL_MS + 'ms)\n');
    console.log('[*] output: ' + OUT_FILE + ' (overwrite each tick)');
    console.log('[*] watchdog: ' + (WATCHDOG_MS/1000) + 's auto-detach\n');
});

setTimeout(function () {
    console.log('\n[*] === watchdog detach ===');
    console.log('[*] ticks: ' + pollTickNum + '  lastWriteOk: ' + lastWriteOk);
    /* (Process.exit removed: server-side watchdog in web_panel.py handles 180s kill) */
}, WATCHDOG_MS);
