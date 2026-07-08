import struct

PID = 25355
START_COMP = 0x7CCB0210F540
mem = open(f'/proc/{PID}/mem', 'rb')

maps = []
with open(f'/proc/{PID}/maps', 'r') as f:
    for line in f:
        p = line.split()
        if len(p) >= 2:
            a = p[0].split('-')
            maps.append((int(a[0], 16), int(a[1], 16)))

def valid(addr):
    return any(s <= addr < e for s, e in maps)

visited = set()
found_components = []

def scan(addr):
    if addr in visited or not valid(addr) or addr < 0x100000000000:
        return
    visited.add(addr)
    
    # Читаем координаты текущего компонента
    try:
        mem.seek(addr + 0xF0)
        x, y, z = struct.unpack('<fff', mem.read(12))
    except: return

    # Проверка: если это компонент, он должен иметь валидные координаты Z≈10.2
    if abs(z - 10.20) > 0.5: return
    
    found_components.append((addr, x, y, z))
    print(f'[FOUND] Component=0x{addr:x} X={x:.2f} Y={y:.2f} Z={z:.2f}')
    
    # Обходим потенциальные связи (+0x28, +0x30, +0x50, +0x58)
    for off in [0x28, 0x30, 0x50, 0x58, 0x60]:
        try:
            mem.seek(addr + off)
            next_addr = struct.unpack('<Q', mem.read(8))[0]
            scan(next_addr)
        except: continue

print(f"[SCAN] Начинаю обход дерева сущностей от 0x{START_COMP:x}...")
scan(START_COMP)
print(f"\n[DONE] Найдено компонентов: {len(found_components)}")
mem.close()
