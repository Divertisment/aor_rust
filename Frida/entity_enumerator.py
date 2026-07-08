#!/usr/bin/env python3
"""
entity_enumerator.py — Enumerate all entities via /proc/aor_mem kernel driver.

Strategy:
  1. Load known Component TypeIDs from config
  2. For each anonymous rw- region, scan for TypeIDs
  3. For each match, validate Entity+GO chain
  4. Read coordinates and entity ID
  5. Print table

Usage: sudo python3 entity_enumerator.py <PID>
"""

import struct
import sys
import os
import time

PROC_MEM = "/proc/aor_mem"

# Known component types
KNOWN_TYPES = {
    0x18f98ae0: "PlayerMC",
    0x189af180: "CreatureMC",
}

# Structure offsets (verified)
COMPONENT = {
    "entity": 0x10,
    "go":     0x18,
    "level1": 0xA0,
    "x":      0xF0,
    "y":      0xF4,
    "z":      0xF8,
}

ENTITY = {
    "vtable":   0x00,
    "component":0x28,
    "next":     0x30,
}

GO = {
    "id":  0x10,
    "x":   0x3C,
    "y":   0x40,
}

CHUNK = 16 * 1024 * 1024  # 16MB reads


class KernelReader:
    def __init__(self, pid: int):
        self.pid = pid
        self.fd = os.open(PROC_MEM, os.O_RDWR)

    def _req(self, addr: int, length: int) -> bytes:
        req = f"{self.pid} {addr:x} {length}\n".encode()
        os.write(self.fd, req)
        return os.read(self.fd, length)

    def read(self, addr: int, length: int) -> bytes:
        return self._req(addr, length)

    def read_u32(self, addr: int) -> int:
        return struct.unpack_from("<I", self.read(addr, 4))[0]

    def read_u64(self, addr: int) -> int:
        return struct.unpack_from("<Q", self.read(addr, 8))[0]

    def read_float(self, addr: int) -> float:
        return struct.unpack_from("<f", self.read(addr, 4))[0]

    def close(self):
        os.close(self.fd)


def get_anon_regions(pid):
    regions = []
    with open(f"/proc/{pid}/maps") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            ar, perm, off, dev, inode = parts[:5]
            if inode != "0" or "w" not in perm or "r" not in perm:
                continue
            s, e = ar.split("-")
            start, end = int(s, 16), int(e, 16)
            if 0x700000000000 <= start < 0x7ff000000000 and end - start >= 256 * 1024:
                regions.append((start, end))
    return regions


def scan_type(kr, region, type_id, type_name):
    """Scan region for a 4-byte TypeID, validate and collect entities."""
    pat = struct.pack("<I", type_id)
    results = []

    addr = region[0]
    end = region[1]
    while addr < end:
        sz = min(CHUNK, end - addr)
        data = kr.read(addr, sz)
        if not data:
            break
        pos = 0
        while True:
            pos = data.find(pat, pos)
            if pos == -1:
                break
            comp_addr = addr + pos

            # Validate: check Entity pointer at +0x10
            if pos + 0x20 > len(data):
                pos += 1
                continue
            entity_ptr = struct.unpack_from("<Q", data, pos + 0x10)[0]
            if not (0x700000000000 < entity_ptr < 0x7ff000000000):
                pos += 1
                continue

            # Validate: check GO pointer at +0x18
            go_ptr = struct.unpack_from("<Q", data, pos + 0x18)[0]
            if not (0x700000000000 < go_ptr < 0x7ff000000000):
                pos += 1
                continue

            # Read GO ID
            go_data = kr.read(go_ptr, 0x44)
            if len(go_data) < 0x44:
                pos += 1
                continue
            go_id = struct.unpack_from("<i", go_data, 0x10)[0]
            if go_id <= 0 or go_id > 50000:
                pos += 1
                continue

            # Read coords
            x = struct.unpack_from("<f", data, pos + 0xF0)[0]
            y = struct.unpack_from("<f", data, pos + 0xF4)[0]
            z = struct.unpack_from("<f", data, pos + 0xF8)[0]

            if not (-10000 < x < 10000 and -10000 < y < 10000 and -100 < z < 1000):
                pos += 1
                continue
            if abs(x) < 0.001 and abs(y) < 0.001:
                pos += 1
                continue

            # Read Level1 at +0xA0 for additional validation
            l1_ptr = struct.unpack_from("<Q", data, pos + 0xA0)[0]
            l1_valid = 0x700000000000 < l1_ptr < 0x7ff000000000

            go_x = struct.unpack_from("<f", go_data, 0x3C)[0]
            go_y = struct.unpack_from("<f", go_data, 0x40)[0]

            results.append({
                "comp_addr": comp_addr,
                "type_id": type_id,
                "type_name": type_name,
                "entity_ptr": entity_ptr,
                "go_ptr": go_ptr,
                "go_id": go_id,
                "x": x, "y": y, "z": z,
                "go_x": go_x, "go_y": go_y,
                "l1_ptr": l1_ptr if l1_valid else 0,
            })

            pos += 1
        addr += CHUNK

    return results


def main():
    pid = int(sys.argv[1])
    print(f"[*] Enumerating entities via kernel driver — PID {pid}")
    t0 = time.time()

    regions = get_anon_regions(pid)
    total_mb = sum(e - s for s, e in regions) / 1048576
    print(f"[*] Anonymous regions: {len(regions)} ({total_mb:.0f} MB)")

    kr = KernelReader(pid)

    all_entities = []
    scanned_mb = 0

    for region in regions:
        for type_id, type_name in KNOWN_TYPES.items():
            hits = scan_type(kr, region, type_id, type_name)
            all_entities.extend(hits)
        scanned_mb += (region[1] - region[0]) / 1048576

    kr.close()

    # Deduplicate by component address
    seen = set()
    unique = []
    for e in all_entities:
        if e["comp_addr"] not in seen:
            seen.add(e["comp_addr"])
            unique.append(e)

    unique.sort(key=lambda e: e["go_id"])

    print(f"\n{'='*110}")
    hdr = f"{'#':>3} {'Type':>12} {'ID':>5} {'X':>10} {'Y':>10} {'Z':>7}  {'GO_X':>8} {'GO_Y':>8}  {'Component':>18}"
    print(hdr)
    print(f"{'='*110}")

    player_pos = None
    nearby = []
    for i, e in enumerate(unique):
        print(f"{i:3d}  0x{e['type_id']:08x} {e['go_id']:5d}  {e['x']:8.2f}  {e['y']:8.2f}  {e['z']:6.2f}  "
              f"{e['go_x']:8.2f} {e['go_y']:8.2f}  0x{e['comp_addr']:016x}")
        if e['type_id'] == 0x18f98ae0:
            player_pos = (e['x'], e['y'])
        else:
            if player_pos:
                dx = e['x'] - player_pos[0]
                dy = e['y'] - player_pos[1]
                dist = (dx*dx + dy*dy) ** 0.5
                nearby.append((dist, e))

    print(f"\n[*] Total valid entities: {len(unique)}")
    print(f"[*] Scanned: {scanned_mb:.0f} MB in {time.time()-t0:.1f}s")

    if player_pos and nearby:
        nearby.sort()
        print(f"\n[*] Nearest creatures to player (X={player_pos[0]:.1f}, Y={player_pos[1]:.1f}):")
        for dist, e in nearby[:10]:
            print(f"    ID={e['go_id']:4d}  dist={dist:6.1f}  X={e['x']:8.2f} Y={e['y']:8.2f}  type={e['type_name']}")


if __name__ == "__main__":
    main()
