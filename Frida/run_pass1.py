import frida
import json
import sys

PID = 10994

script_code = """
'use strict';

const F1_MIN = 176.0, F1_MAX = 186.0;
const F2_MIN = 72.0, F2_MAX = 82.0;

function scan() {
    const results = {};
    const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: true});
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const size = r.size;
        if (size > 512 * 1024 * 1024) continue;
        try {
            const buf = r.base.readByteArray(size);
            if (!buf) continue;
            const dv = new DataView(buf);
            for (let off = 0; off <= size - 12; off += 8) {
                const f1 = dv.getFloat32(off, true);
                const f2 = dv.getFloat32(off + 4, true);
                const f3 = dv.getFloat32(off + 8, true);
                if (f1 >= F1_MIN && f1 <= F1_MAX && f2 >= F2_MIN && f2 <= F2_MAX) {
                    results[r.base.add(off).toString()] = [f1, f2, f3];
                }
            }
        } catch (e) {}
    }
    return results;
}

const r = scan();
send({type: 'result', data: JSON.stringify(r)});
"""

results = {}
def on_message(msg, data):
    global results
    if msg['type'] == 'send' and msg['payload']['type'] == 'result':
        results = json.loads(msg['payload']['data'])

print("[*] Attaching...")
session = frida.attach(PID)
script = session.create_script(script_code)
script.on('message', on_message)
print("[*] Scanning...")
script.load()
import time
time.sleep(0.5)  # wait for scan to complete
script.unload()
session.detach()

print(f"[+] Found: {len(results)}")
with open('/tmp/aor_pass1.json', 'w') as f:
    json.dump(results, f)
print("[+] Saved to /tmp/aor_pass1.json")
