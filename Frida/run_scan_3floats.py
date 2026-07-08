import frida, threading, sys

PID = 2471

done = threading.Event()
all_matches = []

def on_msg(msg, data):
    global all_matches
    if msg['type'] == 'send':
        p = msg['payload']
        t = p.get('type')
        if t == 'batch':
            all_matches.extend(p['matches'])
        elif t == 'prog':
            print(f"  {p['done']}/{p['total']}", end='\r')
        elif t == 'done':
            print(f"\n\nСовпадений: {p['count']}")
            print("--- первые 200 ---")
            for m in all_matches[:200]:
                print(f"  0x{m[0]}  f1={m[1]}  f2={m[2]}  f3={m[3]}")
            if len(all_matches) > 200:
                print(f"  ... и ещё {len(all_matches)-200}")
            done.set()
    elif msg['type'] == 'error':
        print(f"\n[ERR] {msg['description']}")

with open('/home/stas/AOR_core/Frida/scan_3floats_internal.js') as f:
    code = f.read()

s = frida.attach(PID)
sc = s.create_script(code)
sc.on('message', on_msg)
sc.load()
print(f"Attached to PID {PID}, scanning...")
done.wait()
s.detach()
