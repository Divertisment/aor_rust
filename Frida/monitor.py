import os, struct, time

PID = 10994
PROC_MEM = "/proc/aor_mem"

addrs = [
    0x7992D2C76A60, 0x7992D2C76A78, 0x7992D2C77690, 0x7992D2C7ABE8,
    0x7992D2C83298, 0x7992D2EF9F38, 0x7992D2F1F048, 0x7992D2F72628,
    0x7992D2F7BA58, 0x7992E1CA7050, 0x7992E1D870E0, 0x7992E7B64400,
    0x7992E7DB9A50, 0x7992E7DCF630, 0x7992ED103380, 0x7992ED103BA0,
    0x799323F0B800, 0x79932A3954B0, 0x79933C7980D0, 0x79941BC29030
]

def read_mem(addr, size):
    with open(PROC_MEM, 'w') as f:
        f.write(f"{PID} 0x{addr:x} {size}")
    with open(PROC_MEM, 'rb') as f:
        return f.read(size)

# filter: only dynamic entities (bad if x=0 or x>10000 or static)
bad = set()
STOP_FILE = "/tmp/aor_stop_monitor"
if os.path.exists(STOP_FILE):
    os.remove(STOP_FILE)

def get_entities():
    """return list of (x,y,z,addr) for valid moving entities"""
    seen_xy = {}
    for addr in addrs:
        try:
            raw = read_mem(addr, 12)
            x = struct.unpack('<f', raw[0:4])[0]
            y = struct.unpack('<f', raw[4:8])[0]
            z = struct.unpack('<f', raw[8:12])[0]
            if abs(x) < 1 or abs(x) > 10000: continue
            if abs(y) < 1 or abs(y) > 10000: continue
            if x == 180.321 and y == 75.997: continue  # static stale data
            key = (round(x, 2), round(y, 2))
            if key not in seen_xy:
                seen_xy[key] = (x, y, z, addr)
        except:
            pass
    return list(seen_xy.values())

print("Монитор объектов (уникальные, по Y). touch /tmp/aor_stop_monitor для выхода.\n")

prev_y = {}
while not os.path.exists(STOP_FILE):
    entities = get_entities()
    entities.sort(key=lambda e: e[1])  # sort by Y

    cur_y = {e[3]: e[1] for e in entities}
    if cur_y != prev_y:
        os.system('clear')
        print(f"{'#':2} {'X':9} {'Y':9} {'Z':9}")
        print("-" * 33)
        for i, (x, y, z, addr) in enumerate(entities, 1):
            print(f"{i:2}  {x:9.3f} {y:9.3f} {z:9.3f}")
        prev_y = cur_y

    time.sleep(0.5)

print("\nСтоп.")
