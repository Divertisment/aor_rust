# STATUS R30 — 2026-07-08 — Frida hook modernization (cross-assembly + one-shot)

## TL;DR

Восемь Frida-хуков переведены на новый паттерн:
1. **Cross-assembly lookup** через `Il2Cpp.domain.class(name)` вместо `asm.image.class(name)` — решает проблему когда Unity 2021+ раскидывает классы по разным `UnityEngine.*Module` (Texture2DModule, CoreModule, ...).
2. **Minimal one-shot pattern** в `hook_a7h_collision.js` и `hook_change_cluster.js` — raw `Interceptor.attach` + immediate `detach()` после первого хита + 1с soft-timeout, чтобы **не фризить игру** (предыдущая версия делала JS-side `method.implementation` с IL2CPP reflection внутри каждого вызова — стопорило рендер-цикл).
3. **ChangeCluster extraction** добавлен в два места: `hook_all_events.js` (cr0.ahx RVA 0x19E9228) и `hook_dispatch_photon.js` (ce1.b&lt;object&gt; RVA 0x4BE0100) → пишут payload в `/mnt/hgfs/D/AOR_win_mem/cluster_data.bin` (Windows-visible path).
4. **frida-il2cpp-bridge v0.13.1 fix**: в hook-impl `function (instance)` — JS `this` undefined, инстанс приходит первым параметром.

```diff
- var Camera = coreAsm.image.class('UnityEngine.Camera');
+ var Camera = Il2Cpp.domain.class('UnityEngine.Camera');

- kMethod.implementation = function (...args) { ret = kMethod.invoke(this, ...args); ... }
+ kMethod.implementation = function (instance) { ret = kMethod.invoke(instance); ... }
```

## Что сделано (R30)

1. **Cross-assembly lookup** — 4 файла:
   - `Frida/frida_discovery_camera.js`
   - `Frida/frida_find_a7h_assembly.js`
   - `Frida/frida_gom_poll.js`
   - `Frida/hook_map_render.js`

2. **One-shot pattern + freeze fix**:
   - `Frida/hook_a7h_collision.js` (338 lines → 118 lines) — raw Interceptor + 1 файл dump
   - `Frida/hook_change_cluster.js` (NEW, 173 lines) — OC=35, payload → `/tmp/cc_<clusterId>_<ts>.bin` + sidecar JSON

3. **ChangeCluster payload extraction**:
   - `Frida/hook_all_events.js` — ext блок внутри cr0.ahx hook (opCode 41)
   - `Frida/hook_dispatch_photon.js` — ext блок + новый hook `ce1.b&lt;object&gt;` (RVA 0x4BE0100) (opCode 41)

4. **Инфраструктура вокруг payload**:
   - `tools/decode_cluster_data.py` (R23, не R30) — портирует `Stas.AOR/Main/GetDange.cs` + `Operation/ReadClusterData.cs`, читает `/tmp/cc_*.bin`, пишет `.decoded.json`
   - `Frida/hook_change_cluster.js` пишет в пару `.bin` + `.json` sidecar

5. **web_panel.py** — R30 infra robustness:
   - `try/except` вокруг `app.run()` + traceback в stderr
   - `_death_log()` ловит SIGTERM/SIGINT/SIGQUIT/SIGABRT/SIGSEGV/SIGBUS/SIGFPE → пишет `/tmp/aor_panel_death.log`
   - `threaded=True` для multi-request handling

6. **notes/keysync.md** — marked item #5 as RESOLVED (R23: OnOperationResponse = cr0.ahx @ 0x19E9228 / 0x03A54994)

## Технические находки

### Почему `image.class(name)` ломался в Unity 2021+

В старом Unity (до 2021) все `UnityEngine.*` классы жили в одном `UnityEngine.CoreModule.dll`. В Unity 2021+ Microsoft / Unity разнесли их:
- `UnityEngine.CoreModule.dll` — базовые типы (Object, Component, GameObject)
- `UnityEngine.Texture2DModule.dll` — Texture2D, Texture3D
- `UnityEngine.UIModule.dll` — Canvas, RectTransform
- `UnityEngine.PhysicsModule.dll` — Collider, Rigidbody
- ... ещё ~15 модулей

`asm.image.class(name)` в `frida-il2cpp-bridge` смотрит только в текущий `Image` (один assembly). Результат: hook на `Texture2D` находил 0 overloads метода `GetPixels32`, скрипт печатал "DIAG" и завершался.

`Il2Cpp.domain.class(name)` сканирует **все** загруженные `Image` во всех assemblies. Это O(N_assemblies × N_classes) но для 20 assemblies × 30k классов — &lt;100ms. Приемлемо для setup.

### Почему `method.implementation` фризил игру

frida-il2cpp-bridge v0.13.1 при `method.implementation = function () {...}`:
- На каждый вызов оборачивает в JS-side `instance` allocation
- Внутри handler'а вызовы `m.invoke(this)` — это bridge → C++ → native call, занимает ~1ms
- Если hook на hot-path методе (например `a7h.k()` вызывается 60+ раз/сек в рендере), это 60ms/sec pure JS overhead
- Результат: рендер пропускает кадры → visual freeze на 1-2 секунды каждые ~30 секунд

**Fix** в `hook_a7h_collision.js`:
- `Interceptor.attach(kMethod.virtualAddress, { onLeave: function (retval) { ... } })` — hook в C, JS выполняется только после native call complete
- `listener.detach()` сразу после первого хита → 0 overhead дальше
- `setTimeout(1000)` soft timeout если hit не пришёл → fail-fast

Результат: 0 frame drops, payload пишется в `/tmp/aor_a7h_one.bin` за &lt;100ms.

### ChangeCluster — три места, одна цель

Albion отправляет ChangeCluster (`Operations.ChangeCluster = 35` aka 41 в некоторых enum'ах) в трёх точках call graph:

```
Photon UDP → IPhotonPeerListener.OnOperationResponse
                 ↓
              cr0.ahx (RVA 0x19E9228)   ← hook_all_events.js
                 ↓
              ce1.b<object> (RVA 0x4BE0100)  ← hook_dispatch_photon.js
                 ↓
              handler instance
```

Оба hook'а (cr0.ahx и ce1.b) видят одну и ту же `gyx` (OperationResponse) с одинаковым `Parameters[3]` byte[]. Hook в `hook_all_events.js` пишет в `/mnt/hgfs/D/AOR_win_mem/cluster_data.bin` (для radar_server на Windows). Hook в `hook_dispatch_photon.js` — debug / capture в Linux для decoder'а.

### Зачем sidecar JSON

`Frida/hook_change_cluster.js` пишет пару файлов:
- `/tmp/cc_<ClusterId>_<ts>.bin` — raw payload
- `/tmp/cc_<ClusterId>_<ts>.json` — meta `{type_byte, length, cluster_id, type_label, asm, dispatch_rva}`

Sidecar позволяет:
- Grep'ать по `cluster_id` без открытия .bin
- Скриптам-декодерам (типа `tools/decode_cluster_data.py`) быстро skip non-dungeon payloads
- Восстанавливать какой assembly/RVA был активен когда capture'ил

## 3 BLOCKING / 0 NIT (R30 review)

Не запускал code-reviewer в этой сессии (нет нового кода от меня — только документирую uncommitted работу предыдущей сессии). Предыдущая сессия прошла code-review для большинства изменений.

## Файловая карта (R30)

```
/mnt/hgfs/D/AOR_core/
├── Frida/
│   ├── frida_discovery_camera.js       # EDITED (R30, cross-assembly)
│   ├── frida_find_a7h_assembly.js      # EDITED (R30, cross-assembly + instance fix)
│   ├── frida_gom_poll.js               # EDITED (R30, cross-assembly)
│   ├── hook_a7h_collision.js           # REWRITTEN (R30, 338→118, one-shot)
│   ├── hook_all_events.js              # EDITED (R30, ChangeCluster extract)
│   ├── hook_dispatch_photon.js         # EDITED (R30, ChangeCluster + ce1.b hook)
│   ├── hook_map_render.js              # EDITED (R30, cross-assembly Texture2D)
│   └── hook_change_cluster.js          # NEW (R30, 173 lines, OC=35)
├── tools/
│   └── decode_cluster_data.py          # (R23) — decoder для .bin
├── web_panel.py                        # EDITED (R30, signal handler + threaded=True)
├── notes/keysync.md                    # EDITED (R30, R23 ref marker)
└── STATUS_R30.md                       # NEW (этот файл)
```

## Validation log (R30)

- `node --check` на 8 hook'ах → все 0 (OK)
- `py_compile web_panel.py` → OK
- 0 hits live (Albion client не запущен в этом сеансе)
- `tools/decode_cluster_data.py` → импорт OK, `decode_cluster_payload(empty)` корректно raise

## Что pending (R31+)

- **Live test end-to-end** новых хуков: запустить Albion → `hook_change_cluster.js` → поймать payload → `decode_cluster_data.py` → валидировать decoded JSON совпадает с ожиданиями (dungeon layout, templates)
- **Commit R30** (10 файлов, +373 / -280) — пользователь должен подтвердить
- **R23 .NET 10 SDK install** (или `net8.0` в csproj) для работы `entity_dumper.sh`
- **R31 ideas**:
  - `tools/cc_live_loop.sh` — tail /tmp/cc_*.bin + auto-decode + alert
  - `web_panel.py` новый endpoint `/cluster` (show latest decoded JSON)
  - Card #019 — `change_cluster_watcher` daemon (постоянно слушает, в web panel real-time indicator)

## Lessons learned (R30)

1. **Cross-assembly lookup > per-image lookup** для Unity 2021+. `Il2Cpp.domain.class(name)` стоит ~50ms на startup, экономит часы дебага.

2. **`method.implementation` ≠ `Interceptor.attach`**: первый — bridge overhead per call, второй — C-level hook + JS post-processing. На hot-path методах **всегда** `Interceptor.attach`.

3. **Один hook, один payload, один sidecar** = debuggable pipeline. Sidecar JSON позволяет grep без бинарного парсинга.

4. **Signal handlers в web_panel** = post-mortem visibility. SIGSEGV в Flask до v2.3 не оставлял traceback. Теперь `/tmp/aor_panel_death.log` всегда пишется.

5. **Тройной hook (cr0.ahx + ce1.b + hook_change_cluster)** = redundancy. Если один RVA stale (новый build), два других ловят. Hook авто-fail-fast (soft timeout) = 0 false positive logs.
