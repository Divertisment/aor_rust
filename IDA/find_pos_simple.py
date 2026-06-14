# find_pos_simple.py
# Ищет координаты игрока сканированием GameAssembly.so DATA секции
# 1. Снимок (стой неподвижно)
# 2. Пройди 10 шагов
# 3. Снимок - сравниваем
import struct, sys

PID = 22105
MEM_PATH = "/proc/aor_mem"

def read_mem(addr, size):
    with open(MEM_PATH, "w") as f:
        f.write(f"{PID} {hex(addr)} {size}")
    with open(MEM_PATH, "rb") as f:
        return f.read(size)

# Получаем только регионы GameAssembly.so
import subprocess
maps_raw = open(f"/proc/{PID}/maps").read()

ga_regions = []
for line in maps_raw.split('\n'):
    if "GameAssembly.so" in line and "rw" in line:
        parts = line.split()
        s = int(parts[0].split('-')[0], 16)
        e = int(parts[0].split('-')[1], 16)
        ga_regions.append((s, e))
        print(f"GameAssembly RW: {hex(s)}-{hex(e)} ({(e-s)//1024}KB)")

if not ga_regions:
    print("GameAssembly.so RW not found")
    # Найду другие rw регионы без /dev/dri
    print("Scanning all anonymous RW regions...")
    for line in maps_raw.split('\n'):
        parts = line.split()
        if len(parts) < 5: continue
        if "rw" in parts[1]:
            name = parts[-1] if len(parts) > 5 else ""
            if "dev" not in name and "dri" not in name and "vma" not in name and "stack" not in name and "vsyscall" not in name:
                s = int(parts[0].split('-')[0], 16)
                e = int(parts[0].split('-')[1], 16)
                if e - s < 500 * 1024 * 1024 and e - s > 4096:
                    ga_regions.append((s, e))
                    print(f"  {hex(s)}-{hex(e)} ({(e-s)//1024}KB) {name}")

def sample(regions, step=4):
    hits = []
    for s, e in regions:
        pos = s
        while pos < e:
            chunk_sz = min(4096, e - pos)
            data = read_mem(pos, chunk_sz)
            for off in range(0, len(data) - 12, step):
                x = struct.unpack('<f', data[off:off+4])[0]
                y = struct.unpack('<f', data[off+4:off+8])[0]
                z = struct.unpack('<f', data[off+8:off+12])[0]
                if (not (x != x or y != y or z != z) and
                    100 < x < 10000 and 100 < z < 10000 and
                    -10 < y < 30 and
                    abs(x) + abs(z) > 500):
                    hits.append((pos + off, round(x,2), round(y,2), round(z,2)))
            pos += chunk_sz
    return hits

print("\n[*] СНИМОК 1 - СТОЙ НЕПОДВИЖНО")
h1 = sample(ga_regions)
print(f"  Найдено {len(h1)} троек float")

# Убираем дубликаты по значениям
uniq1 = {}
for a, x, y, z in h1:
    key = (x, y, z)
    if key not in uniq1:
        uniq1[key] = a
print(f"  Уникальных позиций: {len(uniq1)}")

# Покажи первые 10
print("\n  Первые 10 кандидатов:")
for (x,y,z), a in list(uniq1.items())[:10]:
    print(f"    {hex(a)}: ({x}, {y}, {z})")

input("\n  Нажми Enter после того как пройдёшь 10-15 шагов...")

print("\n[*] СНИМОК 2")
h2 = sample(ga_regions)
uniq2 = {}
for a, x, y, z in h2:
    key = (x, y, z)
    if key not in uniq2:
        uniq2[key] = a

print(f"  Уникальных позиций: {len(uniq2)}")

# Сравниваем
print("\n[*] СРАВНЕНИЕ: ищу что изменилось")
changes = []
for (x1, y1, z1), a1 in uniq1.items():
    if (x1, y1, z1) not in uniq2:
        continue
    # Нашли те же координаты в обоих снимках - это НЕ изменилось
    # Ищем те что были в первом но нет во втором ИЛИ наоборот
    
# Ищем новые позиции (появились после движения)
for (x2, y2, z2), a2 in uniq2.items():
    if (x2, y2, z2) not in uniq1:
        # Новая позиция - мог быть игрок
        changes.append(("new", a2, None, x2, y2, z2))

# Ищем что пропало
for (x1, y1, z1), a1 in uniq1.items():
    if (x1, y1, z1) not in uniq2:
        changes.append(("gone", a1, x1, y1, z1, None))

print(f"  Изменений: {len(changes)}")
print("\n  Появились (new):")
for c in changes[:20]:
    if c[0] == "new":
        print(f"    {hex(c[1])}: ({c[3]}, {c[4]}, {c[5]})")

print("\n  Исчезли (gone):")
for c in changes[:20]:
    if c[0] == "gone":
        print(f"    {hex(c[1])}: ({c[2]}, {c[3]}, {c[4]})")

# Если изменений мало - показываем все
if len(changes) < 50:
    print(f"\n  Все изменения ({len(changes)}):")
    for c in changes:
        if c[0] == "new":
            print(f"    NEW {hex(c[1])}: ({c[3]:.2f}, {c[4]:.2f}, {c[5]:.2f})")
        else:
            print(f"    GONE {hex(c[1])}: ({c[2]:.2f}, {c[3]:.2f}, {c[4]:.2f})")
