import struct
PID = 25355
PX, PY, PZ = 179.84, 59.62, 8.00
RANGE = 3.0

START = 0x7ccae0000000  # Start of MC heap area
SIZE = 0x2000000  # 32MB should be enough

mem = open(f'/proc/{PID}/mem', 'rb')
mem.seek(START)
data = mem.read(SIZE)
mem.close()

# Pattern for Z=8.00
z_pat = struct.pack('<f', PZ)  # 00 00 00 41
count = 0

pos = 0
while True:
    pos = data.find(z_pat, pos)
    if pos == -1 or count >= 20:
        break
    
    z_addr = START + pos
    # X is at Z - 8
    x_addr = z_addr - 8
    
    if x_addr >= START:
        x = struct.unpack_from('<f', data, pos - 8)[0]
        y = struct.unpack_from('<f', data, pos - 4)[0]
        
        if abs(x) < 1000 and abs(y) < 1000 and abs(x - PX) < RANGE and abs(y - PY) < RANGE:
            struct_addr = x_addr - 0xF0  # MC starts 0xF0 before X
            mem2 = open(f'/proc/{PID}/mem', 'rb')
            try:
                mem2.seek(struct_addr)
                first_dword = struct.unpack('<I', mem2.read(4))[0]
                mem2.seek(struct_addr + 0x18)
                go = struct.unpack('<Q', mem2.read(8))[0]
                if go > 0x700000000000:
                    mem2.seek(go + 0x10)
                    obj_id = struct.unpack('<i', mem2.read(4))[0]
                    if 0 < obj_id < 5000000 and obj_id != 533:
                        angle = struct.unpack('<f', mem2.read(4))[0] if False else 0
                        print(f'{struct_addr:012x} type=0x{first_dword:08x} ID={obj_id} X={x:.2f} Y={y:.2f}')
                        count += 1
            except:
                pass
            mem2.close()
    
    pos += 4

if count == 0:
    print("Nothing found near player")
