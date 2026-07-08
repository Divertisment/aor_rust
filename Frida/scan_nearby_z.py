import struct
import sys

PID = 21753
PLAYER_X = 179.97
PLAYER_Y = 62.47
PLAYER_Z = 8.00

def read(addr, size, f):
    f.seek(addr)
    return f.read(size)

def read_u64(addr, f):
    return struct.unpack('<Q', read(addr, 8, f))[0]

def read_s32(addr, f):
    return struct.unpack('<i', read(addr, 4, f))[0]

def read_f32(addr, f):
    return struct.unpack('<f', read(addr, 4, f))[0]

def is_valid(addr, maps):
    for s, e in maps:
        if s <= addr < e:
            return True
    return False

mem = open(f'/proc/{PID}/mem', 'rb')

maps = []
with open(f'/proc/{PID}/maps', 'r') as mf:
    for line in mf:
        p = line.split()
        if len(p) >= 2:
            a = p[0].split('-')
            if len(a) == 2:
                maps.append((int(a[0], 16), int(a[1], 16)))

print(f"[SCAN] Scanning for Transforms near X={PLAYER_X} Y={PLAYER_Y} Z={PLAYER_Z}")
print(f"[SCAN] Total memory regions: {len(maps)}")

found = []
count = 0
scanned = 0

player_z_bytes = struct.pack('<f', PLAYER_Z)
target_z = int.from_bytes(player_z_bytes, 'little')
# Z=8.0 ± 0.5: 7.5 to 8.5 as int32 ranges
z_min = struct.unpack('<i', struct.pack('<f', PLAYER_Z - 0.5))[0]
z_max = struct.unpack('<i', struct.pack('<f', PLAYER_Z + 0.5))[0]

for s, e in maps:
    size = e - s
    if size > 0x03000000 or size < 0x1000:
        continue
    
    # Read chunks
    chunk_size = min(size, 0x100000)  # 1MB chunks
    for offset in range(0, size - 0x100, chunk_size):
        try:
            mem.seek(s + offset)
            data = mem.read(chunk_size)
        except:
            continue
        
        # Search for Z ≈ 8.0 (as float) in 4-byte aligned positions
        for i in range(0, len(data) - 0x100, 4):
            z_raw = struct.unpack('<i', data[i:i+4])[0]
            if z_min <= z_raw <= z_max:
                addr = s + offset + i
                # This is Z at addr. Transform has Z at +0xF8, so Transform = addr - 0xF8
                tf_addr = addr - 0xF8
                
                if not is_valid(tf_addr, maps):
                    continue
                
                try:
                    x = read_f32(tf_addr + 0xF0, mem)
                    y = read_f32(tf_addr + 0xF4, mem)
                    z = read_f32(tf_addr + 0xF8, mem)
                except:
                    continue
                
                if abs(z - PLAYER_Z) > 0.5:
                    continue
                
                dx = abs(x - PLAYER_X)
                dy = abs(y - PLAYER_Y)
                
                if dx > 3.0 or dy > 3.0:
                    continue
                
                # Validate it's a real Transform
                try:
                    cc = read_s32(tf_addr + 0x80, mem)
                    if cc < 0 or cc > 20:
                        continue
                    
                    go = read_u64(tf_addr + 0x18, mem)
                    if not is_valid(go, maps):
                        continue
                    
                    id_ = read_s32(go + 0x10, mem)
                    if id_ <= 0 or id_ > 10000000:
                        continue
                    
                    found.append((id_, go, tf_addr, x, y, z, cc, dx, dy, addr))
                except:
                    continue
        
        scanned += chunk_size
        if scanned % (10 * 1024 * 1024) == 0:
            print(f"  Scanned {scanned // 1024 // 1024} MB, found {len(found)}")

print(f"\n[FOUND] {len(found)} Transforms near player:")
for f_item in found:
    tag = "ТЫ" if f_item[0] == 573 else "ЦЕЛЬ"
    print(f"  [{tag}] ID={f_item[0]} GO=0x{f_item[1]:x} TF=0x{f_item[2]:x} "
          f"X={f_item[3]:.2f} Y={f_item[4]:.2f} Z={f_item[5]:.2f} "
          f"children={f_item[6]} dx={f_item[7]:.2f} dy={f_item[8]:.2f}")

mem.close()
