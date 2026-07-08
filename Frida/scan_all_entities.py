"""Comprehensive entity scanner — finds all known component types on the map.

Usage: echo PASSWORD | sudo -S python3 scan_all_entities.py [PID]

Scans heap for all known TypeIDs and reports entities with valid coordinates.
"""
import os
import struct
import math
import sys

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 25355

# Known TypeIDs
TYPES = {
    0x18f98ae0: "LocalPlayer",
    0x189af180: "Creature",
    0x18f0cc90: "RemotePlayer",
}

def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def flt(d, o): return struct.unpack_from("<f", d, o)[0]

fd = os.open(f"/proc/{PID}/mem", os.O_RDONLY)
def read_mem(addr, sz):
    os.lseek(fd, addr, os.SEEK_SET)
    return os.read(fd, sz)

# Get anonymous rw-p heap regions
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
    if end - start > 0x10000 and start >= 0x7cc000000000:
        regions.append((start, end, pathname or "anon"))

all_found = []
for typ, label in TYPES.items():
    patt = struct.pack("<I", typ)
    count = 0
    for start, end, name in regions:
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
                e = u64(data, off + 0x10)
                g = u64(data, off + 0x18)
                if not (e > 0x7cc000000000 and e < 0x7cf000000000 and
                        g > 0x7cc000000000 and g < 0x7cf000000000):
                    off += 4
                    continue
                # Verify GO ID
                if g >= base and g < base + len(data):
                    goid = u32(data, g - base + 0x10)
                else:
                    try:
                        gd = read_mem(g, 0x14)
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
                all_found.append((addr, typ, goid, x, y, z, e, g, label))
                count += 1
                off += 4
    print(f"[{label}] type=0x{typ:08x}: {count} instances")

os.close(fd)

if not all_found:
    print("\nNo entities found.")
    sys.exit(0)

# Print sorted by distance from player
player = [f for f in all_found if f[1] == 0x18f98ae0]
if player:
    px, py = player[0][3], player[0][4]
    print(f"\nPlayer at X={px:.1f} Y={py:.1f} Z={player[0][5]:.1f}")
    all_found.sort(key=lambda f: ((f[3]-px)**2 + (f[4]-py)**2)**0.5)
    print(f"\nAll entities (sorted by distance from player):")
else:
    print(f"\nAll entities:")
    all_found.sort(key=lambda f: f[2])

for addr, typ, goid, x, y, z, e, g, label in all_found:
    dist = ""
    if player:
        d = ((x-px)**2 + (y-py)**2)**0.5
        dist = f" dist={d:.1f}"
    print(f"  ID={goid:5d} {label:12s} MC={addr:#014x} X={x:>8.1f} Y={y:>7.1f} Z={z:>5.1f}{dist}")
