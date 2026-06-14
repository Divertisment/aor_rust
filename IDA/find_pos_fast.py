# find_pos_fast.py
# Быстрый поиск координат через /proc/aor_mem (читает блоками по 4KB)
import struct, sys, os, time

PID = 18416
MEM_PATH = "/proc/aor_mem"
CHUNK = 4096  # читаем по 4KB

def read_mem(addr, size):
    with open(MEM_PATH, "w") as f:
        f.write(f"{PID} {hex(addr)} {size}")
    with open(MEM_PATH, "rb") as f:
        return f.read(size)

def sample_region(start, end, step=4):
    """Собирает все float тройки в регионе, читая блоками"""
    hits = []
    pos = start
    while pos < end:
        read_sz = min(CHUNK, end - pos)
        data = read_mem(pos, read_sz)
        for off in range(0, read_sz - 12, step):
            x = struct.unpack('<f', data[off:off+4])[0]
            y = struct.unpack('<f', data[off+4:off+8])[0]
            z = struct.unpack('<f', data[off+8:off+12])[0]
            if (not (x != x or y != y or z != z) and
                abs(x) < 10000 and abs(z) < 10000 and
                abs(y) < 50 and x > 0 and z > 0):
                hits.append((pos + off, x, y, z))
        pos += CHUNK
    return hits

import subprocess
maps_raw = subprocess.check_output(["cat", f"/proc/{PID}/maps"]).decode()

regions = []
for line in maps_raw.split('\n'):
    parts = line.split()
    if len(parts) < 5: continue
    if 'rw' in parts[1]:
        addrs = parts[0].split('-')
        start = int(addrs[0], 16)
        end = int(addrs[1], 16)
        regions.append((start, end, parts[-1] if len(parts) > 5 else ''))

print(f"RW regions: {len(regions)}")
for s, e, n in regions:
    sz = (e - s) // 1024
    print(f"  {hex(s)}-{hex(e)} ({sz}KB) {n}")

print("\n[*] Sampling 1 - STAY STILL...")
all1 = {}
for s, e, n in regions:
    print(f"  {hex(s)}-{hex(e)}...", end=' ', flush=True)
    h = sample_region(s, e)
    for addr, x, y, z in h:
        all1[addr] = (x, y, z)
    print(f"{len(h)} hits (total: {len(all1)})")

print(f"\n[*] Total: {len(all1)} candidates")
print("[*] Now move ~10 steps in ONE direction, then press Enter")
input()

print("\n[*] Sampling 2 - reading...")
all2 = {}
for s, e, n in regions:
    print(f"  {hex(s)}-{hex(e)}...", end=' ', flush=True)
    h = sample_region(s, e)
    for addr, x, y, z in h:
        all2[addr] = (x, y, z)
    print(f"{len(h)} hits")

print(f"\n[*] Comparing {len(all1)} -> {len(all2)}...")
changes = []
for addr, (x1, y1, z1) in all1.items():
    if addr not in all2: continue
    x2, y2, z2 = all2[addr]
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    dz = abs(z2 - z1)
    if (dx > 3 and dx < 30 and dy < 2 and dz < 2) or \
       (dz > 3 and dz < 30 and dx < 2 and dy < 2) or \
       (dx > 3 and dz > 3 and dy < 3):
        changes.append((addr, x1, y1, z1, x2, y2, z2, dx, dz))

print(f"\n=== CHANGES ({len(changes)}) ===")
changes.sort(key=lambda c: max(c[7], c[8]), reverse=True)
for addr, x1, y1, z1, x2, y2, z2, dx, dz in changes[:15]:
    print(f"  {hex(addr)}: ({x1:.4f}, {y1:.4f}, {z1:.4f}) -> ({x2:.4f}, {y2:.4f}, {z2:.4f})  [dx={dx:.4f} dz={dz:.4f}]")

if not changes:
    print("[!] No changes found. Moving too little or wrong region.")
