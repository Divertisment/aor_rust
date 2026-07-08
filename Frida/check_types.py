import frida
import json
import time

PID = 10994

script_code = """
'use strict';

const ranges = Process.enumerateRanges({protection: 'rw-', coalesce: false});
let by_type = {};
for (let i = 0; i < ranges.length; i++) {
    const t = ranges[i].type || 'unknown';
    if (!by_type[t]) by_type[t] = 0;
    by_type[t]++;
}
send({type: 'types', data: JSON.stringify(by_type)});
"""

def on_message(msg, data):
    if msg['type'] == 'send':
        print(msg['payload']['data'])

session = frida.attach(PID)
script = session.create_script(script_code)
script.on('message', on_message)
script.load()
time.sleep(1)
script.unload()
session.detach()
