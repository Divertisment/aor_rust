import frida
import struct

TARGET_PID = 2471
FLOAT1_MIN, FLOAT1_MAX = 176.0, 186.0
FLOAT2_MIN, FLOAT2_MAX = 72.0, 82.0

session = frida.attach(TARGET_PID)
print(f"Прикреплён к процессу PID {TARGET_PID}")

# Сканируем читаемые/записываемые регионы памяти
ranges = session.enumerate_ranges('rw-')
print(f"Найдено регионов памяти: {len(ranges)}")

matches = []
for i, r in enumerate(ranges):
    try:
        data = session.read_bytes(r.base, r.size)
    except Exception:
        continue

    floats = struct.unpack_from(f'<{len(data)//4}f', data)
    for j in range(len(floats) - 2):
        f1, f2, f3 = floats[j], floats[j+1], floats[j+2]
        if FLOAT1_MIN <= f1 <= FLOAT1_MAX and FLOAT2_MIN <= f2 <= FLOAT2_MAX:
            addr = r.base + j * 4
            matches.append((addr, f1, f2, f3))

    if i % 20 == 0:
        print(f"  Сканировано регионов: {i+1}/{len(ranges)}")

print(f"\nНайдено совпадений: {len(matches)}")
for addr, f1, f2, f3 in matches[:50]:
    print(f"  0x{addr:x} -> f1={f1:.3f}  f2={f2:.3f}  f3={f3:.3f}")

session.detach()
