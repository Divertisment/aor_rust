import struct
import sys

PID = 21753
GOM_ADDR = 0x72dbb0088b20
USER_GO = 0x72d9d3d6b000
USER_TF = 0x72D95646C540

def read(addr, size, f):
    f.seek(addr)
    return f.read(size)

def read_u64(addr, f):
    return struct.unpack('<Q', read(addr, 8, f))[0]

def read_s32(addr, f):
    return struct.unpack('<i', read(addr, 4, f))[0]

def read_f32(addr, f):
    return struct.unpack('<f', read(addr, 4, f))[0]

def is_valid_addr(addr, maps):
    for start, end in maps:
        if start <= addr < end:
            return True
    return False

try:
    mem = open(f'/proc/{PID}/mem', 'rb')
    
    # Read memory maps
    maps = []
    with open(f'/proc/{PID}/maps', 'r') as mf:
        for line in mf:
            parts = line.split()
            addrs = parts[0].split('-')
            start = int(addrs[0], 16)
            end = int(addrs[1], 16)
            maps.append((start, end))
    
    # Get GOM sentinel and head
    mem.seek(GOM_ADDR + 0x18)
    head = read_u64(GOM_ADDR + 0x18, mem)
    sentinel_addr = GOM_ADDR + 0x18
    
    print(f"[GOM] Head: 0x{head:x}")
    print(f"[GOM] Sentinel: 0x{sentinel_addr:x}")
    
    # Get player coords
    player_x = read_f32(USER_TF + 0xF0, mem)
    player_y = read_f32(USER_TF + 0xF4, mem)
    player_z = read_f32(USER_TF + 0xF8, mem)
    print(f"[PLAYER] X={player_x:.2f} Y={player_y:.2f} Z={player_z:.2f}")
    
    # Traverse GOM linked list
    node = head
    count = 0
    found = []
    visited = set()
    
    print(f"\n[SCAN] Traversing GOM list...")
    
    while count < 2000:
        if not is_valid_addr(node, maps):
            print(f"  END at #{count}: invalid node addr 0x{node:x}")
            break
        
        if node in visited:
            print(f"  END at #{count}: cycle detected")
            break
        visited.add(node)
        
        # GameObject = node - 0x68
        go_addr = node - 0x68
        
        if is_valid_addr(go_addr + 0x18, maps):
            try:
                instance_id = read_s32(go_addr + 0x10, mem)
                
                if 0 < instance_id < 1000000:
                    # Get Transform from GO+0x18
                    tf_addr = read_u64(go_addr + 0x18, mem)
                    
                    if is_valid_addr(tf_addr + 0xF0, maps):
                        x = read_f32(tf_addr + 0xF0, mem)
                        y = read_f32(tf_addr + 0xF4, mem)
                        z = read_f32(tf_addr + 0xF8, mem)
                        
                        dx = abs(x - player_x)
                        dy = abs(y - player_y)
                        
                        if dx <= 3.0 and dy <= 3.0 and not (dx < 0.01 and dy < 0.01):
                            child_count = read_s32(tf_addr + 0x80, mem)
                            tag = "ТЫ" if instance_id == 573 else "ЦЕЛЬ"
                            found.append((instance_id, go_addr, tf_addr, x, y, z, child_count, dx, dy, tag))
            except:
                pass
        
        # Next node
        next_node = read_u64(node, mem)
        if next_node == sentinel_addr or next_node == 0 or not is_valid_addr(next_node, maps):
            break
        node = next_node
        count += 1
    
    print(f"\n[RESULT] Scanned {count} nodes, found {len(found)} nearby:")
    for f_item in found:
        print(f"  [{f_item[9]}] ID={f_item[0]} GO=0x{f_item[1]:x} TF=0x{f_item[2]:x} "
              f"X={f_item[3]:.2f} Y={f_item[4]:.2f} Z={f_item[5]:.2f} "
              f"children={f_item[6]} dx={f_item[7]:.2f} dy={f_item[8]:.2f}")
    
    mem.close()
    
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
