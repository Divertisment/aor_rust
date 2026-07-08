import frida
import sys
import struct
import json

PID = 7844
F1_MIN, F1_MAX = 176.0, 186.0
F2_MIN, F2_MAX = 72.0, 82.0

scan_js = """
'use strict';

const F1_MIN = 176.0, F1_MAX = 186.0;
const F2_MIN = 72.0, F2_MAX = 82.0;

function scan() {
    const results = {};
    const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: true});
    let total = ranges.length;

    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const size = r.size;
        if (size > 8 * 1024 * 1024) continue; // skip >8MB

        try {
            const buf = r.base.readByteArray(size);
            if (!buf) continue;
            const arr = new Uint8Array(buf);
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
        } catch (e) {
            // skip unreadable
        }
    }
    return results;
}

const pass1 = scan();
send({type: 'pass1', count: Object.keys(pass1).length, data: JSON.stringify(pass1)});

// wait for "go" for pass2
recv('go', function() {
    const pass2 = scan();
    const changed = [];
    for (const [addr, v1] of Object.entries(pass1)) {
        if (pass2[addr]) {
            const v2 = pass2[addr];
            if (v1[0] !== v2[0] || v1[1] !== v2[1] || v1[2] !== v2[2]) {
                changed.push({addr: addr, from: v1, to: v2});
            }
        }
    }
    send({type: 'pass2', total1: Object.keys(pass1).length, total2: Object.keys(pass2).length, changed: changed});
    recv('exit', function() { send({type: 'done'}); });
});
"""

def on_message(msg, data):
    if msg['type'] == 'send':
        payload = msg['payload']
        if payload['type'] == 'pass1':
            print(f"[PASS 1] Найдено: {payload['count']}")
            with open('/tmp/aor_frida_pass1.json', 'w') as f:
                f.write(payload['data'])
        elif payload['type'] == 'pass2':
            print(f"[PASS 2] Pass1: {payload['total1']}, Pass2: {payload['total2']}")
            print(f"\n=== ИЗМЕНИВШИЕСЯ АДРЕСА ===")
            for c in payload['changed']:
                print(f"  {c['addr']}: ({c['from'][0]:.3f}, {c['from'][1]:.3f}, {c['from'][2]:.3f}) -> ({c['to'][0]:.3f}, {c['to'][1]:.3f}, {c['to'][2]:.3f})")
            if len(payload['changed']) == 0:
                print("  Нет изменений")
            print(f"\n[+] Изменилось: {len(payload['changed'])}")
        elif payload['type'] == 'done':
            print("\nГотово. Жмите Enter для выхода.")
    elif msg['type'] == 'error':
        print(f"[-] Frida error: {msg}")

session = frida.attach(PID)
print(f"[*] Attached to PID {PID}")

script = session.create_script(scan_js)
script.on('message', on_message)
script.load()

input("\n[PASS 1] Стоим -> Enter")
script.post({'type': 'go'})

input("\n[PASS 2] Идём по прямой -> Enter")
script.post({'type': 'exit'})

input()
session.detach()
