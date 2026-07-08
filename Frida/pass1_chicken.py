import os, struct, sys

PID = 10994
PROC_MEM = "/proc/aor_mem"
F1_MIN, F1_MAX = 176.0, 186.0
F2_MIN, F2_MAX = 72.0, 82.0

def read_mem(addr, size):
    with open(PROC_MEM, 'w') as f:
        f.write(f"{PID} 0x{addr:x} {size}")
    with open(PROC_MEM, 'rb') as f:
        return f.read(size)

def get_rw_regions():
    regions = []
    with open(f"/proc/{PID}/maps", 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 2: continue
            prot = parts[1]
            if 'r' not in prot or 'w' not in prot: continue
            addrs = parts[0].split('-')
            start = int(addrs[0], 16)
            end = int(addrs[1], 16)
            size = end - start
            if size > 512 * 1024 * 1024: continue
            regions.append((start, size))
    return regions

# Only scan region containing the chicken
CHICKEN = 0x79933C7980D0
target_region = None
for start, size in get_rw_regions():
    if start <= CHICKEN < start + size:
        target_region = (start, size)
        break

print(f"[PASS1-c] Куриный регион: 0x{target_region[0]:x} size={target_region[1]//1024//1024}MB")
if not target_region:
    print("[-] Куриный регион не найден!")
    sys.exit(1)

start, size = target_region
findings = []
candidates = []

# Scan only ±8MB around chicken
SCAN_START = max(start, CHICKEN - 8*1024*1024)
SCAN_END = min(start + size, CHICKEN + 8*1024*1024)
SCAN_SIZE = SCAN_END - SCAN_START
print(f"[PASS1-c] Сканирую 0x{SCAN_START:x} - 0x{SCAN_END:x} ({SCAN_SIZE//1024//1024}MB)")

CHUNK = 1024 * 1024
for off in range(0, SCAN_SIZE - 12, CHUNK):
    chunk_start = SCAN_START + off
    chunk_size = min(CHUNK + 12, SCAN_SIZE - off)
    print(f"  чанк 0x{chunk_start:x} ({chunk_size//1024}KB)", flush=True)
    try:
        data = read_mem(chunk_start, chunk_size)
        for j in range(0, len(data) - 12, 8):
            f1 = struct.unpack('<f', data[j:j+4])[0]
            f2 = struct.unpack('<f', data[j+4:j+8])[0]
            f3 = struct.unpack('<f', data[j+8:j+12])[0]
            if F1_MIN <= f1 <= F1_MAX and F2_MIN <= f2 <= F2_MAX:
                addr = chunk_start + j
                findings.append((addr, f1, f2, f3))
                print(f"  НАЙДЕН: 0x{addr:x} -> X={f1:.2f} Y={f2:.2f} Z={f3:.2f}")
    except Exception as e:
        print(f"  ошибка чанка: {e}")

print(f"\n[PASS1-c] Итого: {len(findings)} совпадений")
answer = sorted(findings, key=lambda x: x[1])
for addr, x, y, z in answer:
    print(f"  0x{addr:x}  X={x:.2f} Y={y:.2f} Z={z:.2f}")
