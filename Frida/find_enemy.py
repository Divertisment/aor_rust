"""Find enemy player by scanning for valid components near known player position.

Strategy: scan for Z=8.0 (player's current Z level), validate component structure,
report any unknown TypeIDs near the player.
"""
import os
import struct
import math

PID = 25355
PLAYER_Z = 8.0  # Current player Z from scan
PATT = struct.pack("<f", PLAYER_Z)

def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def flt(d, o): return struct.unpack_from("<f", d, o)[0]

fd = os.open(f"/proc/{PID}/mem", os.O_RDONLY)
def read_mem(addr, sz):
    os.lseek(fd, addr, os.SEEK_SET)
    return os.read(fd, sz)

# Get anonymous rw-p regions
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
    if end - start > 0x10000 and start >= 0x7cca00000000:
        regions.append((start, end))

print(f"Scanning {len(regions)} regions for Z={PLAYER_Z}...")

known_types = {0x18f98ae0: 'player', 0x189af180: 'creature'}
found = {}
by_id = {}

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
            off = data.find(PATT, off)
            if off == -1: break

            mc_base = base + off - 0xF8
            if off < 0xF8 or mc_base < start:
                off += 4
                continue

            type_off = off - 0xF8
            if type_off + 0x20 > len(data):
                off += 4
                continue

            typ = u32(data, type_off)
            if typ == 0 or typ == 0xFFFFFFFF:
                off += 4
                continue

            ent = u64(data, type_off + 0x10)
            go = u64(data, type_off + 0x18)
            if not (ent > 0x7cc000000000 and ent < 0x7cf000000000 and
                    go > 0x7cc000000000 and go < 0x7cf000000000):
                off += 4
                continue

            x = flt(data, type_off + 0xF0)
            y = flt(data, type_off + 0xF4)
            if not (math.isfinite(x) and math.isfinite(y)):
                off += 4
                continue
            if abs(x) > 10000 or abs(y) > 10000:
                off += 4
                continue

            # Read GO ID
            if go >= base and go < base + len(data):
                goid = u32(data, go - base + 0x10)
            else:
                try:
                    gd = read_mem(go, 0x14)
                    goid = u32(gd, 0x10)
                except:
                    goid = -1
            if goid <= 0 or goid >= 50000:
                off += 4
                continue

            if typ not in found:
                found[typ] = []
            found[typ].append((mc_base, goid, x, y, ent, go))
            by_id[goid] = (mc_base, typ, x, y)
            off += 4

os.close(fd)

# Report by TypeID
print(f"\nFound {len(found)} unique TypeIDs at Z={PLAYER_Z}:")
for typ in sorted(found.keys()):
    label = known_types.get(typ, 'UNKNOWN')
    entries = found[typ]
    # Deduplicate by address (same MC may appear multiple times from overlaps)
    unique = {}
    for mc, goid, x, y, ent, go in entries:
        unique[mc] = (goid, x, y, ent, go)
    print(f"\n  TypeID 0x{typ:08x} ({label}) — {len(unique)} instances:")
    for mc in sorted(unique.keys()):
        goid, x, y, ent, go = unique[mc]
        print(f"    MC={mc:#014x} ID={goid} X={x:.1f} Y={y:.1f}")

# Report by proximity to player (ID=533)
player_id = 533
if player_id in by_id:
    px, py = by_id[player_id][2], by_id[player_id][3]
    print(f"\nPlayer at X={px:.1f} Y={py:.1f}")
    near = [(goid, mc, typ, x, y, ((x-px)**2+(y-py)**2)**0.5)
            for goid, (mc, typ, x, y) in by_id.items()
            if goid != player_id]
    near.sort(key=lambda e: e[5])
    print("\nEntities sorted by distance from player:")
    for goid, mc, typ, x, y, dist in near[:20]:
        label = known_types.get(typ, 'UNKNOWN')
        print(f"  ID={goid} type=0x{typ:08x} ({label}) X={x:.1f} Y={y:.1f} dist={dist:.1f}")
