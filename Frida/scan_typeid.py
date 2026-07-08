"""Scan for specific TypeIDs in heap using sudo /proc/pid/mem.

Usage: python3 scan_typeid.py [TYPEID_HEX]
Default: scan for 0x18f98ae0 (player) and 0x189af180 (creature)
"""
import os
import struct
import sys

PID = 25355
HERO1_X = 179.9
HERO1_Y = 76.2

def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def flt(d, o): return struct.unpack_from("<f", d, o)[0]

typeids = [0x18f98ae0, 0x189af180]
if len(sys.argv) > 1:
    typeids.append(int(sys.argv[1], 16))

fd = os.open(f"/proc/{PID}/mem", os.O_RDONLY)
def read_mem(addr, sz):
    os.lseek(fd, addr, os.SEEK_SET)
    return os.read(fd, sz)

# Get anonymous rw-p regions (focus on 0x7cca* heap regions)
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

print(f"Scanning {len(regions)} regions for TypeIDs {[f'0x{t:08x}' for t in typeids]}...")

found = []
for typ in typeids:
    patt = struct.pack("<I", typ)
    for start, end in regions:
        chunk = 4 * 1024 * 1024
        for base in range(start, end, chunk):
            rsz = min(chunk, end - base)
            try:
                data = read_mem(base, rsz)
            except:
                continue
            off = 0
            while True:
                off = data.find(patt, off)
                if off == -1: break
                addr = base + off
                
                # Validate: Entity* +0x10, GO* +0x18 must be valid heap pointers
                e = u64(data, off + 0x10)
                g = u64(data, off + 0x18)
                if not (e > 0x7cc000000000 and e < 0x7cf000000000 and
                        g > 0x7cc000000000 and g < 0x7cf000000000):
                    off += 4
                    continue
                
                # Verify GO has valid ID
                go_id_addr = g
                if go_id_addr >= base and go_id_addr < base + len(data):
                    goid = u32(data, go_id_addr - base + 0x10)
                else:
                    try:
                        gd = read_mem(go_id_addr, 0x14)
                        goid = u32(gd, 0x10)
                    except:
                        goid = -1
                
                if goid <= 0 or goid >= 50000:
                    off += 4
                    continue
                
                # Read coords
                if off + 0xFC <= len(data):
                    x, y, z = flt(data, off+0xF0), flt(data, off+0xF4), flt(data, off+0xF8)
                else:
                    try:
                        cd = read_mem(addr + 0xF0, 12)
                        x, y, z = flt(cd, 0), flt(cd, 4), flt(cd, 8)
                    except:
                        x = y = z = 0
                
                found.append((addr, typ, goid, x, y, z, e, g))
                off += 4

os.close(fd)

print(f"\nFound {len(found)} valid components:")
for addr, typ, goid, x, y, z, e, g in sorted(found, key=lambda f: abs(f[3]-HERO1_X)+abs(f[4]-HERO1_Y)):
    dist = ((x-HERO1_X)**2 + (y-HERO1_Y)**2)**0.5
    near = " <-- NEAR" if dist < 30 else ""
    print(f"  MC={addr:#014x} type=0x{typ:08x} ID={goid} X={x:.1f} Y={y:.1f} Z={z:.1f}{near}")
