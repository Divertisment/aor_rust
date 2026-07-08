import frida
import sys
import struct
import json
import os
import time

PID = 7844
SIGNAL_FILE = "/tmp/aor_frida_go2"

F1_MIN, F1_MAX = 176.0, 186.0
F2_MIN, F2_MAX = 72.0, 82.0

scan_js = """
'use strict';

const F1_MIN = 176.0, F1_MAX = 186.0;
const F2_MIN = 72.0, F2_MAX = 82.0;

function scan() {
    const results = {};
    const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: true});

    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const size = r.size;
        if (size > 8 * 1024 * 1024) continue;

        try {
            const buf = r.base.readByteArray(size);
            if (!buf) continue;
            const dv = new DataView(buf);

            for (let off = 0; off <= size - 12; off += 8) {
                const f1 = dv.getFloat32(off, true);
                const f2 = dv.getFloat32(off + 4, true);
                const f3 = dv.getFloat32(off + 8, true);
                if (f1 >= F1_MIN && f1 <= F1_MAX && f2 >= F2_MIN && f2 <= F2_MAX) {
                    const addr = r.base.add(off);
                    results[addr.toString()] = [f1, f2, f3];
                }
            }
        } catch (e) {}
    }
    return results;
}

const pass1 = scan();
send({type: 'pass1', data: JSON.stringify(pass1)});
"""

scan2_js = """
'use strict';

const F1_MIN = 176.0, F1_MAX = 186.0;
const F2_MIN = 72.0, F2_MAX = 82.0;

function scan() {
    const results = {};
    const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: true});

    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const size = r.size;
        if (size > 8 * 1024 * 1024) continue;

        try {
            const buf = r.base.readByteArray(size);
            if (!buf) continue;
            const dv = new DataView(buf);

            for (let off = 0; off <= size - 12; off += 8) {
                const f1 = dv.getFloat32(off, true);
                const f2 = dv.getFloat32(off + 4, true);
                const f3 = dv.getFloat32(off + 8, true);
                if (f1 >= F1_MIN && f1 <= F1_MAX && f2 >= F2_MIN && f2 <= F2_MAX) {
                    const addr = r.base.add(off);
                    results[addr.toString()] = [f1, f2, f3];
                }
            }
        } catch (e) {}
    }
    return results;
}

const pass2 = scan();
send({type: 'pass2', data: JSON.stringify(pass2)});
"""

# ---- PASS 1 ----
print("[*] Attaching for pass1...")
session = frida.attach(PID)
script = session.create_script(scan_js)
pass1_data = {}
def on_msg1(msg, data):
    if msg['type'] == 'send' and msg['payload']['type'] == 'pass1':
        nonlocal pass1_data
        pass1_data = json.loads(msg['payload']['data'])
        print(f"[PASS 1] Найдено: {len(pass1_data)}")
script.on('message', on_msg1)
script.load()
time.sleep(2)  # wait for scan to complete
script.unload()
session.detach()

# save
with open('/tmp/aor_frida_pass1.json', 'w') as f:
    json.dump(pass1_data, f)
print(f"[PASS 1] Сохранено в /tmp/aor_frida_pass1.json")

# ---- WAIT ----
print("\n[WAIT] Пройдите по прямой, затем запустите:")
print("  touch /tmp/aor_frida_go2")
print("ждём...")
if os.path.exists(SIGNAL_FILE):
    os.remove(SIGNAL_FILE)
while not os.path.exists(SIGNAL_FILE):
    time.sleep(1)
os.remove(SIGNAL_FILE)

# ---- PASS 2 ----
print("\n[PASS 2] Сканирую...")
session = frida.attach(PID)
script = session.create_script(scan2_js)
pass2_data = {}
def on_msg2(msg, data):
    if msg['type'] == 'send' and msg['payload']['type'] == 'pass2':
        nonlocal pass2_data
        pass2_data = json.loads(msg['payload']['data'])
script.on('message', on_msg2)
script.load()
time.sleep(2)
script.unload()
session.detach()

print(f"[PASS 2] Найдено: {len(pass2_data)}")

# ---- COMPARE ----
print("\n=== ИЗМЕНИВШИЕСЯ АДРЕСА ===")
changed = 0
for addr, v1 in pass1_data.items():
    if addr in pass2_data:
        v2 = pass2_data[addr]
        if v1[0] != v2[0] or v1[1] != v2[1] or v1[2] != v2[2]:
            changed += 1
            print(f"  {addr}: ({v1[0]:.3f}, {v1[1]:.3f}, {v1[2]:.3f}) -> ({v2[0]:.3f}, {v2[1]:.3f}, {v2[2]:.3f})")

if changed == 0:
    print("  Нет изменений")
print(f"\n[+] Изменилось: {changed}")
