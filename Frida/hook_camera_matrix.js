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
    // FIX(R12): method discovery — bridge v0.13.1 may expose worldToCameraMatrix /
    // projectionMatrix under different IL2CPP method names. Iterate camClass.methods
    // at init to discover the actual names. Diagnostic dump helps user debug if
    // all strategies fail.
    var w2cMethodNames = [];
    var projMethodNames = [];
    try {
        console.log('[*] R12 DIAG: camClass.instanceSize=' + (camClass.instanceSize || '?') + ', ns=' + (camClass.namespace || '?'));
        var _methods = camClass.methods;
        for (var _mi = 0; _mi < _methods.length; _mi++) {
            var _m = _methods[_mi];
            if (_m && _m.name) {
                if (/worldToCameraMatrix|WorldToCameraMatrix/i.test(_m.name)) w2cMethodNames.push(_m.name);
                if (/projectionMatrix|ProjectionMatrix/i.test(_m.name)) projMethodNames.push(_m.name);
            }
        }
        console.log('[*] R12 DIAG: w2c candidates: ' + (w2cMethodNames.length ? w2cMethodNames.join(', ') : '(NONE)'));
        console.log('[*] R12 DIAG: proj candidates: ' + (projMethodNames.length ? projMethodNames.join(', ') : '(NONE)'));
    } catch (e) {
        console.log('[!] R12 DIAG: camClass.methods iteration failed: ' + e.message);
    }
    // Hard-coded fallback names if discovery yielded nothing.
    if (w2cMethodNames.length === 0) w2cMethodNames = ['get_worldToCameraMatrix', 'worldToCameraMatrix'];
    if (projMethodNames.length === 0) projMethodNames = ['get_projectionMatrix', 'projectionMatrix'];
    function _r12ResolveGetter(cls, candidates, kind) {
        for (var i = 0; i < candidates.length; i++) {
            try {
                var m = cls.method(candidates[i]);
                if (m) { console.log('[*] R12: ' + kind + ' resolved via class.method("' + candidates[i] + '")'); return m; }
            } catch (e) {}
        }
        return null;
    }
    var getW2C  = _r12ResolveGetter(camClass, w2cMethodNames, 'w2c');
    var getProj = _r12ResolveGetter(camClass, projMethodNames, 'proj');
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
    // FIX(R16): use method('get_transform').invoke(cam) instead of property('transform').get(cam).
    // frida-il2cpp-bridge v0.13.1's .property() returns NULL for inherited Component properties
    // like 'transform' (which is declared on Component, not Camera). The .method() API works
    // for the C# property getter. Live R15 test confirmed: transformProp=null → R15's
    // `if (!transformProp) return null;` returned silently, no diagnostic.
    // FIX(R17): live R16 test showed bridge throws `cannot invoke non-static method get_transform
    // as it must be invoked through a Il2Cpp.Object, not a Il2Cpp.Class` when calling
    // `camClass.method('get_transform').invoke(cam)`. The bridge's invocation check rejects
    // the class-based method handle. Workaround: get the method from the INSTANCE
    // (`cam.method('get_transform')`) per-call (instance method lookup has a different
    // invocation path). Cache the handle per fresh cam to avoid 5Hz lookups.
    var getTransform = null;  // R17: don't pre-resolve; resolve per-call from cam instance
    // FIX(R14): pre-resolve Transform class for pointer-chase verification. The class
    // object has a `.handle` field pointing at the Il2CppClass* struct (NOT an instance).
    // We compare the class pointer of candidate Transform instances against this to confirm
    // the chase landed on a real Transform (vs random heap).
    var transformClass = safe(function(){ return Il2Cpp.domain.class('UnityEngine.Transform'); }, null);

    // FIX: rotating cursor по массиву GOs — на каждом scan сдвигаем на MAX_GO_SCAN вперёд,
    // чтобы через ~125 секунд (5000 GOs / 200 per tick / 5s/tick) просканировать весь список.
    // Без этого 200-GO окно зацикливается на первых 200 элементах и камера живущая на индексе
    // 5000+ никогда не будет найдена.
    var lastGOcursor = 0;

    // FIX(R10): typed-arg helper — bridge v0.13.1 native static methods с typeof(Type)
    // ожидают System.Type managed OBJECT, не Il2CppClass struct pointer. Passing
    // Il2CppClass wrapper dereferences wrong → access violation @ 0x132 (see log).
    // .type.object → .typeObject fallback chain. Если оба null — caller disable.
    function __typedArg(cls) {
        var t = safe(function(){ return cls && cls.type && cls.type.object; }, null);
        return t || safe(function(){ return cls && cls.typeObject; }, null);
    }
    // FIX(R10): once-only-disable flags. После первого THREW на findAllOfType /
    // findObjectsOfType — methods permanently unsed (AV-петля каждые 25 тиков).
    var findAllOfTypeBroken = false;
    var findObjectsOfTypeBroken = false;
    var __findAllOfTypeWarned = false;
    var __findObjectsOfTypeWarned = false;
    // FIX(R11+): getComponentMethod тоже принимает typeof(Type) arg — Site 2 (5th
    // fallback inner loop) silent per-iteration не имеет outer throttle; нужен
    // once-only disable flag для diagnostic visibility.
    var getComponentMethodBroken = false;
    var __getComponentMethodWarned = false;

    // FIX(R13): 4x4 matrix inverse for column-major 16-float array.
    // Unity Camera.worldToCameraMatrix = transform.worldToLocalMatrix = inverse(transform.localToWorldMatrix).
    // Unity Camera C# class does NOT store worldToCameraMatrix as a field; it's computed on the fly.
    // But Transform.m_LocalToWorld (Matrix4x4, 64 bytes column-major) IS stored as a field at
    // Transform instance +0x10. We read it raw, invert in pure JS, get our worldToCameraMatrix.
    // Algorithm: cofactor expansion / adjugate (MESA GLU mtxinv, public domain).
    function _matrixInverse4x4(m) {
        // m is column-major: m[c*4 + r] = element at row r, col c
        function a(r, c) { return m[c * 4 + r]; }
        var inv = new Array(16);
        inv[0]  =  a(1,1)*a(2,2)*a(3,3) + a(1,3)*a(2,1)*a(3,2) + a(1,2)*a(2,3)*a(3,1)
                 - a(1,1)*a(2,3)*a(3,2) - a(1,2)*a(2,1)*a(3,3) - a(1,3)*a(2,2)*a(3,1);
        inv[4]  =  a(0,1)*a(2,3)*a(3,2) + a(0,2)*a(2,1)*a(3,3) + a(0,3)*a(2,2)*a(3,1)
                 - a(0,1)*a(2,2)*a(3,3) - a(0,2)*a(2,3)*a(3,1) - a(0,3)*a(2,1)*a(3,2);
        inv[8]  =  a(0,1)*a(1,2)*a(3,3) + a(0,3)*a(1,1)*a(3,2) + a(0,2)*a(1,3)*a(3,1)
                 - a(0,1)*a(1,3)*a(3,2) - a(0,3)*a(1,2)*a(3,1) - a(0,2)*a(1,1)*a(3,3);
        inv[12] =  a(0,1)*a(1,3)*a(2,2) + a(0,2)*a(1,1)*a(2,3) + a(0,3)*a(1,2)*a(2,1)
                 - a(0,1)*a(1,2)*a(2,3) - a(0,3)*a(1,1)*a(2,2) - a(0,2)*a(1,3)*a(2,1);
        inv[1]  =  a(1,0)*a(2,3)*a(3,2) + a(1,2)*a(2,0)*a(3,3) + a(1,3)*a(2,2)*a(3,0)
                 - a(1,0)*a(2,2)*a(3,3) - a(1,3)*a(2,0)*a(3,2) - a(1,2)*a(2,3)*a(3,0);
        inv[5]  =  a(0,0)*a(2,2)*a(3,3) + a(0,3)*a(2,0)*a(3,2) + a(0,2)*a(2,3)*a(3,0)
                 - a(0,0)*a(2,3)*a(3,2) - a(0,2)*a(2,0)*a(3,3) - a(0,3)*a(2,2)*a(3,0);
        inv[9]  =  a(0,0)*a(1,3)*a(3,2) + a(0,2)*a(1,0)*a(3,3) + a(0,3)*a(1,2)*a(3,0)
                 - a(0,0)*a(1,2)*a(3,3) - a(0,3)*a(1,0)*a(3,2) - a(0,2)*a(1,3)*a(3,0);
        inv[13] =  a(0,0)*a(1,2)*a(2,3) + a(0,3)*a(1,0)*a(2,2) + a(0,2)*a(1,3)*a(2,0)
                 - a(0,0)*a(1,3)*a(2,2) - a(0,2)*a(1,0)*a(2,3) - a(0,3)*a(1,2)*a(2,0);
        inv[2]  =  a(1,0)*a(2,1)*a(3,3) + a(1,3)*a(2,0)*a(3,1) + a(1,1)*a(2,3)*a(3,0)
                 - a(1,0)*a(2,3)*a(3,1) - a(1,1)*a(2,0)*a(3,3) - a(1,3)*a(2,1)*a(3,0);
        inv[6]  =  a(0,0)*a(2,3)*a(3,1) + a(0,1)*a(2,0)*a(3,3) + a(0,3)*a(2,1)*a(3,0)
                 - a(0,0)*a(2,1)*a(3,3) - a(0,3)*a(2,0)*a(3,1) - a(0,1)*a(2,3)*a(3,0);
        inv[10] =  a(0,0)*a(1,1)*a(3,3) + a(0,3)*a(1,0)*a(3,1) + a(0,1)*a(1,3)*a(3,0)
                 - a(0,0)*a(1,3)*a(3,1) - a(0,1)*a(1,0)*a(3,3) - a(0,3)*a(1,1)*a(3,0);
        inv[14] =  a(0,0)*a(1,3)*a(2,1) + a(0,1)*a(1,0)*a(2,3) + a(0,3)*a(1,1)*a(2,0)
                 - a(0,0)*a(1,1)*a(2,3) - a(0,3)*a(1,0)*a(2,1) - a(0,1)*a(1,3)*a(2,0);
        inv[3]  =  a(1,1)*a(2,0)*a(3,2) + a(1,2)*a(2,1)*a(3,0) + a(1,0)*a(2,2)*a(3,1)
                 - a(1,0)*a(2,1)*a(3,2) - a(1,1)*a(2,2)*a(3,0) - a(1,2)*a(2,0)*a(3,1);
        inv[7]  =  a(0,0)*a(2,1)*a(3,2) + a(0,2)*a(2,0)*a(3,1) + a(0,1)*a(2,2)*a(3,0)
                 - a(0,0)*a(2,2)*a(3,1) - a(0,1)*a(2,0)*a(3,2) - a(0,2)*a(2,1)*a(3,0);
        inv[11] =  a(0,0)*a(1,2)*a(3,1) + a(0,1)*a(1,0)*a(3,2) + a(0,2)*a(1,1)*a(3,0)
                 - a(0,0)*a(1,1)*a(3,2) - a(0,2)*a(1,0)*a(3,1) - a(0,1)*a(1,2)*a(3,0);
        inv[15] =  a(0,0)*a(1,1)*a(2,2) + a(0,1)*a(1,2)*a(2,0) + a(0,2)*a(1,0)*a(2,1)
                 - a(0,0)*a(1,2)*a(2,1) - a(0,1)*a(1,0)*a(2,2) - a(0,2)*a(1,1)*a(2,0);
        // Determinant (cofactor expansion along row 0). |det| < 1e-8 → singular.
        var det = a(0,0)*inv[0] + a(0,1)*inv[4] + a(0,2)*inv[8] + a(0,3)*inv[12];
        if (Math.abs(det) < 1e-8) return null;
        var invDet = 1.0 / det;
        for (var i = 0; i < 16; i++) inv[i] *= invDet;
        return inv;
    }

    // FIX(R15): Try Strategy 5 — call transform.get_worldToLocalMatrix() via bridge.
    // This is the CLEANEST path: Unity 2021+ computes w2c on the fly, the C# method
    // returns it as a Matrix4x4 value-type. The bridge wraps the returned struct with
    // named float fields (m00, m01, ..., m33) — same pattern as Vector3's .x/.y/.z.
    // We read 16 named fields in column-major order, return as a 16-float array.
    // matrix4x4ToFloats has an Array.isArray branch that handles this directly.
    // R14's pointer-chase is kept as Strategy 5b fallback (also broken in this Unity
    // build — m_Transform is at an offset we didn't try).
    function tryReadW2CFromTransformMethod(cam) {
        try {
            // R17: get the method from the INSTANCE, not the class. bridge v0.13.1's
            // `camClass.method('get_transform').invoke(cam)` throws (class-vs-object check).
            // `cam.method('get_transform')` resolves the instance-level method which has
            // a different invocation path. Fallback chain: instance method → instance
            // property → class method on Component.
            var getTransformInst = null;
            try { getTransformInst = cam.method('get_transform'); } catch (eMC) {
                if (pollTickNum === 1) console.log('[*] R17: cam.method("get_transform") THREW: ' + eMC.message);
            }
            if (!getTransformInst) {
                // Fallback A: try instance-level property access (FIX R19: .get() no args)
                try {
                    var transformPropInst = cam.property('transform');
                    if (transformPropInst) {
                        var t = transformPropInst.get();
                        if (t) { getTransformInst = { _transform: t }; }
                    }
                } catch (ePA) {}
            }
            if (!getTransformInst) {
                if (pollTickNum === 1) console.log('[*] R19: no working get_transform accessor on cam instance');
                return null;
            }
            var transform = null;
            if (getTransformInst._transform) {
                transform = getTransformInst._transform;  // property fallback
            } else {
                // FIX(R18): bridge v0.13.1's `cam.method('get_transform')` returns a method
                // handle that needs 0 explicit args — the receiver (cam) is implicit. Calling
                // `.invoke(cam)` threw 'needs 0 parameter(s), not 1'. Use `.invoke()` (no args).
                try { transform = getTransformInst.invoke(); } catch (eGT) {
                    if (pollTickNum === 1) console.log('[!] R18: get_transform.invoke() THREW: ' + eGT.message);
                    return null;
                }
            }
            if (!transform) {
                if (pollTickNum === 1) console.log('[*] R18: get_transform returned null/undefined');
                return null;
            }
            var getW2LM = safe(function(){ return transform.method('get_worldToLocalMatrix'); }, null);
            if (!getW2LM) {
                if (pollTickNum === 1) console.log('[*] R19: no get_worldToLocalMatrix method on Transform class');
                return null;
            }
            // FIX(R19): bridge v0.13.1 treats 0-arg property-getter methods as 0-arg functions
            // with implicit receiver. Same fix as R18 for get_transform.
            var w2lm = null;
            try { w2lm = getW2LM.invoke(); } catch (eI) {
                if (pollTickNum === 1) console.log('[!] R19: get_worldToLocalMatrix.invoke() THREW: ' + eI.message);
                return null;
            }
            if (!w2lm) {
                if (pollTickNum === 1) console.log('[*] R15: get_worldToLocalMatrix returned null');
                return null;
            }
            // Primary: named field access. C# Matrix4x4 has fields m00..m33. Bridge v0.13.1
            // exposes these as JS properties on the value-type wrapper.
            if (typeof w2lm.m00 === 'number' && typeof w2lm.m33 === 'number') {
                // m_rc = M[r][c] in C# field naming. Column-major memory layout: M[r][c] is at
                // byte offset (c*4 + r)*4. So column-major flat array is:
                //   m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33
                var floats = [
                    w2lm.m00, w2lm.m10, w2lm.m20, w2lm.m30,
                    w2lm.m01, w2lm.m11, w2lm.m21, w2lm.m31,
                    w2lm.m02, w2lm.m12, w2lm.m22, w2lm.m32,
                    w2lm.m03, w2lm.m13, w2lm.m23, w2lm.m33
                ];
                if (pollTickNum === 1) console.log('[*] R15: w2c from transform.get_worldToLocalMatrix() named fields (m00..m33) — 16 floats');
                return floats;  // matrix4x4ToFloats: Array.isArray branch returns slice(0, 16)
            }
            // Fallback: .handle. If bridge gave us a wrapper with a raw .handle, let
            // matrix4x4ToFloats try the standard read pattern.
            if (w2lm.handle) {
                if (pollTickNum === 1) console.log('[*] R15: w2c from transform.get_worldToLocalMatrix() .handle (no named fields)');
                return w2lm;
            }
            if (pollTickNum === 1) console.log('[*] R15: get_worldToLocalMatrix wrapper has no m00/m33 AND no .handle — keys: ' + Object.keys(w2lm).join(','));
        } catch (e) {
            if (pollTickNum === 1) console.log('[!] R15: tryReadW2CFromTransformMethod THREW: ' + e.message);
        }
        return null;
    }

    // FIX(R14): Try Strategy 5b — chase m_Transform pointer from cam instance manually.
    // R15 (Strategy 5, method-call) is preferred; this is a raw-memory fallback.
    // Camera inherits from Behaviour → Component → Object. m_Transform offset varies by
    // Unity version. R14 live test: all candidate offsets failed (0x10 hit monitor block
    // with all-zero +0x10, others were null pointers). Strategy 5b may be DEAD for this
    // build, but kept for completeness in case future Unity versions shift offsets.
    function tryReadW2CFromTransform(cam) {
        try {
            if (!cam || !cam.handle) return null;
            // Candidate offsets for Camera.m_Transform (Component.m_Transform field). Different
            // Unity IL2CPP versions place this at different offsets. R13 Strategy 5b found
            // m_ProjectionMatrix at cam+0x20 — so m_Transform is likely BEFORE +0x20 (probably
            // +0x18). Try multiple offsets, earliest valid pointer wins.
            var offsets = [0x18, 0x20, 0x28, 0x10, 0x30];
            var heapMin = 0x700000000000, heapMax = 0x800000000000;
            var tClassPtr = null;
            try { tClassPtr = (transformClass && transformClass.handle) ? transformClass.handle : null; } catch (eT) {}
            for (var oi = 0; oi < offsets.length; oi++) {
                var off = offsets[oi];
                var transPtr = null;
                try { transPtr = cam.handle.add(off).readPointer(); } catch (eR) { continue; }
                if (!transPtr || transPtr.isNull()) continue;
                if (transPtr.compare(heapMin) < 0 || transPtr.compare(heapMax) > 0) continue;
                // Verify class pointer of candidate Transform instance matches Transform class.
                // Instance +0x00 is its Il2CppClass*; class.handle is the same pointer.
                var classOk = false;
                if (tClassPtr) {
                    try {
                        var instClassPtr = transPtr.readPointer();
                        classOk = instClassPtr.equals(tClassPtr);
                    } catch (eC) { classOk = false; }
                }
                // Read m_LocalToWorld at transPtr+0x10
                var l2w = null;
                try {
                    var buf = transPtr.add(0x10).readByteArray(64);
                    var dv = new DataView(new Uint8Array(buf).buffer);
                    l2w = [];
                    for (var i = 0; i < 16; i++) l2w.push(dv.getFloat32(i * 4, true));
                } catch (eL) { continue; }
                // Sanity: row 3 of column-major Matrix4x4 = [0, 0, 0, 1]
                var sane = Math.abs(l2w[3]) < 1e-2 && Math.abs(l2w[7]) < 1e-2
                        && Math.abs(l2w[11]) < 1e-2 && Math.abs(l2w[15] - 1.0) < 1e-2;
                if (!sane) {
                    if (pollTickNum === 1) console.log('[*] R14: cam+0x' + off.toString(16) +
                        ' → trans+0x10 sanity FAILED (m[3,7,11,15]=' +
                        l2w[3].toFixed(2) + ',' + l2w[7].toFixed(2) + ',' + l2w[11].toFixed(2) + ',' + l2w[15].toFixed(2) +
                        ') classOk=' + classOk);
                    continue;
                }
                // Passed all gates — invert the matrix
                var inv = _matrixInverse4x4(l2w);
                if (!inv) {
                    if (pollTickNum === 1) console.log('[*] R14: cam+0x' + off.toString(16) +
                        ' m_LocalToWorld singular (det≈0)');
                    continue;
                }
                if (pollTickNum === 1) console.log('[*] R14: w2c computed from cam+0x' + off.toString(16) +
                    ' → trans+0x10 (m_LocalToWorld) inverse — classOk=' + classOk +
                    ' l2w[0,5,10,15]=' + l2w[0].toFixed(3) + ',' + l2w[5].toFixed(3) + ',' + l2w[10].toFixed(3) + ',' + l2w[15].toFixed(3));
                // Fake struct wrapper compatible with matrix4x4ToFloats (m.handle.add(i*4).readFloat())
                return { handle: { add: function(byteOff) { return { readFloat: function() { return inv[byteOff / 4]; } }; } } };
            }
            if (pollTickNum === 1) console.log('[*] R14: no valid m_LocalToWorld found at any of ' + offsets.map(function(o){return '0x'+o.toString(16);}).join(','));
        } catch (e) {
            if (pollTickNum === 1) console.log('[!] R14: tryReadW2CFromTransform THREW: ' + e.message);
        }
        return null;
    }

    // FIX(R13): Try Strategy 5b for projectionMatrix — scan cam+0..0x200 for plausible
    // perspective pattern. Unity perspective: row 3 = [0, 0, -1, 0] (DX/GL) or
    // [0, 0, near/(near-far), 2*near*far/(near-far)] (raw). Scan for row 3 where
    // m[3]≈0, m[7]≈0, m[15]≈0, and rotation 3x3 cells bounded.
    function tryReadProjFromCamMemory(cam) {
        try {
            var buf = cam.handle.readByteArray(512);
            var ba = new Uint8Array(buf);
            var dv = new DataView(ba.buffer, ba.byteOffset, ba.byteLength);
            var bestScore = -1, bestOff = -1;
            for (var off = 0; off <= 448; off += 16) {
                var m03 = dv.getFloat32(off + 12, true);
                var m13 = dv.getFloat32(off + 28, true);
                var m23 = dv.getFloat32(off + 44, true);
                var m33 = dv.getFloat32(off + 60, true);
                var s = 0;
                // Unity perspective row 3: [0, 0, ±something, 0] — m[3] and m[7] should be ~0
                if (Math.abs(m03) < 1e-2 && Math.abs(m13) < 1e-2 && Math.abs(m33) < 1e-2) s += 5;
                // m[15] is -1 or +1 (perspective marker) — or near it
                if (Math.abs(Math.abs(m23) - 1.0) < 0.5) s += 2;
                if (s > 0) {
                    // 9 rotation cells should be bounded (not huge values)
                    for (var r = 0; r < 9; r++) {
                        var v = dv.getFloat32(off + r * 4, true);
                        if (v >= -10.0 && v <= 10.0) s++;
                    }
                    if (s > bestScore) { bestScore = s; bestOff = off; }
                }
            }
            if (bestScore >= 10) {
                var floats = [];
                for (var i = 0; i < 16; i++) floats.push(dv.getFloat32(bestOff + i * 4, true));
                if (pollTickNum === 1) console.log('[*] R13: proj found at cam+0x' + bestOff.toString(16) + ' score=' + bestScore);
                var _arr = floats;
                return { handle: { add: function(byteOff) { return { readFloat: function() { return _arr[byteOff / 4]; } }; } } };
            } else if (pollTickNum === 1) {
                console.log('[*] R13: no plausible projectionMatrix in cam+0..0x200 (bestScore=' + bestScore + ')');
            }
        } catch (e) {
            if (pollTickNum === 1) console.log('[!] R13: tryReadProjFromCamMemory THREW: ' + e.message);
        }
        return null;
    }

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
                                var taggedComp = safe(function(){ return getComponentMethod.invoke(taggedGO, __typedArg(camClass)); }, null);
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
            if (!cam && findAllOfType && !findAllOfTypeBroken) {
                try {
                    // FIX(R10-B6): if __typedArg() returned null, bridge would throw
                    // a confusing 'access violation @ 0x132'. Pre-empt it so catch
                    // logs a clean 'no .type.object/.typeObject' diagnostic instead.
                    var _typedCam = __typedArg(camClass);
                    if (!_typedCam) throw new Error('bridge has no .type.object/.typeObject');
                    var arr2 = findAllOfType.invoke(_typedCam);
                    if (!arr2) {
                        if (pollTickNum % 25 === 1) console.log('[!] tick#' + pollTickNum + ': FindObjectsOfTypeAll returned null (method exists but invocation failed)');
                    } else if (arr2.length > 0) {
                        cam = safe(function(){ return arr2.get(0); }, null);
                        if (pollTickNum === 1) console.log('[*] tick#1: using Resources.FindObjectsOfTypeAll fallback (n=' + arr2.length + ')');
                    } else if (pollTickNum % 25 === 1) {
                        console.log('[*] tick#' + pollTickNum + ': Resources.FindObjectsOfTypeAll returned EMPTY (active+inactive+editor cameras all absent)');
                    }
                } catch (e) {
                    // FIX(R10): once-only disable — не повторять AV-попытку
                    findAllOfTypeBroken = true;
                    if (__findAllOfTypeWarned) {/* stay silent */} else {
                        __findAllOfTypeWarned = true;
                        console.log('[!] tick#' + pollTickNum + ': FindObjectsOfTypeAll.invoke THREW (' + e.message + ') — permanently disabled to halt AV-loop');
                    }
                }
            }
            // FIX: 5й fallback — Object.FindObjectsOfType(GameObject) → для каждого GO дёрнуть
            // GetComponent(typeof(Camera)). Запускаем редко (на tick%25==2) чтобы не зависнуть.
            // Это единственный способ поймать камеру прицепленную к донтсев-объекту в сцене
            // без активной main-камеры (например CinemachineVCamera с Camera output).
            if (!cam && findObjectsOfType && getComponentMethod && !findObjectsOfTypeBroken && pollTickNum % 25 === 2) {
                try {
                    // FIX(R10-B6+B5): typedArg helper for typeof(Type). Old `goClass`
                    // direct-call caused AV @ 0x132 spam; behind the scenes bridge
                    // needed a managed System.Type object, not Il2CppClass struct.
                    var _typedGo = __typedArg(goClass);
                    if (!_typedGo) throw new Error('bridge has no .type.object/.typeObject');
                    var gos = findObjectsOfType.invoke(_typedGo);
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
                                if (getComponentMethodBroken) break;
                                // FIX(R11): wrap with __typedArg — same AV @ 0x132 root cause if camClass as bare ptr
                                var comp = getComponentMethod.invoke(g, __typedArg(camClass));
                                if (comp && comp.handle && !comp.handle.isNull()) {
                                    cam = comp;
                                    found++;
                                    console.log('[*] tick#' + pollTickNum + ': Found Camera via GO[' + gi + '].GetComponent(typeof(Camera)) (cursor=' + startIdx + ', checked=' + checked + ')');
                                    break;
                                }
                            } catch (ee) {
                                // FIX(R11+): once-only disable for getComponentMethod — silent per-iteration
                                // catches masked AV @ 0x132 spam without diagnostic visibility.
                                getComponentMethodBroken = true;
                                if (!__getComponentMethodWarned) {
                                    __getComponentMethodWarned = true;
                                    console.log('[!] tick#' + pollTickNum + ': getComponentMethod disabled (likely same bridge .type.object/.typeObject hole as R10)');
                                }
                                break;
                            }
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
                    // FIX(R10): once-only disable
                    findObjectsOfTypeBroken = true;
                    if (__findObjectsOfTypeWarned) {/* stay silent */} else {
                        __findObjectsOfTypeWarned = true;
                        console.log('[!] tick#' + pollTickNum + ': FindObjectsOfType(GameObject) THREW (' + e.message + ') — permanently disabled to halt AV-loop');
                    }
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
                    lastBindTick = 0;
                }
                if (pollTickNum === 1) console.log('[!] Camera.main handle is null — main-камера ещё не готова; продолжу опрашивать');
                if (pollTickNum % 25 === 0) console.log('[*] tick#' + pollTickNum + ' Camera.main still null');
                return;
            }

            // FIX: bindPath detection (single-shot per fresh bind) — определяет какой
            // fallback реально выдал текущую камеру. Cascade ORDER важен: rerun каждый
            // доступный провайдер и сравнить === cam. Если cam === latchedCam — пропускаем
            // (повторный тик, кэш уже valid) — экономим 0-5 bridge-call per tick.
            if (cam !== latchedCam) {
                latchedCam = cam;
                lastBindTick = pollTickNum;
                var bindPath = 'unknown';
                if (cam && getMain) { try { if (getMain.invoke(null) === cam) bindPath = 'Camera.main (get_main)'; } catch(e){} }
                if (bindPath === 'unknown' && mainProp) { try { if (mainProp.get(null) === cam) bindPath = 'Camera.main (.property)'; } catch(e){} }
                if (bindPath === 'unknown' && findGOWithTag && getComponentMethod) {
                    try {
                        var taggedArrChk = findGOWithTag.invoke(new Il2Cpp.String('MainCamera'));
                        if (taggedArrChk && taggedArrChk.length > 0) {
                            var taggedGOChk = safe(function(){ return taggedArrChk.get(0); }, null);
                            if (taggedGOChk) {
                                var taggedCompChk = safe(function(){ return getComponentMethod.invoke(taggedGOChk, __typedArg(camClass)); }, null);
                                if (taggedCompChk && taggedCompChk.handle && taggedCompChk === cam) bindPath = 'tagged/findGOWithTag → GetComponent';
                            }
                        }
                    } catch(e){}
                }
                if (bindPath === 'unknown' && getAllCameras) {
                    try {
                        var arrChk = getAllCameras.invoke(null);
                        if (arrChk && arrChk.length > 0 && arrChk.get(0) === cam) bindPath = 'Camera.allCameras[0]';
                    } catch(e){}
                }
                if (bindPath === 'unknown' && findAllOfType && !findAllOfTypeBroken) {
                    try {
                        var fArrChk = findAllOfType.invoke(__typedArg(camClass));
                        if (fArrChk && fArrChk.length > 0 && fArrChk.get(0) === cam) bindPath = 'Resources.FindObjectsOfTypeAll';
                    } catch(e){}
                }
                if (bindPath === 'unknown' && findObjectsOfType && getComponentMethod && !findObjectsOfTypeBroken) bindPath = 'Object.FindObjectsOfType(GameObject)→GetComponent';
                lastBindPath = bindPath;
                console.log('[*] tick#' + pollTickNum + ': CAMERA BOUND via "' + bindPath + '" — latched for subsequent ticks (was ' + (pollTickNum - 1) + ' ticks to find)');
            }

            // FIX: Matrix4x4 is a 64-byte value-type struct — frida-il2cpp-bridge
            // .property().get() returns a BOXED wrapper with a 16-byte object header,
            // so m.handle.add(0).readFloat() reads header bytes (= zeros/garbage).
            // Solution: invoke the getter METHOD directly, which returns an unboxed
            // struct wrapper whose .handle points at the raw 64-byte block.
            // (getW2C / getProj pre-declared outside the setInterval to avoid
            // 5 Hz GC pressure from per-tick safe() closures.)
            // FIX(R12): matrix read — 4-strategy fallback chain.
            // Strategy 1: bridge method getW2C.invoke(cam) — preferred, unboxed struct wrapper.
            // Strategy 2: bridge method without arg (some bridge versions differ).
            // Strategy 3: bridge property wtcmProp.get(cam) — boxed, header is 16 bytes of garbage.
            // Strategy 4: direct memory scan on cam.handle — looks for plausible
            //   Matrix4x4 pattern (rotation 3x3 in [-1,1] + homogeneous row 3 ≈ [0,0,0,1]).
            var w2c = null, proj = null;
            function _r12Invoke(getter) {
                if (!getter) return null;
                try { return getter.invoke(cam); } catch (e) {
                    try { return getter.invoke(); } catch (e2) {}
                }
                return null;
            }
            w2c = _r12Invoke(getW2C);
            if (!w2c && wtcmProp) { try { w2c = wtcmProp.get(cam); } catch(e){} }
            proj = _r12Invoke(getProj);
            if (!proj && projProp) { try { proj = projProp.get(cam); } catch(e){} }
            // FIX(R13): Strategy 5b — scan cam+0..0x200 for plausible projection matrix
            // pattern (row 3 has [0,0,?,0]). Different from w2c's [0,0,0,1] row 3.
            if (!proj) proj = tryReadProjFromCamMemory(cam);
            // Strategy 4: memory scan fallback for w2c only (projection has different
            // homogeneous-row pattern: [0,0,-1,0] not [0,0,0,1], so we don't try to scan).
            if (!w2c) {
                try {
                    var _buf = cam.handle.readByteArray(256);
                    var _ba = new Uint8Array(_buf);
                    var _dv = new DataView(_ba.buffer, _ba.byteOffset, _ba.byteLength);
                    var bestScore = -1, bestOff = -1;
                    for (var off = 0; off <= 192; off += 16) {
                        // Column-major: row 3 cells at indices 3, 7, 11, 15 (every 4 floats + 3 byte offset)
                        var m03 = _dv.getFloat32(off + 12, true);
                        var m13 = _dv.getFloat32(off + 28, true);
                        var m23 = _dv.getFloat32(off + 44, true);
                        var m33 = _dv.getFloat32(off + 60, true);
                        var s = 0;
                        if (Math.abs(m03) < 1e-2 && Math.abs(m13) < 1e-2 && Math.abs(m23) < 1e-2 && Math.abs(m33 - 1.0) < 1e-2) s += 10;
                        if (s > 0) {
                            // 9 rotation cells in [-1, 1]
                            for (var r = 0; r < 9; r++) {
                                var v = _dv.getFloat32(off + r*4, true);
                                if (v >= -1.05 && v <= 1.05) s++;
                            }
                            if (s > bestScore) { bestScore = s; bestOff = off; }
                        }
                    }
                    if (bestScore >= 12) {
                        var floats = [];
                        for (var i = 0; i < 16; i++) floats.push(_dv.getFloat32(bestOff + i*4, true));
                        // Build a fake struct wrapper compatible with matrix4x4ToFloats
                        // (uses m.handle.add(byteOff).readFloat() pattern).
                        var _arr = floats;
                        w2c = { handle: { add: function(byteOff) { return { readFloat: function() { return _arr[byteOff/4]; } }; } } };
                        if (pollTickNum === 1) console.log('[*] tick#1: R12 Strategy 4 scan — w2c at cam+0x' + bestOff.toString(16) + ' score=' + bestScore);
                    } else if (pollTickNum === 1) {
                        console.log('[*] tick#1: R12 Strategy 4 scan — no plausible worldToCameraMatrix in cam+0..0xF0 (bestScore=' + bestScore + ')');
                    }
                } catch (e) {
                    if (pollTickNum === 1) console.log('[!] tick#1: R12 Strategy 4 scan THREW: ' + e.message);
                }
            }
            // FIX(R15): Strategy 5 — w2c = transform.get_worldToLocalMatrix() via bridge
            // (named-field access). R14's pointer-chase failed live (m_Transform offset
            // not at any tried offset), so this is now the PRIMARY path. Returns float[16].
            if (!w2c) w2c = tryReadW2CFromTransformMethod(cam);
            // FIX(R14): Strategy 5b — pointer-chase fallback. Kept for completeness; may
            // work in other Unity versions where m_Transform is at an offset we tried.
            if (!w2c) w2c = tryReadW2CFromTransform(cam);

            // FIX: Vector3 is 12-byte value struct — same boxing problem.
            // Use get_position() method instead of property->get() to get unboxed.
            // FIX(R18): per R18 fix, bridge v0.13.1 needs `.invoke()` (no args) for instance
            // methods on the bridge wrapper. Cached via latchedCam-bind to avoid 5Hz re-lookup.
            var pos = null;
            var transform = safe(function(){
                if (!cam) return null;
                var gt = null;
                try { gt = cam.method('get_transform'); } catch (eGTP) { return null; }
                if (!gt) return null;
                try { return gt.invoke(); } catch (eGTI) { return null; }
            }, null);
            if (transform) {
                // FIX(R19): get_position is a 0-arg property getter on Transform. Bridge v0.13.1
                // requires `.invoke()` (no args), not `.invoke(transform)`.
                var getPos = safe(function(){ return transform.method('get_position'); }, null);
                if (getPos) {
                    try {
                        var v = getPos.invoke();
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
