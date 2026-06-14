# find_pos.py
# Использует /proc/aor_mem для поиска координат игрока
# Делает снимок float'ов, ждёт когда игрок двинется, сравнивает

import struct, sys, os, time

PID = 18416
MEM_PATH = "/proc/aor_mem"

def read_mem(addr, size):
    with open(MEM_PATH, "w") as f:
        f.write(f"{PID} {hex(addr)} {size}")
    with open(MEM_PATH, "rb") as f:
        raw = f.read(size)
    return raw

def read_float(addr):
    data = read_mem(addr, 4)
    if len(data) < 4: return None
    return struct.unpack('<f', data)[0]

# Получаем карту памяти GameAssembly.so
import subprocess
maps_raw = subprocess.check_output(["cat", "/proc/" + str(PID) + "/maps"]).decode()

# Ищем все RW регионы GameAssembly.so (data/bss/heap)
regions = []
for line in maps_raw.split('\n'):
    parts = line.split()
    if len(parts) < 5: continue
    if "rw" in parts[1]:
        addrs = parts[0].split('-')
        start = int(addrs[0], 16)
        end = int(addrs[1], 16)
        name = parts[-1] if len(parts) > 5 else ""
        regions.append((start, end, name))

print(f"Found {len(regions)} RW regions")
for s, e, n in regions:
    print(f"  {hex(s)}-{hex(e)} {n}")

# Функция: собрать все float тройки из региона
def sample(region_start, region_end, step=16):
    hits = []
    for off in range(0, region_end - region_start - 12, step):
        addr = region_start + off
        x = read_float(addr)
        y = read_float(addr + 4)
        z = read_float(addr + 8)
        if x is None: continue
        if (not (x != x or y != y or z != z) and  # not NaN
            abs(x) < 100000 and abs(z) < 100000 and
            abs(y) < 50 and
            x > 0 and z > 0):
            hits.append((addr, x, y, z))
    return hits

# Собираем снимок
print("\n[+] Taking initial sample... (this may take a moment)")
all_hits = []
for s, e, n in regions:
    print(f"  Scanning {hex(s)}-{hex(e)}...", end=" ", flush=True)
    h = sample(s, e)
    print(f"{len(h)} candidates")
    all_hits.extend(h)

print(f"\n[*] Total candidates: {len(all_hits)}")
print("[*] Now move ~10 units in one direction, then press Enter")
input()

# Второй снимок
print("[+] Taking second sample...")
all_hits2 = []
for s, e, n in regions:
    h = sample(s, e)
    all_hits2.extend(h)

# Сравниваем: ищем что изменилось на 5-15 юнитов (одна ось)
changes = []
for addr, x1, y1, z1 in all_hits:
    for addr2, x2, y2, z2 in all_hits2:
        if addr != addr2: continue
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        dz = abs(z2 - z1)
        # Одна ось изменилась на 5-20, остальные почти нет
        if (dx > 5 and dx < 20 and dy < 2 and dz < 2) or \
           (dz > 5 and dz < 20 and dx < 2 and dy < 2):
            changes.append((addr, x1, y1, z1, x2, y2, z2, dx, dy, dz))
            if len(changes) <= 10:
                print(f"  {hex(addr)}: ({x1:.2f},{y1:.2f},{z1:.2f}) -> ({x2:.2f},{y2:.2f},{z2:.2f}) [dx={dx:.2f} dy={dy:.2f} dz={dz:.2f}]")

if len(changes) > 10:
    print(f"  ... and {len(changes)-10} more")
elif len(changes) == 0:
    print("[!] No matches. Try moving more or less.")
    print("    First scan candidates:", len(all_hits))
    # Покажем несколько примеров
    for addr, x, y, z in all_hits[:5]:
        print(f"    {hex(addr)}: ({x:.2f}, {y:.2f}, {z:.2f})")
