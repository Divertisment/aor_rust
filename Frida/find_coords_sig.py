import struct
import sys

PID = 21753
PLAYER_X = 179.97
PLAYER_Y = 62.47
PLAYER_Z = 8.00

player_coords_bytes = struct.pack('<fff', PLAYER_X, PLAYER_Y, PLAYER_Z)
print(f"[SIG] Searching for signature: {player_coords_bytes.hex()}")

mem = open(f'/proc/{PID}/mem', 'rb')

maps = []
with open(f'/proc/{PID}/maps', 'r') as mf:
    for line in mf:
        p = line.split()
        if len(p) >= 2:
            a = p[0].split('-')
            if len(a) == 2:
                maps.append((int(a[0], 16), int(a[1], 16)))

def is_valid(addr):
    for s, e in maps:
        if s <= addr < e:
            return True
    return False

found_locations = []

for s, e in maps:
    size = e - s
    if size > 0x03000000 or size < 0x10000:
        continue
    
    chunk_size = min(size, 0x400000)  # 4MB chunks
    for offset in range(0, size - 12, chunk_size):
        try:
            mem.seek(s + offset)
            data = mem.read(chunk_size + 12)
        except:
            continue
        
        pos = 0
        while True:
            pos = data.find(player_coords_bytes, pos)
            if pos == -1:
                break
            
            # This is the Vector3 at +0xF0. Transform = addr - 0xF0
            addr = s + offset + pos
            tf_addr = addr - 0xF0
            
            if is_valid(tf_addr):
                try:
                    go = struct.unpack('<Q', mem.read(tf_addr + 0x18, 8))[0]
                except:
                    go = 0
                
                try:
                    cc = struct.unpack('<i', mem.read(tf_addr + 0x80, 4))[0]
                except:
                    cc = -1
                
                try:
                    id_ = struct.unpack('<i', mem.read(go + 0x10, 4))[0]
                except:
                    id_ = -1
                
                found_locations.append((addr, tf_addr, go, id_, cc))
                print(f"[FOUND] Coords at 0x{addr:x} TF=0x{tf_addr:x} GO=0x{go:x} ID={id_} children={cc}")
            else:
                print(f"[MATCH] Coords at 0x{addr:x} (TF would be 0x{tf_addr:x} - INVALID)")
            
            pos += 12
    
    if len(found_locations) > 0:
        break  # Stop after first region with matches

mem.close()

print(f"\n[DONE] Found {len(found_locations)} locations with player coords")
for loc in found_locations:
    print(f"  addr=0x{loc[0]:x} TF=0x{loc[1]:x} GO=0x{loc[2]:x} ID={loc[3]} children={loc[4]}")
