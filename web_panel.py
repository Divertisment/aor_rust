#!/usr/bin/env python3
"""
web_panel.py — Flask web UI to launch Frida RE scripts against Albion-Online.

    sudo pip install flask
    python web_panel.py

Открыть:  http://localhost:7777
"""
import os
import subprocess
import json
import time
import threading
from datetime import datetime
from flask import Flask, render_template_string, jsonify

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

LOG_DIR = "/tmp/aor_panel_logs"
os.makedirs(LOG_DIR, exist_ok=True)

# ─── BUILD_VERSION — auto-bumped при каждом запуске Python-модуля.
# Используется как маркер: если версия в браузере меняется → рестарт произошёл.
_STARTED_AT = datetime.now()
__version__  = "v" + _STARTED_AT.strftime("%Y%m%d.%H%M%S") + "." + str(os.getpid())
__pid__      = os.getpid()

# Track launched jobs. Key is job_id (datetime_str_key).
JOBS = {}  # job_id -> {pid, frida_pid, status, log_file, started_at, key, name, script}

# Catalog of scripts we expose as buttons. Each entry maps a UI-key to:
#  - name (display)
#  - description (one line)
#  - script (path under /mnt/hgfs/D/AOR_core/)
# Конкретные пошаговые действия игрока, отображаются под каждой карточкой
# как список задач. Порядок выполнения = порядок карточек в панели.
SCRIPTS = {
    "gom_walk_all": {
        "name": "Полный обход GOM (8087 узлов, дамп первых 30)",
        "description": "Проходит по всем GameObject в GOM, для первых 30 валидных (m_InstanceID != 0) делает hexdump, пробует прочитать m_Name и m_Components. Используй чтобы увидеть как устроены объекты в памяти.",
        "script": "/mnt/hgfs/D/AOR_core/Frida/frida_dump_all_gos.js",
        "tasks": [
            "Жми ▶ Launch",
            "В игре: ничего не делай",
            "В окне жди блоки \"[GO #N] id=...\"",
            "Карточка зеленеет сама через 1.5 мин",
        ],
    },
    "discovery_camera": {
        "name": "🎰 C++ Discovery (Camera.main → offsets)",
        "description": "Одноразовый поиск точных C++ offsets. Использует Camera.main как ground-truth (находит m_CachedPtr, GetInstanceID, native Cam). Сканирует native GameObject и сообщает точные смещения для m_InstanceID / m_Components buffer+stride / m_Name. Запусти первым после открытия сцены — чтобы GOM-poll и Rзм.обход GOM использовали правильные offsets.",
        "script": "/mnt/hgfs/D/AOR_core/Frida/frida_discovery_camera.js",
        "tasks": [
            "Жми ▶ Launch",
            "В игре: ничего не делай",
            "В окне жди \"[*] m_InstanceID @ +0x...\"",
            "Карточка зеленеет сама через 3 мин",
        ],
    },
    "gom_poll_live": {
        "name": "GOM-poll в реалтайме (поиск целей)",
        "description": "Каждые 2 сек проходит GOM и ищет в m_Components признаки CollisionTester / CGA / a7h. Auto-discovery через Camera.main на старте; если ей не удалось — падает на fallback список offsets.",
        "script": "/mnt/hgfs/D/AOR_core/Frida/frida_gom_poll.js",
        "tasks": [
            "Жми ▶ Launch",
            "В игре: зажми ЛКМ",
            "В игре: поводи камерой вокруг персонажа 5 секунд",
            "В окне жди \"[*] tick#N walked ... GOs\"",
            "Карточка зеленеет сама через 3 мин",
        ],
    },
    "find_a7h_assembly": {
        "name": "Найти a7h в любой сборке",
        "description": "Сканирует все Il2Cpp-сборки + ставит хук на OnClusterLoaded, чтобы определить в какой сборке живёт a7h. Результат: Albion.Common.",
        "script": "/mnt/hgfs/D/AOR_core/Frida/frida_find_a7h_assembly.js",
        "tasks": [
            "Жми ▶ Launch",
            "В игре: ничего не делай",
            "В окне жди \"[*] ★★★ a7h was LOCATED\"",
            "Карточка зеленеет сама через 3 мин",
        ],
    },
    "hook_collision": {
        "name": "Хук a7h.k() — даунскейл 262 КБ",
        "description": "Ставит хук на геттер byte[] у a7h. ⚠ На практике возвращает preview 262144 байт, а НЕ полный атлас 656100 — это превью, а сам массив ещё нужно найти.",
        "script": "/mnt/hgfs/D/AOR_core/Frida/hook_a7h_collision.js",
        "tasks": [
            "Жми ▶ Launch",
            "В игре: нажми W",
            "В игре: иди вперёд 5 секунд",
            "[!] class a7h not found — это ОК",
            "Карточка зеленеет сама через 3 мин",
        ],
    },
    "hook_map_render": {
        "name": "Хук Texture2D.GetPixels32 (зум карты!)",
        "description": "Запусти скрипт, потом ОТКРОЙ мировую карту (клавиша M) и крути колесо зума — хук сработает на текстуру карты. Фильтрует площади 656100 / 10 497 600. Дамп пишется в /tmp/aor_map_*.bin.",
        "script": "/mnt/hgfs/D/AOR_core/Frida/hook_map_render.js",
        "tasks": [
            "Жми ▶ Launch",
            "В игре: нажми M (открыть WorldMap)",
            "В игре: колесо мыши ОТ СЕБЯ ×5 (зум IN)",
            "В игре: колесо мыши НА СЕБЯ ×5 (зум OUT)",
            "В игре: нажми M (закрыть)",
            "Подожди 5 секунд",
            "В игре: нажми M (снова открыть)",
            "В игре: колесо ×5 в любую сторону",
            "В окне жди ★ DUMPED 656100b.bin",
            "Карточка зеленеет сама через 3 мин",
        ],
    },
    "hook_camera_matrix": {
        "name": "Хук матрицы камеры (world→screen, 12 чисел)",
        "description": "Каждые 200мс опрашивает Camera.main и читает worldToCameraMatrix + projectionMatrix + position → /tmp/aor_camera_matrix.json (12 чисел под transform_point_3x4). Watchdog 180с.",
        "script": "/mnt/hgfs/D/AOR_core/Frida/hook_camera_matrix.js",
        "tasks": [
            "Жми ▶ Launch",
            "В игре: зажми ЛКМ",
            "В игре: поводи камерой на персонажа",
            "В окне жди tick#N camera=0x...",
            "Карточка зеленеет сама через 3 мин",
        ],
    },
}

ALBION_PID = None

HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>AOR Panel — Frida RE for Albion Online</title>
<style>
    :root {
        --bg: #0a0a14;
        --fg: #d0d0d0;
        --card-bg: #15151f;
        --border: #2a2a3a;
        --accent: #ff6600;
        --ok: #39ff14;          /* brighter electric green — было #00ff99 */
        --ok-glow: 0 0 4px #39ff14, 0 0 10px #39ff14, 0 0 18px rgba(57, 255, 20, 0.6);
        --running: #ffff00;
        --err: #ff5555;
        --info: #00aaff;
    }
    body {
        background: var(--bg);
        color: var(--fg);
        font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
        padding: 20px;
        max-width: 1400px;
        margin: 0 auto;
    }
    h1 {
        color: var(--accent);
        border-bottom: 1px solid var(--border);
        padding-bottom: 8px;
        font-size: 18pt;
        margin-top: 0;
    }
    h2 {
        color: var(--ok);
        font-size: 13pt;
        margin-top: 24px;
        border-left: 3px solid var(--ok);
        padding-left: 10px;
    }
    .controls {
        background: var(--card-bg);
        border: 1px solid var(--border);
        padding: 12px 16px;
        margin-bottom: 20px;
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
    }
    .controls label { color: #888; font-size: 10pt; }
    .controls span { color: var(--info); font-size: 11pt; padding: 0 6px; }
    .controls code { color: var(--ok); background: #000; padding: 2px 6px; border-radius: 3px; }
    .script-grid {
        display: grid;
        grid-template-columns: 1fr;     /* одноколоночный layout — задачи не переносятся */
        gap: 14px;
    }
    .script-card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-left: 3px solid var(--info);
        padding: 12px 16px;
        transition: border-left-color 0.2s;
    }
    .script-card.running-card { border-left-color: var(--running); }
    .script-card.done-card    {
        border-left-color: var(--ok);
        border-left-width: 5px;
        box-shadow: 0 0 12px var(--ok), inset 0 0 14px rgba(57, 255, 20, 0.18);
    }
    .script-card.error-card   { border-left-color: var(--err); }
    .script-card h3 {
        margin: 0 0 6px 0;
        color: var(--ok);
        font-size: 11pt;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .script-card .desc {
        color: #999;
        font-size: 9pt;
        margin-bottom: 8px;
        min-height: 30px;
        line-height: 1.4;
    }
    .script-card .actions {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
    }
    .script-card .meta {
        font-size: 8pt;
        color: #555;
        margin-bottom: 6px;
    }
    .script-card .meta code {
        color: #777;
    }
    .script-card .tasks {
        background: #0a0a18;
        border-left: 3px solid #ff6600;
        padding: 8px 12px;
        margin: 8px 0;
        font-size: 9.5pt;
        color: #e0e0e0;
    }
    .script-card .tasks .tasks-title {
        color: #ff6600;
        font-weight: bold;
        margin-bottom: 4px;
        font-size: 10pt;
    }
    .script-card .tasks ol {
        margin: 0;
        padding-left: 22px;
        color: #d0d0d0;
        line-height: 1.55;
    }
    .script-card .tasks ol li {
        margin-bottom: 2px;
    }
    .btn {
        background: #003366;
        color: var(--info);
        border: 1px solid #0066aa;
        padding: 5px 12px;
        font: inherit;
        cursor: pointer;
        font-size: 10pt;
    }
    .btn:hover:not(:disabled) {
        background: #0066aa;
        color: #fff;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.kill {
        background: #660000;
        color: var(--err);
        border-color: #aa0000;
    }
    .btn.kill:hover:not(:disabled) {
        background: #aa0000;
        color: #fff;
    }
    .status {
        display: inline-block;
        padding: 2px 8px;
        font-size: 8pt;
        border-radius: 3px;
        letter-spacing: 0.4px;
    }
    .status.idle    { background: #2a2a2a; color: #888; }
    .status.running { background: #3a3a00; color: var(--running); }
    .status.done    {
        background: #0d2a0d;
        color: var(--ok);
        font-weight: bold;
        letter-spacing: 0.6px;
        text-shadow: var(--ok-glow);
        box-shadow: 0 0 6px var(--ok), inset 0 0 4px rgba(57, 255, 20, 0.4);
    }
    .status.killed  { background: #3a1a1a; color: var(--err); }
    .status.error   { background: #3a1a1a; color: var(--err); }
    .output {
        background: #000;
        color: #aef;
        padding: 10px;
        max-height: 220px;
        overflow: auto;
        font-size: 8.5pt;
        line-height: 1.35;
        border: 1px solid var(--border);
        margin-top: 6px;
        white-space: pre;
        font-family: monospace;
    }
    .legend {
        font-size: 9pt;
        color: #666;
        margin-bottom: 16px;
        padding: 8px 12px;
        background: #1a1a2a;
        border-left: 3px solid #666;
    }
</style>
</head>
<body>
<h1>🛸 AOR Panel · Frida RE for Albion Online</h1>

<div class="legend">
    <strong>Как пользоваться:</strong> 1) Жми ▶ Launch на карточке → Frida подключится к Albion Online; 2) Скрипт работает в фоне, его вывод стримится в окно под карточкой; 3) Когда закончит — статус станет зелёным; 4) Кнопкой ■ Kill можно в любой момент прервать скрипт.<br>
    <strong>Подсказки:</strong> Для карты — после запуска жми M (откроется WorldMap) и крути колесо мыши для зума. Для смены кластера — просто перейди в другую зону (другой остров / город). Не забудь: скрипты с ⚠ сейчас работают криво — помечены как «нужен фикс».
</div>

<div class="controls">
    <label>PID Albion Online:</label>
    <span id="albionPid">--</span>
    <button class="btn" onclick="refreshPid()">🔄 Пересканировать</button>
    <label style="margin-left:24px">Пароль SUDO (прописан в web_panel.py):</label>
    <code>31271</code>
    <label style="margin-left:24px">⏱ Сервер запущен:</label>
    <span id="serverTime">--</span>
    <label style="margin-left:24px">📦 Build:</label>
    <code id="buildVer" style="color:#ff6600; font-weight:bold; background:#000;">--</code>
    <label style="margin-left:12px">PID:</label>
    <code id="serverPid">--</code>
</div>

<h2>▶ Frida-скрипты для RE</h2>
<div class="script-grid">
{% for key, s in SCRIPTS.items() %}
<div class="script-card" id="card-{{ key }}">
    <h3>
        <span style="color:#ff6600; margin-right:6px;">[{{ loop.index }}/{{ SCRIPTS|length }}]</span>
        {{ s.name }}
        <span class="status idle" id="status-{{ key }}">простаивает</span>
    </h3>
    <div class="desc">{{ s.description }}</div>
    <div class="meta">
        <code>{{ s.script }}</code>
    </div>
    {% if s.tasks %}
    <div class="tasks" id="tasks-{{ key }}">
        <div class="tasks-title">🎮 Что делать (порядок шагов):</div>
        <ol>
        {% for t in s.tasks %}
            <li>{{ t }}</li>
        {% endfor %}
        </ol>
    </div>
    {% endif %}
    <div class="actions">
        <button class="btn" onclick="launch('{{ key }}')" id="launch-btn-{{ key }}">▶ Launch</button>
        <button class="btn kill" onclick="killActive('{{ key }}')" id="kill-btn-{{ key }}" disabled>■ Kill</button>
        <button class="btn" onclick="clearOutput('{{ key }}')" id="clear-btn-{{ key }}">🗑 Clear</button>
    </div>        <pre class="output" id="output-{{ key }}">(вывод появится после нажатия Launch)</pre>
</div>
{% endfor %}
</div>

<script>
const activeJobs = {}; // key -> job_id

// Маппинг канонических состояний на русские подписи (для status-бейджей).
const STATUS_TEXT = {
    idle:      'простаивает',
    launching: 'запускается',
    running:   'выполняется',
    done:      'готово',
    killed:    'прервано',
    error:     'ошибка',
};
function setStatus(el, key, extra) {
    el.className = 'status ' + key;
    el.textContent = STATUS_TEXT[key] + (extra ? ' (' + extra + ')' : '');
}

async function refreshPid() {
    try {
        const r = await fetch('/pid');
        const j = await r.json();
        document.getElementById('albionPid').textContent = j.pid ? (j.pid + ' (' + j.name + ')') : 'NOT FOUND';
    } catch (e) {
        document.getElementById('albionPid').textContent = 'err: ' + e;
    }
}

async function launch(key) {
    const card = document.getElementById('card-' + key);
    const statusEl = document.getElementById('status-' + key);
    const outputEl = document.getElementById('output-' + key);
    const launchBtn = document.getElementById('launch-btn-' + key);
    const killBtn = document.getElementById('kill-btn-' + key);

    launchBtn.disabled = true;
    setStatus(statusEl, 'launching');
    card.classList.remove('done-card', 'error-card');

    try {
        const r = await fetch('/launch/' + key, {method: 'POST'});
        const j = await r.json();
        if (j.error) {
            setStatus(statusEl, 'error');
            outputEl.textContent = 'ОШИБКА: ' + j.error;
            launchBtn.disabled = false;
            return;
        }
        activeJobs[key] = j.job_id;
        killBtn.disabled = false;
        pollJob(key, j.job_id);
    } catch (e) {
        setStatus(statusEl, 'error');
        outputEl.textContent = 'ИСКЛЮЧЕНИЕ: ' + e;
        launchBtn.disabled = false;
    }
}

async function pollJob(key, jobId) {
    const card = document.getElementById('card-' + key);
    const statusEl = document.getElementById('status-' + key);
    const outputEl = document.getElementById('output-' + key);
    const launchBtn = document.getElementById('launch-btn-' + key);
    const killBtn = document.getElementById('kill-btn-' + key);

    while (activeJobs[key] === jobId) {
        try {
            const tr = await fetch('/tail/' + jobId);
            const tj = await tr.json();
            if (tj.lines && tj.lines.length > 0) {
                outputEl.textContent = tj.lines.join('\\n');
                outputEl.scrollTop = outputEl.scrollHeight;
            }

            const sr = await fetch('/status/' + jobId);
            const sj = await sr.json();
            if (!sj.running) {
                const pidLabel = 'pid ' + (sj.job.pid || '?');
                if (sj.job.status === 'killed') {
                    setStatus(statusEl, 'killed', pidLabel);
                    card.classList.remove('done-card');
                    card.classList.add('error-card');
                } else {
                    setStatus(statusEl, 'done', pidLabel);
                    card.classList.add('done-card');
                }
                break;
            }
            setStatus(statusEl, 'running', 'pid ' + sj.job.frida_pid);
            card.classList.add('running-card');
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }
    launchBtn.disabled = false;
    killBtn.disabled = true;
}

async function killActive(key) {
    if (!activeJobs[key]) return;
    try {
        const confirmBtn = document.getElementById('kill-btn-' + key);
        confirmBtn.disabled = true;
        await fetch('/kill/' + activeJobs[key], {method: 'POST'});
        setStatus(document.getElementById('status-' + key), 'killed');
        delete activeJobs[key];        } catch (e) {
            const el = document.getElementById('status-' + key);
            if (el) el.textContent = 'ошибка при kill: ' + e;
        }
}

function clearOutput(key) {
    document.getElementById('output-' + key).textContent = '(очищено)';
}

// Аптайм сервера (HH:MM:SS от старта процесса). Берём из /version (elapsed_sec)
// — пересчёт вдёт на сервере от _STARTED_AT = datetime.now() в момент импорта модуля.
function refreshTime() {
    fetch('/version').then(r => r.json()).then(j => {
        const sec = Math.max(0, j.elapsed_sec || 0);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = n => String(n).padStart(2, '0');
        const el = document.getElementById('serverTime');
        if (el) el.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
    }).catch(() => {});
}
setInterval(refreshTime, 1000);
refreshTime();
refreshPid();

async function refreshVersion() {
    try {
        const r = await fetch('/version');
        const j = await r.json();
        document.getElementById('buildVer').textContent = j.version;
        document.getElementById('serverPid').textContent = j.pid;
    } catch (e) {}
}
refreshVersion();
setInterval(refreshVersion, 5000);
</script>
</body>
</html>
"""

# ─── helpers ───────────────────────────────────────────────
def get_albion_pid():
    global ALBION_PID
    if ALBION_PID:
        try:
            os.kill(ALBION_PID, 0)
            return ALBION_PID
        except OSError:
            ALBION_PID = None
    out = subprocess.run(["pidof", "-s", "Albion-Online"],
                         capture_output=True, text=True)
    if out.returncode == 0 and out.stdout.strip().isdigit():
        ALBION_PID = int(out.stdout.strip())
    return ALBION_PID


# ─── routes ────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template_string(HTML, SCRIPTS=SCRIPTS, JOBS=JOBS)


@app.route("/pid")
def get_pid():
    pid = get_albion_pid()
    return jsonify({"pid": pid, "name": "Albion-Online" if pid else None})


@app.route("/version")
def version():
    elapsed = int((datetime.now() - _STARTED_AT).total_seconds())
    return jsonify({
        "version": __version__,
        "pid": __pid__,
        "started_at": _STARTED_AT.isoformat(),
        "elapsed_sec": elapsed,
    })


@app.route("/launch/<key>", methods=["POST"])
def launch(key):
    if key not in SCRIPTS:
        return jsonify({"error": f"unknown script: {key}"}), 400
    pid = get_albion_pid()
    if not pid:
        return jsonify({"error": "Albion-Online not running"}), 503
    if not os.path.exists(SCRIPTS[key]["script"]):
        return jsonify({"error": f"script file missing: {SCRIPTS[key]['script']}"}), 500

    job_id = datetime.now().strftime("%Y%m%d_%H%M%S_") + key
    log_file = os.path.join(LOG_DIR, job_id + ".log")
    cmd = [
        "sudo", "-S",
        "frida", "-p", str(pid), "--runtime=v8",
        "-l", "/usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js",
        "-l", "/mnt/hgfs/D/AOR_core/Frida/lib_offsets_discovery.js",
        "-l", SCRIPTS[key]["script"],
    ]




    with open(log_file, "wb") as f:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=f,
            stderr=subprocess.STDOUT,
            bufsize=0,
            cwd="/mnt/hgfs/D/AOR_core",
        )
        try:
            proc.stdin.write(b"31271\n")
            proc.stdin.flush()
            proc.stdin.close()
        except Exception:
            pass

    # ─── Server-side watchdog: гарантированно убивает frida через 180 с
    # независимо от того, что делает V8-скрипт. Скрипт-сайд watchdog
    # (Process.exit в frida_gum) убивает TARGET процесс (Albion), а не
    # frida CLI — поэтому на него полагаться НЕЛЬЗЯ. Этот таймер живёт
    # в Python-процессе web_panel и срабатывает надёжно.
    def _wd_kill():
        try:
            if proc.poll() is None:  # frida ещё жив
                with open(log_file, "a", buffering=1) as lf:
                    lf.write("\n[*] === server-side watchdog: killing frida (180s elapsed) ===\n")
                proc.terminate()
                time.sleep(1)
                if proc.poll() is None:
                    proc.kill()
        except Exception:
            pass

    watchdog = threading.Timer(120.0, _wd_kill)  # FIX: было 180s — уменьшил по просьбе пользователя
    watchdog.daemon = True
    watchdog.start()

    JOBS[job_id] = {
        "key": key,
        "pid": proc.pid,
        "frida_pid": proc.pid,
        "status": "running",
        "log_file": log_file,
        "started_at": datetime.now().isoformat(),
        "script_path": SCRIPTS[key]["script"],
        "name": SCRIPTS[key]["name"],
        "watchdog": watchdog,  # /kill route вызывает .cancel() на этом таймере
    }
    return jsonify({"job_id": job_id, "pid": proc.pid, "log": log_file})


@app.route("/status/<job_id>")
def status(job_id):
    if job_id not in JOBS:
        return jsonify({"error": "unknown job"}), 404
    job = JOBS[job_id]
    try:
        os.kill(job["pid"], 0)
        still_running = True
    except OSError:
        still_running = False
        if job["status"] == "running":
            JOBS[job_id]["status"] = "done"
    return jsonify({"job": job, "running": still_running})


@app.route("/tail/<job_id>")
def tail(job_id):
    if job_id not in JOBS:
        return jsonify({"error": "unknown job"}), 404
    log_file = JOBS[job_id]["log_file"]
    if not os.path.exists(log_file):
        return jsonify({"lines": []})
    try:
        with open(log_file, "rb") as f:
            f.seek(0, 2)
            sz = f.tell()
            f.seek(max(0, sz - 65536))
            data = f.read().decode("utf-8", errors="replace")
    except Exception as e:
        return jsonify({"error": str(e), "lines": []})
    lines = data.splitlines()[-200:]
    return jsonify({"lines": lines})


@app.route("/kill/<job_id>", methods=["POST"])
def kill(job_id):
    if job_id not in JOBS:
        return jsonify({"error": "unknown job"}), 404
    job = JOBS[job_id]
    if job.get("watchdog"):
        try: job["watchdog"].cancel()
        except Exception: pass
    try:
        os.kill(job["pid"], 9)
    except OSError:
        pass
    JOBS[job_id]["status"] = "killed"
    return jsonify({"ok": True})


if __name__ == "__main__":
    print("[*] AOR Panel listening on http://0.0.0.0:7777")
    print("[*] Open in browser: http://localhost:7777")
    # use_reloader=False: Flask watch & restart on file changes — next правка файла не требует kill -9 + relaunch
    app.run(host="0.0.0.0", port=7777, debug=False, use_reloader=False)
