import struct

PID = 25355
PLAYER_X, PLAYER_Y, PLAYER_Z = 179.84, 58.03, 10.20

mem = open(f'/proc/{PID}/mem', 'rb')

maps = []
with open(f'/proc/{PID}/maps', 'r') as mf:
    for line in mf:
        p = line.split()
        if len(p) >= 2:
            a = p[0].split('-')
            if len(a) == 2:
                maps.append((int(a[0], 16), int(a[1], 16)))

def valid(addr):
    for s, e in maps:
        if s <= addr < e:
            return True
    return False

# Z=8.0 bytes: 00 00 00 41
z_bytes = struct.pack('<f', PLAYER_Z)
# Also allow Z=7.5 to 8.5
z_min = struct.pack('<f', PLAYER_Z - 0.5)
z_max = struct.pack('<f', PLAYER_Z + 0.5)
z_min_i = struct.unpack('<I', z_min)[0]
z_max_i = struct.unpack('<I', z_max)[0]

print(f"[SCAN] Searching for Z in range [{PLAYER_Z-0.5:.1f}, {PLAYER_Z+0.5:.1f}]")
print(f"[SCAN] Z bytes range: 0x{z_min_i:08x} - 0x{z_max_i:08x}")

found = []
total_scanned = 0

for s, e in maps:
    size = e - s
    if size > 0x02000000 or size < 0x1000:
        continue
    
    try:
        mem.seek(s)
        # Process in chunks instead of reading all at once
        for off in range(0, size, 0x10000):
            sz = min(0x10000, size - off)
            data = mem.read(sz)
            
            # Search for Z values in 4-byte aligned positions
            for i in range(0, sz - 0x100, 4):
                z_raw = struct.unpack('<I', data[i:i+4])[0]
                if z_min_i <= z_raw <= z_max_i:
                    z_addr = s + off + i
                    # ... rest of the logic ...
    except:
        continue
        z_raw = struct.unpack('<I', data[i:i+4])[0]
        if z_min_i <= z_raw <= z_max_i:
            z_addr = s + i
            tf_addr = z_addr - 8  # Z is at +0xF8, so +0xF0 = X is 8 bytes before
            
            # Check X and Y
            x_raw = struct.unpack('<f', data[i-8:i-4])
            y_raw = struct.unpack('<f', data[i-4:i])
            
            dx = abs(x_raw[0] - PLAYER_X)
            dy = abs(y_raw[0] - PLAYER_Y)
            
            if dx > 4.0 or dy > 4.0:
                continue
            
            if dx < 0.001 and dy < 0.001:
                continue  # Skip self
            
            # Validate Transform structure
            if not valid(tf_addr):
                continue
            
            try:
                go = struct.unpack('<Q', mem.read(tf_addr + 0x18, 8))[0]
                if not valid(go):
                    continue
                id_ = struct.unpack('<i', mem.read(go + 0x10, 4))[0]
                if id_ <= 0 or id_ > 10000000:
                    continue
                cc = struct.unpack('<i', mem.read(tf_addr + 0x80, 4))[0]
                if cc < 0 or cc > 20:
                    continue
            except:
                continue
            
            found.append((tf_addr, go, id_, x_raw[0], y_raw[0], z_raw, cc, dx, dy))
    
    if found:
        break

mem.close()

if found:
    print(f"\n[FOUND] {len(found)} nearby entities:")
    for f_item in found:
        tag = "YOU" if f_item[2] == 573 else "HORSE?"
        print(f"  [{tag}] TF=0x{f_item[0]:x} GO=0x{f_item[1]:x} ID={f_item[2]} "
              f"X={f_item[3]:.2f} Y={f_item[4]:.2f} Z={f_item[5]:.2f} "
              f"children={f_item[6]} dx={f_item[7]:.2f} dy={f_item[8]:.2f}")
else:
    print("\n[NOT FOUND] No nearby entities found in scanned memory")
