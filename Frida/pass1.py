import os
import struct
import json

PID = 10994
PROC_MEM = "/proc/aor_mem"
F1_MIN, F1_MAX = 176.0, 186.0
F2_MIN, F2_MAX = 72.0, 82.0

def read_mem(addr, size):
    with open(PROC_MEM, 'w') as f:
        f.write(f"{PID} 0x{addr:x} {size}")
    with open(PROC_MEM, 'rb') as f:
        return f.read(size)

def get_regions():
    regions = []
    with open(f"/proc/{PID}/maps", 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 2: continue
            prot = parts[1]
            if 'r' not in prot or 'w' not in prot:
                continue
            addrs = parts[0].split('-')
            start = int(addrs[0], 16)
            end = int(addrs[1], 16)
            size = end - start
            if size > 512 * 1024 * 1024:
                continue
            regions.append((start, size))
    return regions

regions = get_regions()
print(f"[PASS1] Регионов: {len(regions)}")

results = {}
for i, (start, size) in enumerate(regions):
    if i % 20 == 0:
        print(f"  [{i}/{len(regions)}]...", flush=True)

    CHUNK = 1024 * 1024
    for off in range(0, size - 12, CHUNK):
        chunk_size = min(CHUNK + 12, size - off)
        try:
            data = read_mem(start + off, chunk_size)
            for j in range(0, len(data) - 12, 8):
                f1 = struct.unpack('<f', data[j:j+4])[0]
                f2 = struct.unpack('<f', data[j+4:j+8])[0]
                f3 = struct.unpack('<f', data[j+8:j+12])[0]
                if F1_MIN <= f1 <= F1_MAX and F2_MIN <= f2 <= F2_MAX:
                    addr = start + off + j
                    results[addr] = (f1, f2, f3)
        except:
            pass

print(f"  [{len(regions)}/{len(regions)}]...")
print(f"[PASS1] Найдено: {len(results)}")

with open("/tmp/aor_pass1.json", "w") as f:
    json.dump({hex(k): list(v) for k, v in results.items()}, f)
print("[PASS1] Сохранено в /tmp/aor_pass1.json")
