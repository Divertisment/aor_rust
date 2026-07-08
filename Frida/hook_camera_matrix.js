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
    // FIX: Camera/Resources/Object/GameObject живут в разных модулях Unity 2021+
    // (Camera — CoreModule, Resources — ResourcesModule, GameObject — GameObjectModule).
    // Используем Il2Cpp.domain.class() — cross-assembly lookup, ищет во всех загруженных images.
    // Fallback chain: domain.class → coreAsm (для Camera который исторически в CoreModule).
    var camClass = safe(function(){ return Il2Cpp.domain.class('UnityEngine.Camera'); }, null)
                || safe(function(){ return coreAsm.image.class('UnityEngine.Camera'); }, null);
    if (!camClass) { console.log('[!] UnityEngine.Camera class missing'); return; }
    console.log('[*] UnityEngine.Camera found. Polling Camera.main every ' + POLL_MS + 'ms');

    // Try to access these properties on Camera. We will use static getter "main"
    // then read its instance properties worldToCameraMatrix + projectionMatrix.
    var wtcmProp = safe(function(){ return camClass.property('worldToCameraMatrix'); }, null);
    var projProp = safe(function(){ return camClass.property('projectionMatrix'); }, null);
    // FIX: pre-declare method handles for value-type struct getters too.
    // .property().get(cam) boxes Matrix4x4/ProjectionMatrix and reads a 16-byte
    // Il2CppObject header when we do m.handle.add(0).readFloat().
    // Using cam.method('get_xxx').invoke(cam) returns an unboxed wrapper.
    // FIX: bridge sometimes auto-strips `get_` prefix. Try with prefix first,
    // fall back to no-prefix before falling back to .property() (last resort).
    var getW2C   = safe(function(){ return camClass.method('get_worldToCameraMatrix'); }, null)
                || safe(function(){ return camClass.method('worldToCameraMatrix'); }, null);
    var getProj  = safe(function(){ return camClass.method('get_projectionMatrix'); }, null)
                || safe(function(){ return camClass.method('projectionMatrix'); }, null);
    // Camera.main getter: frida-il2cpp-bridge v0.13.1 иногда не экспортирует статические
    // Unity getters через .property(); пробуем сначала method('get_main') (.invoke(null)),
    // и только если его нет — fallback на .property('main').get(null).
    var getMain = safe(function(){ return camClass.method('get_main'); }, null);
    var mainProp = safe(function(){ return camClass.property('main'); }, null);
    // FIX: Camera.main может быть null если в сцене нет камеры с тегом 'MainCamera'
    // (Albion использует свой CameraManager без стандартного тега). Fallback: взять
    // любую активную камеру через статический геттер Camera.allCameras.
    var getAllCameras = safe(function(){ return camClass.method('get_allCameras'); }, null);
    // FIX: Camera.allCameras() возвращает только активные камеры текущей сцены — в
    // loading screen / до активации сцены она возвращает []. В loading screen у Albion
    // даже Camera.main может быть null. Resources.FindObjectsOfTypeAll(typeof(Camera))
    // возвращает ВСЕ камеры, включая inactive. Передаём camClass как System.Type аргумент.
    // FIX: Resources живёт в UnityEngine.ResourcesModule (отдельно от CoreModule в Unity 2021+).
    // Cross-assembly Il2Cpp.domain.class() ищет во всех loaded images; OR-fallback на coreAsm
    // для билдов, где Resources случайно остался в CoreModule.
    var resourcesClass = safe(function(){ return Il2Cpp.domain.class('UnityEngine.Resources'); }, null)
                      || safe(function(){ return coreAsm.image.class('UnityEngine.Resources'); }, null);
    var findAllOfType = safe(function(){ return resourcesClass ? resourcesClass.method('FindObjectsOfTypeAll', 1) : null; }, null);
    // FIX: 5й fallback — Object.FindObjectsOfType(GameObject) → GO.GetComponent(typeof(Camera)).
    // Включает ВСЕ GO в памяти, включая hide/dont-save. На цинемэшин-проектах захватывает
    // неактивный Brain + активную Cinemachine *VCamera через её Camera output.
    // FIX: Object и GameObject — cross-assembly lookup + OR-fallback на coreAsm.
    // В Unity 2021+ GameObject в отдельном UnityEngine.GameObjectModule, Object обычно
    // в CoreModule но может быть раскидан по нескольким сборкам. Il2Cpp.domain.class()
    // покрывает все варианты; coreAsm.image.class — исторический fallback для билдов
    // где нужные классы ещё в CoreModule.
    var objectClass = safe(function(){ return Il2Cpp.domain.class('UnityEngine.Object'); }, null)
                   || safe(function(){ return coreAsm.image.class('UnityEngine.Object'); }, null);
    var goClass     = safe(function(){ return Il2Cpp.domain.class('UnityEngine.GameObject'); }, null)
                   || safe(function(){ return coreAsm.image.class('UnityEngine.GameObject'); }, null);
    var findObjectsOfType = safe(function(){ return objectClass ? objectClass.method('FindObjectsOfType', 1) : null; }, null);
    var getComponentMethod = safe(function(){ return goClass ? goClass.method('GetComponent', 1) : null; }, null);
    var findGOWithTag = safe(function(){ return goClass ? goClass.method('FindGameObjectsWithTag', 1) : null; }, null);
    var latchedCam = null;
    var lastBindTick = 0;
    var lastBindPath = 'unset';
    var widthProp = safe(function(){ return camClass.property('pixelWidth'); }, null);
    var heightProp = safe(function(){ return camClass.property('pixelHeight'); }, null);
    var transformProp = safe(function(){ return camClass.property('transform'); }, null);

    // FIX: rotating cursor по массиву GOs — на каждом scan сдвигаем на MAX_GO_SCAN вперёд,
    // чтобы через ~125 секунд (5000 GOs / 200 per tick / 5s/tick) просканировать весь список.
    // Без этого 200-GO окно зацикливается на первых 200 элементах и камера живущая на индексе
    // 5000+ никогда не будет найдена.
    var lastGOcursor = 0;

    var tickInterval = setInterval(function () {
        pollTickNum++;
        try {
            var cam = null;
            if (latchedCam && latchedCam.handle && !(latchedCam.handle.isNull && latchedCam.handle.isNull())) {
                cam = latchedCam;
            }
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
                    } else if (pollTickNum === 1) {
                        console.log('[*] tick#1: Camera.allCameras() returned empty array (likely loading screen or zero cameras)');
                    }
                } catch (e) {}
            }
            if (!cam && findGOWithTag && getComponentMethod) {
                var tagStr = null;
                try { tagStr = new Il2Cpp.String('MainCamera'); }
                catch (e1) {
                    try { tagStr = Memory.allocUtf8String('MainCamera'); }
                    catch (e2) {}
                }
                if (tagStr) {
                    try {
                        var taggedArr = findGOWithTag.invoke(tagStr);
                        if (taggedArr && taggedArr.length > 0) {
                            var taggedGO = safe(function(){ return taggedArr.get(0); }, null);
                            if (taggedGO) {
                                var taggedComp = safe(function(){ return getComponentMethod.invoke(taggedGO, camClass); }, null);
                                if (taggedComp && taggedComp.handle && !(taggedComp.handle.isNull && taggedComp.handle.isNull())) {
                                    cam = taggedComp;
                                    if (pollTickNum === 1 || lastBindPath !== 'tag-MainCamera') {
                                        console.log('[*] tick#' + pollTickNum + ': using FindGameObjectsWithTag("MainCamera") fast-path (n=' + taggedArr.length + ')');
                                    }
                                }
                            }
                        } else if (pollTickNum === 1) {
                            console.log('[*] tick#1: FindGameObjectsWithTag("MainCamera") returned empty (no GO has that tag in this scene)');
                        }
                    } catch (e) {}
                }
            }
            // FIX: 4й fallback — Resources.FindObjectsOfTypeAll(typeof(Camera)). Возвращает
            // ВСЕ камеры, включая inactive / dont-save. Вызывается когда даже allCameras пуст.
            // Для STATIC метода bridge v0.13.1 требует invoke без leading null — иначе ошибка
            // "needs 1 parameter(s), not 2".
            if (!cam && findAllOfType) {
                try {
                    var arr2 = findAllOfType.invoke(camClass);
                    if (!arr2) {
                        if (pollTickNum % 25 === 1) console.log('[!] tick#' + pollTickNum + ': FindObjectsOfTypeAll returned null (method exists but invocation failed)');
                    } else if (arr2.length > 0) {
                        cam = safe(function(){ return arr2.get(0); }, null);
                        if (pollTickNum === 1) console.log('[*] tick#1: using Resources.FindObjectsOfTypeAll fallback (n=' + arr2.length + ')');
                    } else if (pollTickNum % 25 === 1) {
                        console.log('[*] tick#' + pollTickNum + ': Resources.FindObjectsOfTypeAll returned EMPTY (active+inactive+editor cameras all absent)');
                    }
                } catch (e) {
                    if (pollTickNum % 25 === 1) console.log('[!] tick#' + pollTickNum + ': FindObjectsOfTypeAll.invoke THREW: ' + e.message);
                }
            }
            // FIX: 5й fallback — Object.FindObjectsOfType(GameObject) → для каждого GO дёрнуть
            // GetComponent(typeof(Camera)). Запускаем редко (на tick%25==2) чтобы не зависнуть.
            // Это единственный способ поймать камеру прицепленную к донтсев-объекту в сцене
            // без активной main-камеры (например CinemachineVCamera с Camera output).
            if (!cam && findObjectsOfType && getComponentMethod && pollTickNum % 25 === 2) {
                try {
                    // FIX: Object.FindObjectsOfType это STATIC метод — bridge v0.13.1 требует
                    // invoke без leading null, иначе 'needs 1 parameter(s), not 2'.
                    var gos = findObjectsOfType.invoke(goClass);
                    if (gos && gos.length > 0) {
                        var checked = 0, found = 0;
                        // FIX: cap to avoid pause on busy scenes with thousands of GOs.
                        // + rotating cursor чтобы за несколько polls покрыть весь gos.length.
                        var MAX_GO_SCAN = 200;
                        var startIdx = lastGOcursor % gos.length;
                        var endIdx   = Math.min(gos.length, startIdx + MAX_GO_SCAN);
                        for (var gi = startIdx; gi < endIdx; gi++) {
                            var g = gos.get(gi);
                            if (!g || !g.handle) continue;
                            checked++;
                            try {
                                var comp = getComponentMethod.invoke(g, camClass);
                                if (comp && comp.handle && !comp.handle.isNull()) {
                                    cam = comp;
                                    found++;
                                    console.log('[*] tick#' + pollTickNum + ': Found Camera via GO[' + gi + '].GetComponent(typeof(Camera)) (cursor=' + startIdx + ', checked=' + checked + ')');
                                    break;
                                }
                            } catch (ee) {}
                        }
                        // advance cursor for next poll
                        lastGOcursor = endIdx % gos.length;
                        if (!cam) {
                            var rangeNote = '[' + startIdx + '..' + endIdx + ']';
                            var cappedNote = gos.length > MAX_GO_SCAN ? ' (rotating over ' + gos.length + ' total)' : '';
                            console.log('[*] tick#' + pollTickNum + ': scanned ' + rangeNote + ' (' + checked + ' valid), NONE had Camera component' + cappedNote);
                        }
                    } else {
                        console.log('[*] tick#' + pollTickNum + ': Object.FindObjectsOfType(GameObject) returned EMPTY');
                    }
                } catch (e) {
                    console.log('[!] tick#' + pollTickNum + ': FindObjectsOfType(GameObject) THREW: ' + e.message);
                }
            }
            // FIX: 6й ULTIMATE diagnostic на tick#100 — если ничего не нашли, узнаём механизм:
            // это Cinemachine проект или камеры реально нет в сцене.
            if (!cam && pollTickNum === 100) {
                console.log('[!] tick#100 ULTIMATE: 50 секунд без камеры. Диагностирую среду...');
                var allAsms = safe(function(){ return Il2Cpp.domain.assemblies; }, null) || [];
                var cmHits = [], klassesFound = [];
                for (var ai = 0; ai < allAsms.length; ai++) {
                    var an = safe(function(){ return allAsms[ai].name; }, '');
                    if (/cinemachine/i.test(an)) cmHits.push(an);
                    if (/^[a-z][0-9][a-z]$/i.test(an)) klassesFound.push(an);  // short obfuscated names
                }
                console.log('[!] Cinemachine assemblies: ' + (cmHits.join(', ') || '(none — Unity Camera expected)'));
                console.log('[!] Tick #100 done — продолжаю опрос, но это ненормально для 50s опроса');
            }
            // Guard: Unity 6 иногда возвращает cam-объект с Int64 handle == 0
            // (deferred-loaded backing pointer в s_Instance). Без этой проверки
            // matrix4x4ToFloats прочитает 16 нулей и запишет мусор в JSON
            // каждые 200мс в течение ~5с.
            // FIX: was followed by an IDENTICAL duplicate guard (lines ~114-117)
            // — unreachable dead code, deleted.
            if (!cam || !cam.handle || (cam.handle.isNull && cam.handle.isNull())) {
                if (latchedCam) {
                    console.log('[*] tick#' + pollTickNum + ': latchedCam handle became null (scene change/camera unload?) — clearing cache');
                    latchedCam = null;
                    lastBindPath = 'unset';
                }
                if (pollTickNum === 1) console.log('[!] Camera.main handle is null — main-камера ещё не готова; продолжу опрашивать');
                if (pollTickNum % 25 === 0) console.log('[*] tick#' + pollTickNum + ' Camera.main still null');
                return;
            }

            // FIX: Matrix4x4 is a 64-byte value-type struct — frida-il2cpp-bridge
            // .property().get() returns a BOXED wrapper with a 16-byte object header,
            // so m.handle.add(0).readFloat() reads header bytes (= zeros/garbage).
            // Solution: invoke the getter METHOD directly, which returns an unboxed
            // struct wrapper whose .handle points at the raw 64-byte block.
            // (getW2C / getProj pre-declared outside the setInterval to avoid
            // 5 Hz GC pressure from per-tick safe() closures.)
            var w2c = null;
            if (getW2C) {
                try { w2c = getW2C.invoke(cam); } catch (e) {}
            } else if (wtcmProp) {
                // FIX: explicit warning so user knows JSON may contain garbage.
                console.log('[!] cam.get_worldToCameraMatrix() missing — falling back to .property() (boxed-handle risk; m[0..11] may be zeros)');
                try { w2c = wtcmProp.get(cam); } catch (e) {}
            }

            var proj = null;
            if (getProj) {
                try { proj = getProj.invoke(cam); } catch (e) {}
            } else if (projProp) {
                console.log('[!] cam.get_projectionMatrix() missing — falling back to .property() (boxed-handle risk)');
                try { proj = projProp.get(cam); } catch (e) {}
            }

            // FIX: Vector3 is 12-byte value struct — same boxing problem.
            // Use get_position() method instead of property->get() to get unboxed.
            var pos = null;
            var transform = safe(function(){ return transformProp ? transformProp.get(cam) : null; }, null);
            if (transform) {
                var getPos = safe(function(){ return transform.method('get_position'); }, null);
                if (getPos) {
                    try {
                        var v = getPos.invoke(transform);
                        if (v) {
                            // FIX: Vector3 wrapper from bridge exposes .x/.y/.z
                            // instance properties that bypass the boxed-handle
                            // 16-byte header problem. Direct read of v.handle
                            // would give header bytes (zeros) instead of floats.
                            pos = [v.x, v.y, v.z];
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
