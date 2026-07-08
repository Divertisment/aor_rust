"""Generic scanner: find ALL valid components by scanning for Z values in heap."""
import os, struct, math, sys

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 25355

def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def flt(d, o): return struct.unpack_from("<f", d, o)[0]

fd = os.open(f"/proc/{PID}/mem", os.O_RDONLY)
def readm(a, s):
    os.lseek(fd, a, os.SEEK_SET)
    return os.read(fd, s)

# Get heap regions
maps = open(f"/proc/{PID}/maps").read()
regions = []
for line in maps.split("\n"):
    if not line: continue
    parts = line.split()
    ar, perms = parts[0], parts[1]
    pathname = parts[5] if len(parts) > 5 else ""
    if not perms.startswith("rw"): continue
    if pathname and "heap" not in pathname and pathname != "": continue
    s, e = ar.split("-")
    start, end = int(s, 16), int(e, 16)
    if end - start > 0x10000 and start >= 0x7cca00000000:
        regions.append((start, end))

# Scan for each creature Z value + also scan generic valid Z floats
# First scan for Z values in [0, 50] range
print("Scanning for all valid components...")
found = {}
chunk = 4 * 1024 * 1024
scanned_mb = 0

for start, end in regions:
    for base in range(start, end, chunk):
        rsz = min(chunk, end - base)
        scanned_mb += rsz
        try:
            data = readm(base, rsz)
        except:
            continue
        
        # Quick scan: look for any component by checking Entity pointer pattern
        # at offset 0x10 from 4-byte aligned addresses
        for off in range(0, len(data) - 0x100, 4):
            typ = u32(data, off)
            if typ == 0 or typ == 0xFFFFFFFF: continue
            
            e = u64(data, off + 0x10)
            g = u64(data, off + 0x18)
            if not (e > 0x7cc000000000 and e < 0x7cf000000000 and
                    g > 0x7cc000000000 and g < 0x7cf000000000):
                continue
            
            if off + 0xFC >= len(data): continue
            x = flt(data, off + 0xF0)
            y = flt(data, off + 0xF4)
            z = flt(data, off + 0xF8)
            if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
                continue
            if abs(x) > 100000 or abs(y) > 100000 or abs(z) > 1000:
                continue
            if z < 0 or z > 200: continue
            
            # Validate GO ID
            if g >= base and g < base + len(data):
                goid = u32(data, g - base + 0x10)
            else:
                try:
                    gd = readm(g, 0x14)
                    goid = u32(gd, 0x10)
                except:
                    goid = -1
            if goid <= 0 or goid >= 50000: continue
            
            addr = base + off
            if addr not in found:
                found[addr] = (typ, goid, x, y, z, e, g)

os.close(fd)
print(f"Scanned {scanned_mb/(1024*1024):.0f} MB, found {len(found)} valid components")

# Group by TypeID
by_type = {}
for addr, (typ, goid, x, y, z, e, g) in found.items():
    by_type.setdefault(typ, []).append((addr, goid, x, y, z, e, g))

print(f"\nUnique TypeIDs: {len(by_type)}")
for typ in sorted(by_type.keys()):
    entries = by_type[typ][:5]  # First 5 per type
    label = ""
    if typ == 0x18f98ae0: label = " (LocalPlayer)"
    elif typ == 0x189af180: label = " (Creature)"
    elif typ == 0x18f0cc90: label = " (RemotePlayer)"
    print(f"\n  type=0x{typ:08x}{label} — {len(by_type[typ])} instances:")
    for addr, goid, x, y, z, e, g in entries:
        print(f"    MC={addr:#014x} ID={goid} X={x:>8.1f} Y={y:>7.1f} Z={z:>5.1f}")
