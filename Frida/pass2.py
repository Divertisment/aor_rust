import os
import struct
import json

PID = 10994
PROC_MEM = "/proc/aor_mem"

def read_mem(addr, size):
    with open(PROC_MEM, 'w') as f:
        f.write(f"{PID} 0x{addr:x} {size}")
    with open(PROC_MEM, 'rb') as f:
        return f.read(size)

with open("/tmp/aor_pass1.json", "r") as f:
    data = json.load(f)

print(f"[PASS2] Загружено адресов: {len(data)}")

changed = []
for addr_str, (f1_old, f2_old, f3_old) in data.items():
    addr = int(addr_str, 16)
    try:
        raw = read_mem(addr, 12)
        f1 = struct.unpack('<f', raw[0:4])[0]
        f2 = struct.unpack('<f', raw[4:8])[0]
        f3 = struct.unpack('<f', raw[8:12])[0]
        if round(f1, 6) != round(f1_old, 6) or round(f2, 6) != round(f2_old, 6) or round(f3, 6) != round(f3_old, 6):
            changed.append((addr, f1_old, f2_old, f3_old, f1, f2, f3))
    except:
        pass

print(f"\n=== ИЗМЕНИВШИЕСЯ АДРЕСА ({len(changed)}) ===")
for addr, f1o, f2o, f3o, f1n, f2n, f3n in changed:
    dy = f2n - f2o
    print(f"  0x{addr:X}: ({f1o:.3f}, {f2o:.3f}, {f3o:.3f}) -> ({f1n:.3f}, {f2n:.3f}, {f3n:.3f})  dY={dy:+.3f}")

if not changed:
    print("  Нет изменений")
