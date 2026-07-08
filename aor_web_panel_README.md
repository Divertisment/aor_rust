# AOR Web Panel — Frida RE for Albion Online

Простой web-интерфейс с кнопками для запуска RE-скриптов через Frida.

## Запуск

```bash
pip install flask   # если ещё нет
cd /mnt/hgfs/D/AOR_core
python3 web_panel.py
```

Открыть в браузере: **http://localhost:7777**

## Использование

1. На главной странице — сетка карточек, каждая содержит:
   - Имя скрипта
   - Описание (что делает)
   - Кнопка `▶ Launch` — запуск с подтягиванием всех путей
   - Кнопка `■ Kill` — прерывание запущенного процесса
   - Кнопка `🗑 Clear` — очистить окно вывода
   - Окно `output` — последние 200 строк stdout/stderr процесса
   - `status` badge:
     - **idle** (серый) — скрипт ещё не запускался
     - **running** (жёлтый) — Frida сейчас подключён и работает
     - **done** (зелёный) — процесс завершился успешно
     - **killed** (красный) — убит пользователем
     - **error** (красный) — не запустилось (Albion не запущен или скрипт не найден)

2. Для каждой кнопки ниже — что нужно делать в Albion, чтобы скрипт что-то нашёл:

| Кнопка | Что делает | Что нужно от тебя |
|---|---|---|
| `Static Byte[] Map` | Перечисляет все классы в `Albion.Common` с Byte[]-полями | Ничего — автоматический |
| `GOM Walk All` | Walk всех GameObjects, hexdump + m_Name probe | Ничего — автоматический (~10 сек) |
| `GOM Poll Live` | Каждые 2с ищет компоненты target-kлассов | Подождать 60 сек, можно двигаться |
| `Find a7h in any assembly` | Sweep assemblies + первый столбец | Ничего — автоматический |
| `Hook a7h.k()` downscale 262KB | Подвязывается, пишет в /tmp | Ничего — автоматический (но он получит мусор 262144 B, не 656100) |
| `Hook Texture2D.GetPixels32 (zoom map!)` | Хукает рендер карты | **Запустить → открыть M → zoom скроллом** |
| `Hook Camera Matrix (world-to-screen 12-floats)` | Polls Camera.main → /tmp/aor_camera_matrix.json | ⚠️ Сейчас ломается на `Camera.main property missing` — фикс нужен |

## Где логи

Все stdouts/stderrs'ы frida-процессов пишутся в:
```
/tmp/aor_panel_logs/<YYYYMMdd_HHMMSS_scriptkey>.log
```

После завершения — файл остаётся, можно grep'ать / меньше путаться чем с терминалом.

## Известные проблемы

- **Camera.main property missing** — frida-il2cpp-bridge v0.13.1 не резолвит статические properties через `.property('main')`. Нужен фикс `method('get_main').invoke(null)`. Сейчас скрипт честно abort'ится.
- **GOM Poll Live [m_Components не срабатывает]** — offsets `m_Components` (0x28/0x30/0x38/0x40/0x48) в конкретной Unity-сборке Albion отличаются от стандартных. Нужен probe через dump первого валидного GO.
- **Hook на a7h.k() возвращает 262144 B (downscale)** — НЕ настоящий atlas 656100. Это известное ограничение в этом билде.
- **SUDO пароль хардкожен** = `31271`. Если в твоём окружении он другой — поменяй в `web_panel.py` (строка `"31271\n"` около subprocess.Popen).

## Что под капотом

```
Browser (you)
  ↓ HTTP
Flask (port 7777)  ← this file
  ↓ subprocess.Popen
sudo -S frida -p <Albion pid> --runtime=v8 \
  -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
  -l /mnt/hgfs/D/AOR_core/Frida/<script>.js
  ↓ stdout+stderr → /tmp/aor_panel_logs/<job_id>.log
  ↓ stdout/stderr real-time → /tail endpoint → AJAX polling (1 sec)
```
