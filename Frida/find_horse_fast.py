import struct, sys

PID = 21753
PLAYER_X, PLAYER_Y, PLAYER_Z = 179.97, 62.47, 8.0

mem = open(f'/proc/{PID}/mem', 'rb')

maps = []
with open(f'/proc/{PID}/maps', 'r') as f:
    for line in f:
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

z8_pat = struct.pack('<f', PLAYER_Z)  # 00 00 00 41
z7_5 = struct.pack('<f', 7.5)
z8_5 = struct.pack('<f', 8.5)

print(f"[SCAN] Scanning for Z near 8.0...")
found = []
total = 0

for s, e in maps:
    size = e - s
    if size > 0x02000000 or size < 0x1000:
        continue
    
    total += size
    try:
        mem.seek(s)
        data = mem.read(size)
    except:
        continue
    
    # Find all occurrences of Z=8.0 (aligned to 4)
    off = 0
    while True:
        off = data.find(z8_pat, off)
        if off == -1 or off > size - 0x100:
            break
        if off % 4 != 0:
            off += 4
            continue
        
        z_addr = s + off
        tf_addr = z_addr - 0xF8
        
        if not valid(tf_addr):
            off += 4
            continue
        
        # Read X, Y
        x = struct.unpack('<f', data[off-8:off-4])[0]
        y = struct.unpack('<f', data[off-4:off])[0]
        
        dx = abs(x - PLAYER_X)
        dy = abs(y - PLAYER_Y)
        
        if dx < 0.1 and dy < 0.1:
            off += 4
            continue  # skip self
        
        if dx > 3.5 or dy > 3.5:
            off += 4
            continue
        
        # Validate: childCount at +0x80
        cc = struct.unpack('<i', data[off - 0x78:off - 0x74])[0]
        if cc < 0 or cc > 20:
            off += 4
            continue
        
        # Validate: GO pointer at +0x18
        go = struct.unpack('<Q', data[off - 0xE0:off - 0xD8])[0]
        if not valid(go):
            off += 4
            continue
        
        # Read InstanceID from GO (may be in different region)
        try:
            mem.seek(go + 0x10)
            uid = struct.unpack('<i', mem.read(4))[0]
        except:
            off += 4
            continue
        if uid <= 0 or uid > 10000000:
            off += 4
            continue
        
        found.append((tf_addr, go, uid, x, y, PLAYER_Z, cc, dx, dy))
        print(f'[FOUND] TF=0x{tf_addr:x} GO=0x{go:x} ID={uid} X={x:.2f} Y={y:.2f} Z={PLAYER_Z:.1f} cc={cc}')
        
        off += 4

mem.close()
print(f'\n[DONE] Scanned {total//1024//1024} MB. Found {len(found)} entities near player.')
