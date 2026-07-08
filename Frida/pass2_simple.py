import os, struct, time

PID = 10994
PROC_MEM = "/proc/aor_mem"
ADDRS = [0x7992E1CA7050, 0x7992E7DCF630, 0x7992ED103380,
         0x799323F0B800, 0x79932A3954B0, 0x79933C7980D0,
         0x79941BC29030]

def read_mem(addr, size):
    with open(PROC_MEM, 'w') as f:
        f.write(f"{PID} 0x{addr:x} {size}")
    with open(PROC_MEM, 'rb') as f:
        return f.read(size)

# Snapshot 1
snap1 = {}
for a in ADDRS:
    raw = read_mem(a, 12)
    x, y, z = struct.unpack('<fff', raw)
    snap1[a] = (x, y, z)
    print(f"T1 0x{a:x}  X={x:.2f} Y={y:.2f} Z={z:.2f}")

print("\n[PASS2] Walk now! Waiting 8 seconds...", flush=True)
time.sleep(8)

# Snapshot 2
changed = []
for a in ADDRS:
    raw = read_mem(a, 12)
    x, y, z = struct.unpack('<fff', raw)
    x1, y1, z1 = snap1[a]
    dx = abs(x - x1)
    dy = abs(y - y1)
    print(f"T2 0x{a:x}  X={x:.2f} Y={y:.2f} Z={z:.2f}  diff=({dx:.2f},{dy:.2f})")
    if dx > 0.5 or dy > 0.5:
        changed.append(a)

print(f"\nChanged ({len(changed)}):")
for a in changed:
    print(f"  0x{a:x}  T1=({snap1[a][0]:.2f},{snap1[a][1]:.2f}) -> T2=({struct.unpack('<fff', read_mem(a,12))[0]:.2f},{struct.unpack('<fff', read_mem(a,12))[1]:.2f})")
