"""Scan for ALL components at Z=12.0 (same map) using sudo /proc/pid/mem.

Strategy: search for float 12.0 (00 00 40 41 LE) in heap regions,
then validate component structure at base = address - 0xF8.
"""
import os
import struct
import sys
import math
isfinite = math.isfinite

PID = 25355
PATT = struct.pack("<f", 12.0)  # 00 00 40 41
HERO1_X = 179.9
HERO1_Y = 76.2

def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def flt(d, o): return struct.unpack_from("<f", d, o)[0]

fd = os.open(f"/proc/{PID}/mem", os.O_RDONLY)
def read_mem(addr, sz):
    os.lseek(fd, addr, os.SEEK_SET)
    return os.read(fd, sz)

# Get all anonymous rw-p regions
maps = open(f"/proc/{PID}/maps").read()
regions = []
for line in maps.split("\n"):
    if not line: continue
    parts = line.split()
    ar, perms = parts[0], parts[1]
    pathname = parts[5] if len(parts) > 5 else ""
    if not perms.startswith("rw"): continue
    if pathname and "heap" not in pathname and pathname != "": continue
    start_s, end_s = ar.split("-")
    start, end = int(start_s, 16), int(end_s, 16)
    if end - start > 0x10000:
        regions.append((start, end))
        print(f"  {ar} sz={(end-start):#x} {pathname or 'anon'}")

print(f"\nScanning {len(regions)} regions for Z=12.0...")

found = []
total_mb = 0
for start, end in regions:
    chunk = 4 * 1024 * 1024
    for base in range(start, end, chunk):
        rsz = min(chunk, end - base)
        total_mb += rsz
        try:
            data = read_mem(base, rsz)
        except:
            continue
        
        off = 0
        while True:
            off = data.find(PATT, off)
            if off == -1: break
            
            # Component base is at address - 0xF8 (Z is at +0xF8)
            mc_base = base + off - 0xF8
            
            # Check we can read TypeID at +0x00
            if off < 0xF8:
                off += 4
                continue
            
            # Read TypeID at +0x00
            type_off = off - 0xF8
            if type_off + 0x20 > len(data):
                off += 4
                continue
                
            typ = u32(data, type_off)
            ent = u64(data, type_off + 0x10)
            go = u64(data, type_off + 0x18)
            
            # Validate entity and GO pointers
            if not (ent > 0x7cc000000000 and ent < 0x7cf000000000 and
                    go > 0x7cc000000000 and go < 0x7cf000000000):
                off += 4
                continue
            
            # Get X, Y from already-read data
            x = flt(data, type_off + 0xF0)
            y = flt(data, type_off + 0xF4)
            
            if not (isfinite(x) and isfinite(y)):
                off += 4
                continue
            
            # Get GameObject ID
            go_addr = go
            if go_addr >= base and go_addr < base + len(data):
                go_id = u32(data, go_addr - base + 0x10)
            else:
                try:
                    gd = read_mem(go_addr, 0x14)
                    go_id = u32(gd, 0x10)
                except:
                    go_id = -1
            
            if go_id > 0 and go_id < 50000:
                found.append((mc_base, typ, go_id, x, y, ent, go))
            
            off += 4

os.close(fd)

print(f"\nTotal scanned: {total_mb/(1024*1024):.1f} MB")
print(f"Found {len(found)} components with Z=12.0:")
for addr, typ, goid, x, y, ent, go in sorted(found, key=lambda f: abs(f[3]-HERO1_X)+abs(f[4]-HERO1_Y)):
    dist = ((x-HERO1_X)**2 + (y-HERO1_Y)**2)**0.5
    near = " <-- NEAR HERO" if dist < 20 else ""
    print(f"  MC={addr:#014x} type=0x{typ:08x} ID={goid} X={x:.1f} Y={y:.1f} Ent={ent:#014x}{near}")
