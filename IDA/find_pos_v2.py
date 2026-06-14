# find_pos_v2.py
# Сравнивает по АДРЕСАМ, а не по значениям
import struct

PID = 22105
MEM_PATH = "/proc/aor_mem"

def read_mem(addr, size):
    with open(MEM_PATH, "w") as f:
        f.write(f"{PID} {hex(addr)} {size}")
    with open(MEM_PATH, "rb") as f:
        return f.read(size)

# GameAssembly.so RW регион (самый маленький, ~4MB)
maps = open(f"/proc/{PID}/maps").read()
ga_rw = []
for line in maps.split('\n'):
    if "GameAssembly.so" in line and "rw" in line:
        parts = line.split()
        addrs = parts[0].split('-')
        s = int(addrs[0], 16)
        e = int(addrs[1], 16)
        ga_rw.append((s, e))

print(f"GameAssembly RW: {len(ga_rw)} regions")
for s,e in ga_rw:
    print(f"  {hex(s)}-{hex(e)} ({(e-s)//1024}KB)")

def sample(regions, step=4):
    """Собирает {address: (x,y,z)} из регионов"""
    result = {}
    total_bytes = 0
    for s, e in regions:
        pos = s
        while pos < e:
            chunk = min(16384, e - pos)
            data = read_mem(pos, chunk)
            total_bytes += len(data)
            for off in range(0, len(data) - 12, step):
                x = struct.unpack('<f', data[off:off+4])[0]
                y = struct.unpack('<f', data[off+4:off+8])[0]
                z = struct.unpack('<f', data[off+8:off+12])[0]
                if (not (x != x or y != y or z != z) and
                    100 < x < 10000 and 100 < z < 10000 and
                    -10 < y < 30):
                    result[pos + off] = (x, y, z)
            pos += chunk
    return result, total_bytes

print("\n[1] Снимок - СТОЙ НЕПОДВИЖНО")
r1, bytes1 = sample(ga_rw)
print(f"  Прочитано {bytes1/1024:.0f}KB, найдено {len(r1)} троек")

input("\n[2] Нажми Enter после того как ПРОЙДЁШЬ 10-15 шагов прямо...")

r2, bytes2 = sample(ga_rw)
print(f"  Прочитано {bytes2/1024:.0f}KB, найдено {len(r2)} троек")

print("\n[3] Сравниваю по адресам...")
diffs = []
for addr, (x1, y1, z1) in r1.items():
    if addr in r2:
        x2, y2, z2 = r2[addr]
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        dz = abs(z2 - z1)
        # Ищу: одна горизонтальная ось изменилась на 5-25, другая почти нет
        # По одной оси игрок шёл
        if (dx > 3 and dx < 30 and dz < 3 and dy < 2) or \
           (dz > 3 and dz < 30 and dx < 3 and dy < 2) or \
           (dx > 3 and dz > 3 and dx < 30 and dz < 30 and dy < 3):
            diffs.append((dx + dz, addr, x1, y1, z1, x2, y2, z2))

# Сортируем: самые большие изменения
diffs.sort(key=lambda d: d[0], reverse=True)

print(f"\n  Найдено {len(diffs)} изменяющихся позиций")
print("\n  ТОП-20 кандидатов в координаты:")
for score, addr, x1, y1, z1, x2, y2, z2 in diffs[:20]:
    print(f"  {hex(addr)}: ({x1:.2f}, {y1:.2f}, {z1:.2f}) -> ({x2:.2f}, {y2:.2f}, {z2:.2f})  [dx={abs(x2-x1):.2f}, dz={abs(z2-z1):.2f}]")

if not diffs:
    print("\n  Изменений нет. Возможно:")
    print("  - Игрок не двигался")
    print("  - Координаты не в GameAssembly RW секции")
    print("  - Слишком строгий фильтр")
    # Покажи просто что менялось
    print("\n  Все изменения (любые):")
    for addr, (x1, y1, z1) in r1.items():
        if addr in r2:
            x2, y2, z2 = r2[addr]
            if (x1 != x2 or y1 != y2 or z1 != z2):
                print(f"    {hex(addr)}: ({x1:.1f},{y1:.1f},{z1:.1f}) -> ({x2:.1f},{y2:.1f},{z2:.1f})")
