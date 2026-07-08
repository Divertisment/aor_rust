import os, struct, time, socket, json, sys

PID = 10994
PROC_MEM = "/proc/aor_mem"
HOST, PORT = "127.0.0.1", 4448

# All 7 addresses with labels
entities = [
    (0x7992E1CA7050, 100, "E100"),
    (0x7992E7DCF630, 101, "E101"),
    (0x7992ED103380, 102, "E102"),
    (0x799323F0B800, 103, "E103"),
    (0x79932A3954B0, 104, "E104"),
    (0x79933C7980D0, 105, "E105"),
    (0x79941BC29030, 106, "E106"),
]

def read_mem(addr, size):
    with open(PROC_MEM, 'w') as f:
        f.write(f"{PID} 0x{addr:x} {size}")
    with open(PROC_MEM, 'rb') as f:
        return f.read(size)

prev = {a: None for a, _, _ in entities}

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(5)
try:
    sock.connect((HOST, PORT))
except Exception as e:
    print(f"[-] Connect error: {e}", flush=True)
    sys.exit(1)
print("[*] Connected", flush=True)

try:
    while True:
        for ent_addr, eid, ename in entities:
            try:
                raw = read_mem(ent_addr, 12)
                ex, ey, ez = struct.unpack('<fff', raw)
                ok = 1 < abs(ex) < 10000 and 1 < abs(ey) < 10000
                if ok:
                    prev[ent_addr] = (ex, ey)
                if prev[ent_addr]:
                    ex, ey = prev[ent_addr]
                    if ename == "E100":
                        msg = json.dumps({"t":"p","id":eid,"n":ename,"x":ex,"y":ey,"h":0,"m":0}) + "\n"
                    else:
                        msg = json.dumps({"t":"e","id":eid,"n":ename,"x":ex,"y":ey,"h":100,"m":100,"a":0}) + "\n"
                    sock.sendall(msg.encode())
            except:
                pass

        sock.sendall(b'{"t":"h"}\n')
        time.sleep(0.5)
except KeyboardInterrupt:
    sock.close()
    print("\n[*] Stopped")
