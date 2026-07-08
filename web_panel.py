#!/usr/bin/env python3
"""
web_panel.py — Flask web UI to launch Frida RE scripts against Albion-Online.

    sudo pip install flask
    python web_panel.py

Открыть:  http://localhost:7777
"""
import os
import sys
import glob
import subprocess
import json
import time
import threading
from datetime import datetime
from flask import Flask, render_template_string, jsonify, redirect, send_file

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
#  - tasks (list[str]) — пошаговые действия игрока, отображаются под каждой карточкой
#  - doc  (str)        — длинное описание что это и зачем (для README, не в UI)
#
# R23 refactor: все карточки лежат в отдельной папке `web_panel_cards/` в виде
# `<NNN>_<key>.json` файлов. Здесь — только loader + кеш. Каждая карточка имеет
# `active: true|false` — выключенные НЕ рендерятся в UI. Чтобы показать
# паркованную карточку, поменяй `active: false` → `active: true` в её JSON и
# перезапусти web_panel. Полная документация: web_panel_cards/README.md.
SCRIPTS_CARDS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_panel_cards")


def _load_cards(folder: str = SCRIPTS_CARDS_DIR) -> dict:
    """Прочитать все активные карточки из `folder/*.json` (один файл на карточку).

    Каждый файл должен иметь поля: `key`, `active`, `index`, `name`, `description`,
    `script`, `tasks[]`, `doc`. `active=false` карточки пропускаются. Возвращаемый
    dict отсортирован по `index` (стартовая позиция в UI).
    """
    out: dict = {}
    if not os.path.isdir(folder):
        print(f"[web_panel] card folder not found: {folder}", file=sys.stderr)
        return out
    for path in sorted(glob.glob(os.path.join(folder, "*.json"))):
        try:
            with open(path, "r", encoding="utf-8") as f:
                card = json.load(f)
        except (OSError, ValueError) as e:
            print(f"[web_panel] failed to load card {path}: {e}", file=sys.stderr)
            continue
        if not isinstance(card, dict):
            print(f"[web_panel] card {path} is not a JSON object", file=sys.stderr)
            continue
        if not card.get("active", False):
            continue
        key = card.get("key")
        if not key or not isinstance(key, str):
            print(f"[web_panel] card {path} missing/invalid 'key' field", file=sys.stderr)
            continue
        if key in out:
            print(f"[web_panel] duplicate key {key!r} from {path}", file=sys.stderr)
            continue
        script = card.get("script", "")
        if script and not os.path.isabs(script):
            print(f"[web_panel] card {key}: script path is not absolute: {script}", file=sys.stderr)
        tasks = card.get("tasks") or []
        if not isinstance(tasks, list):
            tasks = [str(tasks)]
        out[key] = {
            "name": str(card.get("name", key)),
            "description": str(card.get("description", "")),
            "script": str(script),
            "tasks": [str(t) for t in tasks],
            # `doc` хранится в карточке, но в UI не рендерится — для README.
            "_doc": str(card.get("doc", "")),
            "_index": int(card.get("index", 0)),
            # `resolved` помечает решенные карточки — обводятся зелёной рамкой
            # в UI. По умолчанию false. Юзер сам ставит `"resolved": true`
            # когда задача закрыта.
            "resolved": bool(card.get("resolved", False)),
        }
    # Сортируем по `_index` (на случай если glob упорядочил не так).
    return dict(sorted(out.items(), key=lambda kv: kv[1].get("_index", 0)))


SCRIPTS = _load_cards()
TOTAL_CARDS = len(glob.glob(os.path.join(SCRIPTS_CARDS_DIR, "*.json")))  # all cards, parked+active

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
    .script-card.resolved-card {
        border: 2px solid var(--ok);
        border-left: 5px solid var(--ok);
        box-shadow: 0 0 10px var(--ok), inset 0 0 14px rgba(57, 255, 20, 0.12);
        background: linear-gradient(180deg, rgba(57, 255, 20, 0.04), var(--card-bg) 30%);
    }
    .script-card.resolved-card h3::after {
        content: "✓ РЕШЕНО";
        color: var(--ok);
        font-size: 9pt;
        letter-spacing: 0.5px;
        text-shadow: var(--ok-glow);
        margin-left: 8px;
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
    <button class="btn" onclick="reloadCards()" style="margin-left:12px; background:#2a2a00; color:#ffff00; border-color:#666600;">⟳ Cards</button>
</div>

<h2>🗺 Atlas preview <span style="font-size:8pt; color:#888;">(auto-refresh 5s)</span></h2>
<div class="map-preview" id="mapPreview" style="background:var(--card-bg); border:1px solid var(--border); border-left:3px solid var(--info); padding:12px 16px; display:grid; grid-template-columns: 1fr 280px; gap:16px; align-items:start;">
    <div>
        <div id="mapTabs" style="margin-bottom:8px; display:flex; gap:6px; font-size:9.5pt;">
            <button class="map-tab active" data-kind="atlas"   onclick="switchMapTab('atlas')">🖼 Base <span id="cntAtlas"  class="cnt">0</span></button>
            <button class="map-tab"        data-kind="overlay" onclick="switchMapTab('overlay')">🎯 Overlay <span id="cntOverlay" class="cnt">0</span></button>
            <button class="map-tab"        data-kind="diff"    onclick="switchMapTab('diff')">🔄 Diff <span id="cntDiff"    class="cnt">0</span></button>
        </div>
        <img id="mapImg" src="/map" alt="worldmap atlas (no dumps yet — run card #12 then #13)" style="max-width:100%; max-height:540px; image-rendering:pixelated; background:#000; border:1px solid var(--border); display:block;" onerror="this.style.opacity=0.2; document.getElementById('mapMeta').textContent='нет PNG — запусти #12 (capture) → #13 (parse)';">
        <div style="margin-top:6px; font-size:8pt; color:#666;">PNG превью обновляется каждые 5с. <code>image-rendering:pixelated</code> чтобы пиксели были чёткие (атлас — низкое разрешение).</div>
    </div>
    <div>
        <div class="meta" style="font-size:8.5pt; color:#888; line-height:1.6;">
            <div style="color:var(--info); font-weight:bold; margin-bottom:4px;">Latest dump:</div>
            <div id="mapMeta" style="background:#0a0a18; padding:8px; border-left:2px solid var(--info); font-family:monospace; white-space:pre-wrap;">(waiting for first dump…)</div>
        </div>
        <div style="margin-top:10px; font-size:8.5pt; color:#888;">
            <div style="color:var(--info); font-weight:bold; margin-bottom:4px;">All dumps (<span id="tabLabel">atlas</span>):</div>
            <select id="mapSelect" size="6" style="width:100%; background:#0a0a18; color:#d0d0d0; border:1px solid var(--border); font-family:monospace; font-size:8pt; padding:4px;" onchange="if(this.value) onMapSelectChange(this.value);">
                <option>(empty)</option>
            </select>
        </div>
        <div style="margin-top:6px; font-size:7.5pt; color:#666;">Клик на entry — переключить preview. <span style="color:#39ff14">Overlay</span> = #14; <span style="color:#ff5555">Diff</span> = #15.</div>
    </div>
</div>

<style>
.map-tab {
    background: #1a1a2a; color: #888;
    border: 1px solid var(--border);
    padding: 5px 10px; cursor: pointer;
    font: inherit; font-size: 9.5pt;
    letter-spacing: 0.3px;
    border-radius: 3px 3px 0 0;
    border-bottom: 2px solid transparent;
}
.map-tab:hover:not(.active) { background: #2a2a3a; color: #aaa; }
.map-tab.active {
    color: var(--info);
    border-bottom-color: var(--info);
    background: #0a0a18;
}
.map-tab .cnt {
    display: inline-block;
    background: #2a2a3a;
    color: #666;
    border-radius: 8px;
    padding: 0 6px;
    margin-left: 4px;
    font-size: 8pt;
}
.map-tab.active .cnt { background: var(--info); color: #000; font-weight: bold; }
</style>

<h2>▶ Frida-скрипты для RE</h2>

<div class="todo-box" id="todoBox">
    <label class="todo-label" for="userTodo">📝 Текущая задача (TODO) — сохраняется в браузере:</label>
    <textarea id="userTodo" class="todo-textarea" rows="3" placeholder="Например: проверить #14 overlay с реальными entities / починить SDK mismatch в aor_scanner / написать R29 live overlay ..."></textarea>
    <div class="todo-meta">
        <span id="todoStatus" class="todo-status-empty">(пусто — начни вводить)</span>
        <button onclick="clearTodo()">🗑 Очистить</button>
    </div>
</div>
<div class="script-grid">
{% for key, s in SCRIPTS.items() %}
<div class="script-card{% if s.resolved %} resolved-card{% endif %}" id="card-{{ key }}">
    <h3>
        <span style="color:#ff6600; margin-right:6px;">[{{ s._index }}/{{ total_in_folder }}]</span>
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
async function reloadCards() {
    try {
        const r = await fetch('/reload-cards', {method: 'POST'});
        const j = await r.json();
        if (j.ok) location.reload();
        else alert('reload failed');
    } catch (e) {
        alert('reload error: ' + e);
    }
}

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

// R25+R27: auto-refresh atlas preview every 5s, type-aware (Base/Overlay/Diff)
let currentMapKind = 'atlas';   // active tab
let lastMapsData = null;         // cache for tab switching
async function refreshMap() {
    try {
        const r = await fetch('/maps');
        const j = await r.json();
        lastMapsData = j;
        const sel = document.getElementById('mapSelect');
        const img = document.getElementById('mapImg');
        const meta = document.getElementById('mapMeta');
        // Update counts on tab buttons
        const c = j.counts || {};
        document.getElementById('cntAtlas').textContent   = c.atlas   || 0;
        document.getElementById('cntOverlay').textContent = c.overlay || 0;
        document.getElementById('cntDiff').textContent    = c.diff    || 0;
        // Render current kind's list
        renderMapKind(currentMapKind);
    } catch (e) {
        document.getElementById('mapMeta').textContent = 'err: ' + e;
    }
}
function renderMapKind(kind) {
    if (!lastMapsData) return;
    const sel = document.getElementById('mapSelect');
    const img = document.getElementById('mapImg');
    const meta = document.getElementById('mapMeta');
    document.getElementById('tabLabel').textContent = kind;
    const items = lastMapsData[kind] || [];
    if (items.length === 0) {
        sel.innerHTML = '<option>(empty)</option>';
        meta.textContent = '(no ' + kind + ' PNGs yet — see card #' + (kind === 'atlas' ? '13' : kind === 'overlay' ? '14' : '15') + ')';
        img.src = '/map';   // fallback
        img.style.opacity = 0.2;
        return;
    }
    sel.innerHTML = '';
    for (const m of items) {
        const opt = document.createElement('option');
        opt.value = m.name + '?t=' + Math.floor(m.mtime * 1000);
        opt.textContent = m.name + '  (' + (m.w || '?') + 'x' + (m.h || '?') + ', ' + Math.round(m.size / 1024) + ' KB)';
        if (m.url === img.getAttribute('data-current')) opt.selected = true;
        sel.appendChild(opt);
    }
    const latest = items[0];
    const newSrc = latest.url + '?t=' + Math.floor(latest.mtime * 1000);
    if (img.src.indexOf(latest.url) < 0) {
        img.src = newSrc;
        img.setAttribute('data-current', latest.url);
    }
    img.style.opacity = 1;
    const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(latest.mtime));
    meta.textContent = latest.name + '\n' +
        (latest.w || '?') + ' × ' + (latest.h || '?') + '  (' + (latest.label || kind) + ')\n' +
        Math.round(latest.size / 1024) + ' KB\n' +
        ageSec + 's ago\n' +
        (lastMapsData.counts ? lastMapsData.counts[kind] : items.length) + ' ' + kind + ' PNG(s)';
}
function switchMapTab(kind) {
    currentMapKind = kind;
    document.querySelectorAll('.map-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-kind') === kind);
    });
    renderMapKind(kind);
}
function onMapSelectChange(value) {
    const name = value.split('?')[0];
    const kind = currentMapKind;
    document.getElementById('mapImg').src = '/' + kind + '/' + name;
    document.getElementById('mapImg').setAttribute('data-current', '/' + kind + '/' + name);
}
refreshMap();
setInterval(refreshMap, 5000);

// R29: user TODO persistence (localStorage, debounced 500ms)
const TODO_KEY = 'aor_panel_user_todo';
let todoSaveTimer = null;
function loadTodo() {
    try {
        const t = localStorage.getItem(TODO_KEY) || '';
        document.getElementById('userTodo').value = t;
        updateTodoStatus();
    } catch (e) { /* localStorage may be blocked */ }
}
function saveTodo() {
    try {
        const t = document.getElementById('userTodo').value;
        localStorage.setItem(TODO_KEY, t);
        updateTodoStatus();
    } catch (e) {
        const el = document.getElementById('todoStatus');
        if (e && e.name === 'QuotaExceededError') {
            el.textContent = '⚠️ quota exceeded (>5MB) — текст не сохранён';
        } else {
            el.textContent = '⚠️ localStorage недоступен';
        }
        el.className = 'todo-meta todo-status-empty';
    }
}
function clearTodo() {
    if (!confirm('Очистить текущую задачу?')) return;
    document.getElementById('userTodo').value = '';
    saveTodo();
}
// Cross-tab sync: если TODO изменился в другой вкладке — подхватим
window.addEventListener('storage', function(e) {
    if (e.key === TODO_KEY) loadTodo();
});
function updateTodoStatus() {
    const t = document.getElementById('userTodo').value;
    const el = document.getElementById('todoStatus');
    if (t.trim().length > 0) {
        el.textContent = '✓ сохранено (' + t.length + ' chars, last edit ' + new Date().toLocaleTimeString() + ')';
        el.className = 'todo-status-saved';
    } else {
        el.textContent = '(пусто — начни вводить)';
        el.className = 'todo-status-empty';
    }
}
const todoEl = document.getElementById('userTodo');
if (todoEl) {
    todoEl.addEventListener('input', () => {
        clearTimeout(todoSaveTimer);
        todoSaveTimer = setTimeout(saveTodo, 500);
    });
    loadTodo();
}
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
    cards = _load_cards()
    total = len(glob.glob(os.path.join(SCRIPTS_CARDS_DIR, "*.json")))
    return render_template_string(
        HTML,
        SCRIPTS=cards,
        JOBS=JOBS,
        total_in_folder=total,
    )


@app.route("/reload-cards", methods=["POST"])
def reload_cards():
    global SCRIPTS, TOTAL_CARDS
    SCRIPTS = _load_cards()
    TOTAL_CARDS = len(glob.glob(os.path.join(SCRIPTS_CARDS_DIR, "*.json")))
    return jsonify({"ok": True, "active": len(SCRIPTS), "total": TOTAL_CARDS})


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
    cards = _load_cards()
    if key not in cards:
        return jsonify({"error": f"unknown script: {key}"}), 400
    card = cards[key]
    pid = get_albion_pid()
    if not pid:
        return jsonify({"error": "Albion-Online not running"}), 503
    if not os.path.exists(card["script"]):
        return jsonify({"error": f"script file missing: {card['script']}"}), 500

    job_id = datetime.now().strftime("%Y%m%d_%H%M%S_") + key
    log_file = os.path.join(LOG_DIR, job_id + ".log")

    # R24: detect script type by extension. .js → frida hook (стандартный путь),
    # .sh → bash-driver (например tools/zoom_hack.sh — запускает frida+wmctrl+xdotool
    # сам). Для .sh передаём ALBION_PID env, чтобы скрипт знал к какому PID цепляться.
    script_path = card["script"]
    if script_path.endswith(".sh"):
        cmd = ["sudo", "-S", "/bin/bash", script_path]
    elif script_path.endswith(".js"):
        cmd = [
            "sudo", "-S",
            "frida", "-p", str(pid), "--runtime=v8",
            "-l", "/usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js",
            "-l", "/mnt/hgfs/D/AOR_core/Frida/lib_offsets_discovery.js",
            "-l", script_path,
        ]
    else:
        # Generic fallback: try shebang via execve.
        cmd = ["sudo", "-S", script_path]

    # R24: для .sh скриптов пробрасываем ALBION_PID через env (zoom_hack.sh это читает).
    env = os.environ.copy()
    env["ALBION_PID"] = str(pid)


    with open(log_file, "wb") as f:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=f,
            stderr=subprocess.STDOUT,
            bufsize=0,
            cwd="/mnt/hgfs/D/AOR_core",
            env=env,
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


# ─── R25+R27: Atlas map preview routes ─────────────────────
# Serves the PNG dumps produced by tools/parse_map_atlas.py (which
# consumes /tmp/aor_map_Color32_*.bin from #12 auto_zoom_capture),
# tools/overlay_entities.py (R26 #14 → _overlay.png), and
# tools/diff_atlases.py (R26 #15 → _diff.png).
#
# Routes:
#   /maps            → JSON: {atlas:[...], overlay:[...], diff:[...], counts:{...}}
#   /map             → redirect to latest ATLAS png
#   /map/<name>      → specific atlas png
#   /overlay         → redirect to latest OVERLAY png
#   /overlay/<name>  → specific overlay png
#   /diff            → redirect to latest DIFF png
#   /diff/<name>     → specific diff png
#
# R27 changes: refactored list_maps() to return categorized dict.
# /map, /overlay, /diff all share the same serve_png helper.

import glob as _glob

MAP_DIR = "/tmp"

def _classify_png(name: str) -> str:
    """aor_map_*_overlay.png → 'overlay', aor_map_*_diff.png → 'diff', else 'atlas'."""
    if not name.startswith("aor_map_") or not name.endswith(".png"):
        return "skip"
    if name.endswith("_overlay.png"):
        return "overlay"
    if name.endswith("_diff.png"):
        return "diff"
    return "atlas"


def _build_map_item(path: str) -> dict:
    """Build a single item dict with kind/url/mtime/size/sidecar metadata."""
    name = os.path.basename(path)
    kind = _classify_png(name)
    if kind == "skip":
        return None
    try:
        st = os.stat(path)
    except OSError:
        return None
    meta_path = path + ".json"
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
        except (OSError, ValueError):
            pass
    return {
        "name":  name,
        "kind":  kind,
        "url":   f"/{kind}/" + name,
        "size":  st.st_size,
        "mtime": st.st_mtime,
        "w":     meta.get("w"),
        "h":     meta.get("h"),
        "label": meta.get("label"),
    }


@app.route("/maps")
def list_maps():
    out = {"atlas": [], "overlay": [], "diff": []}
    for path in _glob.glob(os.path.join(MAP_DIR, "aor_map_*.png")):
        item = _build_map_item(path)
        if item is not None:
            out[item["kind"]].append(item)
    for k in out:
        out[k].sort(key=lambda x: x["mtime"], reverse=True)
    return jsonify({
        "atlas":  out["atlas"],
        "overlay":out["overlay"],
        "diff":   out["diff"],
        "counts": {k: len(out[k]) for k in out},
    })


def _latest_for(kind: str):
    """Helper: redirect to latest PNG of given kind (atlas/overlay/diff)."""
    items = list_maps().get_json()[kind]
    if not items:
        return ("", 404)
    return redirect("/" + kind + "/" + items[0]["name"])


def _serve_png(kind: str, name: str):
    """Helper: serve specific PNG with path-traversal guard.
    `kind` must be one of atlas/overlay/diff; this affects which suffix is required.
    """
    base = os.path.basename(name)
    if name in (".", "..") or base != name or not base.startswith("aor_map_") or not base.endswith(".png"):
        return ("bad name", 400)
    if _classify_png(base) != kind:
        return (f"kind mismatch: {base} is not a {kind} png", 400)
    path = os.path.join(MAP_DIR, base)
    if not os.path.isfile(path):
        return ("not found", 404)
    return send_file(path, mimetype="image/png", max_age=0)


@app.route("/map")
def latest_map():
    return _latest_for("atlas")


@app.route("/map/<path:name>")
def serve_map(name):
    return _serve_png("atlas", name)


@app.route("/overlay")
def latest_overlay():
    return _latest_for("overlay")


@app.route("/overlay/<path:name>")
def serve_overlay(name):
    return _serve_png("overlay", name)


@app.route("/diff")
def latest_diff():
    return _latest_for("diff")


@app.route("/diff/<path:name>")
def serve_diff(name):
    return _serve_png("diff", name)


# ─── R28: /entities endpoint ──────────────────────────────────
# Serves the latest entity dump from /tmp/aor_entities.json
# (produced by tools/entity_dumper.sh one-shot OR --daemon mode).
# Used by overlay card #14 + radar_server (R22) + any future live tooling.

ENTITIES_PATH = "/tmp/aor_entities.json"

@app.route("/entities")
def get_entities():
    if not os.path.isfile(ENTITIES_PATH):
        return jsonify({"error": "no /tmp/aor_entities.json", "hint": "run card #17 (one-shot) or #18 (daemon)"}), 404
    try:
        with open(ENTITIES_PATH, "r") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return jsonify({"error": f"failed to read: {e}"}), 500
    if isinstance(data, list):
        entities = data
    elif isinstance(data, dict) and "entities" in data:
        entities = data["entities"]
    else:
        return jsonify({"error": "unexpected format (need list or {entities: [...]})"}), 500
    # Strip non-essential fields to keep response small for polling
    compact = []
    for e in entities:
        if not isinstance(e, dict):
            continue
        compact.append({
            "Id":       e.get("Id", 0),
            "X":        e.get("X", 0.0),
            "Y":        e.get("Y", 0.0),
            "Z":        e.get("Z", 0.0),
            "IsPlayer": bool(e.get("IsPlayer", False)),
            "IsEnemy":  bool(e.get("IsEnemy",  False)),
            "IsNpc":    bool(e.get("IsNpc",    False)),
            "Type":     e.get("Type", ""),
        })
    st = os.stat(ENTITIES_PATH)
    return jsonify({
        "count": len(compact),
        "mtime": st.st_mtime,
        "age_sec": int(max(0, time.time() - st.st_mtime)),
        "entities": compact,
    })


if __name__ == "__main__":
    print("[*] AOR Panel listening on http://0.0.0.0:7777")
    print("[*] Open in browser: http://localhost:7777")
    # use_reloader=False: Flask watch & restart on file changes — next правка файла не требует kill -9 + relaunch
    app.run(host="0.0.0.0", port=7777, debug=False, use_reloader=False)
