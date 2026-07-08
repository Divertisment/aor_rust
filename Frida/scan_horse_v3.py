import struct, sys

PID = 25355
PLAYER_X, PLAYER_Y, PLAYER_Z = 179.84, 58.03, 10.20

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

z_min_i = struct.unpack('<I', struct.pack('<f', PLAYER_Z - 0.5))[0]
z_max_i = struct.unpack('<I', struct.pack('<f', PLAYER_Z + 0.5))[0]

print(f"[SCAN] Searching...")
found = []

for s, e in maps:
    for off in range(0, e - s, 0x10000):
        sz = min(0x10000 + 0x100, e - s - off)
        try:
            mem.seek(s + off)
            data = mem.read(sz)
        except: continue
        
        for i in range(0, len(data) - 0x100, 4):
            z_raw = struct.unpack('<I', data[i:i+4])[0]
            if z_min_i <= z_raw <= z_max_i:
                tf_addr = s + off + i - 0xF8
                if not valid(tf_addr): continue
                
                try:
                    x = struct.unpack('<f', data[i-8:i-4])[0]
                    y = struct.unpack('<f', data[i-4:i])[0]
                    if abs(x - PLAYER_X) > 3.0 or abs(y - PLAYER_Y) > 3.0: continue
                    if abs(x - PLAYER_X) < 0.1 and abs(y - PLAYER_Y) < 0.1: continue
                    
                    mem.seek(tf_addr + 0x18)
                    go = struct.unpack('<Q', mem.read(8))[0]
                    if not valid(go): continue
                    
                    mem.seek(go + 0x10)
                    uid = struct.unpack('<i', mem.read(4))[0]
                    if uid <= 0 or uid > 10000000: continue
                    
                    found.append((tf_addr, go, uid, x, y))
                    print(f'[FOUND] TF=0x{tf_addr:x} GO=0x{go:x} ID={uid} X={x:.2f} Y={y:.2f}')
                except: continue
mem.close()
