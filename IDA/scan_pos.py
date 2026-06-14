# scan_pos.py
# Сканирует память GameAssembly.so через /proc/aor_mem
# Ищет triplet float'ов меняющихся при движении

import struct, time, sys

PID = 18416
MEM_PATH = "/proc/aor_mem"

def read_mem(addr, size):
    with open(MEM_PATH, "w") as f:
        f.write(f"{PID} {hex(addr)} {size}")
    with open(MEM_PATH, "r") as f:
        raw = f.read()
    if isinstance(raw, str):
        raw = raw.encode('latin-1')
    if len(raw) < size:
        raw = raw + b'\x00' * (size - len(raw))
    return raw[:size]

def read_float(addr):
    data = read_mem(addr, 4)
    return struct.unpack('<f', data)[0]

def scan_floats(start, size, step=4):
    result = []
    for off in range(0, size - 12, step):
        x = read_float(start + off)
        y = read_float(start + off + 4)
        z = read_float(start + off + 8)
        if (isinstance(x, float) and isinstance(y, float) and isinstance(z, float) and
            not isnan(x) and not isnan(y) and not isnan(z) and
            abs(x) < 100000 and abs(y) < 100000 and abs(z) < 100000 and
            abs(x) > 10 and abs(z) > 10 and  # игрок не в нуле
            abs(y) < 100):  # высота разумная
            result.append((start + off, x, y, z))
    return result

def isnan(x):
    return x != x

# Читаем /proc/<pid>/maps для GameAssembly.so
import subprocess
maps = subprocess.check_output(["cat", f"/proc/{PID}/maps"]).decode()
ga_regions = []
for line in maps.split('\n'):
    if "GameAssembly.so" in line and "rw-p" in line:
        parts = line.split()
        addrs = parts[0].split('-')
        start = int(addrs[0], 16)
        end = int(addrs[1], 16)
        ga_regions.append((start, end))
        print(f"RW region: {hex(start)}-{hex(end)}")

# Сканируем первый RW сегмент (data/bss)
if ga_regions:
    start, end = ga_regions[0]
    print(f"\nScanning {hex(start)}-{hex(end)} for float triplets...")
    hits = []
    for off in range(0, end - start - 12, 16):
        x = read_float(start + off)
        y = read_float(start + off + 4)
        z = read_float(start + off + 8)
        if (isinstance(x, float) and isinstance(y, float) and isinstance(z, float) and
            not isnan(x) and not isnan(y) and not isnan(z) and
            abs(x) < 10000 and abs(z) < 10000 and
            abs(x) > 10 and abs(z) > 10 and
            abs(y) < 50):
            hits.append((start + off, x, y, z))
    
    print(f"Found {len(hits)} candidates")
    for addr, x, y, z in hits[:20]:
        print(f"  {hex(addr)}: ({x:.2f}, {y:.2f}, {z:.2f})")
    if len(hits) > 20:
        print(f"  ... and {len(hits)-20} more")

else:
    print("No RW GameAssembly.so regions found")
