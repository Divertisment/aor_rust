import struct

PID = 21753
GOM_ADDR = 0x72dbb0088b20
USER_NODE = 0x72d9d3d6b068
USER_GO = 0x72d9d3d6b000
SENTINEL_ADDR = GOM_ADDR + 0x18

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
    for m in maps:
        s, e = m
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

head = read_u64(GOM_ADDR + 0x18, mem)
print(f"[GOM] Head: 0x{head:x}")
print(f"[GOM] Head valid: {is_valid(head, maps)}")

# Check if head.prev == sentinel (confirms this is indeed the list head)
hp = read_u64(head + 8, mem)
print(f"[GOM] Head.prev: 0x{hp:x}")
print(f"[GOM] Head.prev == sentinel? {hp == SENTINEL_ADDR}")

# Find user's node by scanning the list
print(f"\n[SEARCH] Looking for user node 0x{USER_NODE:x} in GOM list...")

node = head
count = 0
visited = set()
found_user = False
first_10_ids = []

while count < 3000:
    if not is_valid(node, maps) or node in visited:
        break
    visited.add(node)
    
    if node == USER_NODE:
        print(f"[FOUND] User node at position #{count}!")
        found_user = True
        break
    
    if count < 10:
        go = node - 0x68
        if is_valid(go + 0x10, maps):
            try:
                fid = read_s32(go + 0x10, mem)
                first_10_ids.append(fid)
            except:
                first_10_ids.append(-1)
        else:
            first_10_ids.append(-2)
    
    nxt = read_u64(node, mem)
    if nxt == SENTINEL_ADDR:
        print(f"[END] Reached sentinel at #{count}")
        break
    if nxt == 0 or not is_valid(nxt, maps):
        print(f"[END] Invalid next at #{count}: 0x{nxt:x}")
        break
    node = nxt
    count += 1

if not found_user:
    print(f"[NOT FOUND] User node not in main GOM list ({count} nodes)")
    # Try going backwards from user node
    print(f"\n[TRAVERSE] Following user's list forward...")
    node = USER_NODE
    for i in range(20):
        go = node - 0x68
        fid = -1
        if is_valid(go + 0x10, maps):
            fid = read_s32(go + 0x10, mem)
        
        tf = 0
        x = y = z = 0
        if is_valid(go + 0x18, maps):
            tf = read_u64(go + 0x18, mem)
            if is_valid(tf + 0xF0, maps):
                x = read_f32(tf + 0xF0, mem)
                y = read_f32(tf + 0xF4, mem)
                z = read_f32(tf + 0xF8, mem)
        
        marker = " <-- ТЫ" if node == USER_NODE else ""
        print(f"  [{i}] node=0x{node:x} GO=0x{go:x} ID={fid} TF=0x{tf:x} "
              f"X={x:.2f} Y={y:.2f} Z={z:.2f}{marker}")
        
        nxt = read_u64(node, mem)
        if nxt == 0 or not is_valid(nxt, maps):
            print(f"  END: invalid next")
            break
        if nxt == USER_NODE:
            print(f"  END: cycle back")
            break
        node = nxt

print(f"\n[INFO] First 10 IDs in GOM main list: {first_10_ids}")
mem.close()
