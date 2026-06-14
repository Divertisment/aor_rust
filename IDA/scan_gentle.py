# scan_gentle.py
# Сканирует с паузами чтобы не вешать игру
import struct, time, os

PID = 22105
MEM_PATH = "/proc/aor_mem"
PAUSE = 0.05  # 50ms между чанками

def read_mem(addr, size):
    with open(MEM_PATH, "w") as f:
        f.write(f"{PID} {hex(addr)} {size}")
    with open(MEM_PATH, "rb") as f:
        return f.read(size)

def sample(regions, step=16, pause=PAUSE):
    """Собирает float тройки с паузами"""
    hits = {}
    for s, e in regions:
        pos = s
        chunk = 4096
        while pos < e:
            sz = min(chunk, e - pos)
            data = read_mem(pos, sz)
            for off in range(0, sz - 12, step):
                x = struct.unpack('<f', data[off:off+4])[0]
                y = struct.unpack('<f', data[off+4:off+8])[0]
                z = struct.unpack('<f', data[off+8:off+12])[0]
                if (not (x != x or y != y or z != z) and
                    x > 0 and x < 50000 and z > 0 and z < 50000 and
                    -5 < y < 30):
                    hits[pos + off] = (round(x,4), round(y,4), round(z,4))
            pos += chunk
            time.sleep(pause)
    return hits

# Анонимные RW регионы (куча Unity)
maps = open(f"/proc/{PID}/maps").read()
regions = []
for line in maps.split('\n'):
    parts = line.split()
    if len(parts) < 5: continue
    if "rw-p" not in parts[1]: continue
    name = parts[-1] if len(parts) > 5 else ""
    if any(x in name for x in ['dri', 'dev', 'stack', 'vdso', 'vsyscall', 'vvar']):
        continue
    addrs = parts[0].split('-')
    s, e = int(addrs[0], 16), int(addrs[1], 16)
    kb = (e - s) // 1024
    if 128 < kb < 500 * 1024:
        regions.append((s, e))

mb = sum((e-s) for s,e in regions) / 1024 / 1024
print(f"Сканирую {len(regions)} регионов ({mb:.0f}MB), шаг=16, пауза={int(PAUSE*1000)}ms")
print("ШАГ 1: СТОЙ НЕПОДВИЖНО")
print("Начинаю (это займёт ~1 минуту)...")

hits = sample(regions)
print(f"\nНайдено {len(hits)} троек")

# Сохраняем
import pickle
with open('/tmp/scan1.pkl', 'wb') as f:
    pickle.dump(hits, f)

print("Сохранено в /tmp/scan1.pkl")
print("ПРОЙДИ 10-15 шагов, потом запусти scan_gentle2.py")
