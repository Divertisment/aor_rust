"""Find ALL entities by scanning for the entity vtable in heap."""
import os, struct, math, sys

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 25355
VTABLE = 0x7ccd7aa2d080  # Entity vtable

def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def flt(d, o): return struct.unpack_from("<f", d, o)[0]

# Read GameAssembly.so base from maps to verify vtable hasn't changed
maps = open(f"/proc/{PID}/maps").read()
asm_base = None
for line in maps.split("\n"):
    if "GameAssembly" in line and "r-xp" in line:
        asm_base = int(line.split("-")[0], 16)
        break
print(f"GameAssembly base: {asm_base:#x}")

vtable_bytes = struct.pack("<Q", VTABLE)

fd = os.open(f"/proc/{PID}/mem", os.O_RDONLY)
def readm(a, s):
    os.lseek(fd, a, os.SEEK_SET)
    return os.read(fd, s)

# Get anonymous rw-p heap regions
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
    if end - start > 0x10000:
        regions.append((start, end, pathname or "anon"))

print(f"Scanning {len(regions)} regions for entity vtable 0x{VTABLE:x}...")

entities = []
chunk = 4 * 1024 * 1024
for start, end, name in regions:
    for base in range(start, end, chunk):
        rsz = min(chunk, end - base)
        try:
            data = readm(base, rsz)
        except:
            continue
        
        off = 0
        while True:
            off = data.find(vtable_bytes, off)
            if off == -1: break
            addr = base + off
            
            # Entity: +0x28 = component*, +0x30 = next*
            if off + 0x40 > len(data):
                off += 1
                continue
            comp = u64(data, off + 0x28)
            nxt = u64(data, off + 0x30)
            fl = u64(data, off + 0x38)
            
            if not (comp > 0x7cc000000000 and comp < 0x7cf000000000):
                off += 1
                continue
            if not (nxt == 0 or (nxt > 0x7cc000000000 and nxt < 0x7cf000000000)):
                off += 1
                continue
            
            # Read component
            if comp >= base and comp < base + len(data):
                cd = data[comp - base:comp - base + 0x100]
                full_cd = True
            else:
                try:
                    cd = readm(comp, 0x100)
                    full_cd = True
                except:
                    cd = b""
                    full_cd = False
            
            if full_cd and len(cd) >= 0xFC:
                ct = u32(cd, 0)
                go = u64(cd, 0x18)
                x = flt(cd, 0xF0)
                y = flt(cd, 0xF4)
                z = flt(cd, 0xF8)
                
                if math.isfinite(x) and abs(x) < 100000 and math.isfinite(z):
                    goid = -1
                    if go > 0x7cc000000000 and go < 0x7cf000000000:
                        try:
                            gd = readm(go, 0x14)
                            goid = u32(gd, 0x10)
                        except:
                            pass
                    entities.append((addr, comp, ct, goid, x, y, z, nxt, fl))
            
            off += 1

os.close(fd)

print(f"\nFound {len(entities)} entities:")
for addr, comp, ct, goid, x, y, z, nxt, fl in entities:
    label = ""
    if ct == 0x18f98ae0: label = "LocalPlayer"
    elif ct == 0x189af180: label = "Creature"
    elif ct == 0x18f0cc90: label = "RemotePlayer"
    print(f"  Entity={addr:#014x} comp={comp:#014x} type=0x{ct:08x} {label:12s} ID={goid} X={x:>8.1f} Y={y:>7.1f} Z={z:>5.1f}")
