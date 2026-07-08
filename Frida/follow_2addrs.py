import frida, time, sys

PID = 2471
ADDRS = [0x7b53e42cfe28, 0x7b53e42d0308]

def on_msg(msg, data):
    if msg['type'] == 'send':
        print(msg['payload'], end='', flush=True)
    elif msg['type'] == 'error':
        print(f"[ERR] {msg['description']}", flush=True)

js_code = f'''
const addrs = {str(ADDRS)}.map(a => ptr(a));
setInterval(() => {{
    let out = "";
    for (const a of addrs) {{
        try {{
            const buf = a.readByteArray(12);
            const arr = new Float32Array(buf);
            out += "0x" + a.toString() + " -> " + arr[0].toFixed(3) + ", " + arr[1].toFixed(3) + ", " + arr[2].toFixed(3) + "\\n";
        }} catch(e) {{ out += "0x" + a.toString() + " -> ERROR\\n"; }}
    }}
    send(out + "\\n");
}}, 150);
'''

session = frida.attach(PID)
script = session.create_script(js_code)
script.on('message', on_msg)
script.load()
print("[*] Слежение через Frida. Двигай героем. Ctrl+C для выхода.\n")
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\n[*] Стоп.")
session.detach()
