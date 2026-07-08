import frida
import json
import time

PID = 10994

script_code = """
'use strict';

const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: false});
send({type: 'count', data: ranges.length});

const big = ranges.filter(r => r.size > 8 * 1024 * 1024);
send({type: 'big', data: big.length});

for (let i = 0; i < big.length; i++) {
    send({type: 'biginfo', data: i + ' base=0x' + big[i].base.toString(16) + ' size=' + (big[i].size/1024/1024).toFixed(2) + 'MB'});
}
"""

def on_message(msg, data):
    if msg['type'] == 'send':
        print(f"  {msg['payload']['type']}: {msg['payload']['data']}")

print("[*] Attaching...")
session = frida.attach(PID)
script = session.create_script(script_code)
script.on('message', on_message)
script.load()
time.sleep(1)
script.unload()
session.detach()
print("[*] Done")
