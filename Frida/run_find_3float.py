import frida, threading, sys

PID = 2471

done = threading.Event()
all_matches = []

def on_msg(msg, data):
    global all_matches
    if msg['type'] == 'send':
        p = msg['payload']
        t = p.get('type')
        if t == 'start':
            print(f"[*] Регионов для сканирования: {p['ranges']}")
        elif t == 'batch':
            all_matches.extend(p['m'])
        elif t == 'prog':
            print(f"  [{p['done']}/{p['total']}] найдено: {p['found']}", end='\r')
        elif t == 'done':
            print(f"\n\n[+] Сканирование завершено. Проверено регионов: {p['scanned']}")
            print(f"[+] Всего совпадений: {p['count']}")
            if all_matches:
                print("[*] Словарь (адрес -> f1, f2, f3):")
                for m in all_matches:
                    print(f"  0x{m[0]} -> {m[1]}, {m[2]}, {m[3]}")
            else:
                print("[-] Совпадений не найдено.")
            done.set()
    elif msg['type'] == 'error':
        print(f"\n[ERR] {msg['description']}")

with open('/home/stas/AOR_core/Frida/scan_find_3float.js') as f:
    code = f.read()

s = frida.attach(PID)
sc = s.create_script(code)
sc.on('message', on_msg)
sc.load()
print(f"[*] Прикреплён к PID {PID}")
done.wait()
s.detach()
