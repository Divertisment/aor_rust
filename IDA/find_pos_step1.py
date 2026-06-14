# find_pos_step1.py - сканирует АНОНИМНЫЕ RW регионы (куча Unity)
import struct, pickle

PID = 22105
MEM_PATH = "/proc/aor_mem"

def read_mem(addr, size):
    with open(MEM_PATH, "w") as f:
        f.write(f"{PID} {hex(addr)} {size}")
    with open(MEM_PATH, "rb") as f:
        return f.read(size)

maps = open(f"/proc/{PID}/maps").read()
regions = []
for line in maps.split('\n'):
    parts = line.split()
    if len(parts) < 5: continue
    if "rw" in parts[1] and "rw-p" in parts[1]:
        name = parts[-1] if len(parts) > 5 else ""
        # Исключаем GPU/dri/stack/vdso/vsyscall
        if any(x in name for x in ['dri', 'dev', 'stack', 'vdso', 'vsyscall', 'vvar']):
            continue
        addrs = parts[0].split('-')
        s, e = int(addrs[0], 16), int(addrs[1], 16)
        size_kb = (e - s) // 1024
        if size_kb > 64 and size_kb < 500 * 1024:  # >64KB and <500MB
            regions.append((s, e, name or "[anonymous]", size_kb))

print(f"Regions to scan: {len(regions)}")
total_mb = 0
for s,e,n,kb in regions:
    print(f"  {hex(s)}-{hex(e)} ({kb}KB) {n[:40]}")
    total_mb += kb
print(f"Total: {total_mb/1024:.1f}MB")

snapshot = {}
total_scanned = 0
for s, e, n, kb in regions:
    pos = s
    while pos < e:
        chunk = min(64000, e - pos)
        data = read_mem(pos, chunk)
        for off in range(0, len(data) - 12, 8):  # step=8
            x = struct.unpack('<f', data[off:off+4])[0]
            y = struct.unpack('<f', data[off+4:off+8])[0]
            z = struct.unpack('<f', data[off+8:off+12])[0]
            if (not (x != x or y != y or z != z) and
                x > 0 and x < 50000 and z > 0 and z < 50000 and
                -5 < y < 30 and
                abs(x) + abs(z) > 100):
                snapshot[pos + off] = (round(x,4), round(y,4), round(z,4))
        pos += chunk
        total_scanned += 1
        if total_scanned % 100 == 0:
            print(f"  Scanned {total_scanned * 64}KB, found {len(snapshot)} hits...", end='\r')

print(f"\n\nНайдено {len(snapshot)} троек float")
print("Первые 30:")
for i, (addr, (x,y,z)) in enumerate(sorted(snapshot.items())[:30]):
    print(f"  {hex(addr)}: ({x}, {y}, {z})")

with open('/tmp/pos_snap1.pkl', 'wb') as f:
    pickle.dump(snapshot, f)
print(f"\nСохранено {len(snapshot)} записей в /tmp/pos_snap1.pkl")
print("Теперь ПРОЙДИ 10-15 шагов и запусти step2")
