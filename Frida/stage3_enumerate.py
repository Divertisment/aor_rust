#!/usr/bin/env python3
"""
stage3_enumerate.py — Find all MonoBehaviours via Level2 reverse tracing.

Chain: MC (+0xA0) → Level1 (+0x40) → Level2 (+0x10) → StringTable
                              (+0x18) → StringTable

Strategy:
  1. Scan anonymous heap regions for Level2 address (0x1788d980) → finds Level1
  2. Scan for MC type patterns (0x18f98ae0, 0x189af180) → finds MC candidates
  3. Cross-reference: valid MC has +0xA0 pointing to a discovered Level1
  4. Print all validated entities with coordinates
"""

import struct
import sys
import os
import time

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 25355

LEVEL2_ADDR = 0x1788d980  # Level2 structure address (class metadata)
LEVEL2_TYPE = 0x17458d18   # Type at Level2+0x00
LEVEL1_TYPE = 0x182e0440   # Type at Level1+0x00
MC_TYPES = [0x18f98ae0, 0x189af180]

LEVEL2_PATTERN  = struct.pack('<Q', LEVEL2_ADDR)   # 8-byte pattern for Level2
MC_PATTERNS     = {t: struct.pack('<I', t) for t in MC_TYPES}

CHUNK_SIZE = 16 * 1024 * 1024  # 16 MB chunks


def get_anon_regions(pid):
    regions = []
    with open(f'/proc/{pid}/maps') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            addr_range, perms, offset, dev, inode = parts[:5]
            if inode != '0':
                continue
            if 'w' not in perms or 'r' not in perms:
                continue
            start_s, end_s = addr_range.split('-')
            start, end = int(start_s, 16), int(end_s, 16)
            size = end - start
            if size >= 256 * 1024:
                regions.append((start, end, size))
    return regions


def scan_chunk(data, base_addr, pattern, pattern_len):
    hits = []
    pos = 0
    while True:
        pos = data.find(pattern, pos)
        if pos == -1:
            break
        hits.append(base_addr + pos)
        pos += 1
    return hits


def read_at(fd, addr, size):
    try:
        os.lseek(fd, addr, os.SEEK_SET)
        return os.read(fd, size)
    except (OSError, PermissionError):
        return b''


def read_u32(data, offset):
    return struct.unpack_from('<I', data, offset)[0] if offset + 4 <= len(data) else 0


def read_u64(data, offset):
    return struct.unpack_from('<Q', data, offset)[0] if offset + 8 <= len(data) else 0


def read_float(data, offset):
    return struct.unpack_from('<f', data, offset)[0] if offset + 4 <= len(data) else 0.0


def main():
    print(f"[*] Enumerating entities — PID {PID}")
    t0 = time.time()

    regions = get_anon_regions(PID)
    total_mb = sum(r[2] for r in regions) / 1048576
    print(f"[*] Anonymous rw- regions: {len(regions)}, total {total_mb:.0f} MB")

    mem_path = f'/proc/{PID}/mem'
    fd = os.open(mem_path, os.O_RDONLY)

    # ── Pass 1: find all Level1 structures via Level2 ──
    print("\n[*] Pass 1: scanning for Level2 address (0x%x)..." % LEVEL2_ADDR)
    level1_set = set()
    level1_by_region = {}

    for start, end, size in regions:
        addr = start
        while addr < end:
            chunk = read_at(fd, addr, min(CHUNK_SIZE, end - addr))
            if not chunk:
                break
            hits = scan_chunk(chunk, addr, LEVEL2_PATTERN, 8)
            for hit_addr in hits:
                l1 = hit_addr - 0x40  # Level1+0x40 == Level2
                # Verify Level1 type
                l1_data = read_at(fd, l1, 8)
                if len(l1_data) >= 4:
                    l1_type = read_u32(l1_data, 0)
                    if l1_type == LEVEL1_TYPE:
                        if l1 not in level1_set:
                            level1_set.add(l1)
                            # Track region for this Level1
                            rk = (start, end)
                            level1_by_region.setdefault(rk, []).append(l1)
            addr += CHUNK_SIZE

        # Progress
        pct = (addr - start) / size * 100
        print(f"    region 0x{start:x}-0x{end:x} ({size/1048576:.0f} MB): {len(level1_set)} Level1 so far", end='\r')
    print()

    print(f"\n[*] Found {len(level1_set)} valid Level1 structures")
    for l1 in sorted(level1_set):
        print(f"    Level1: 0x{l1:016x}")

    # ── Pass 2: scan for MC type patterns ──
    print("\n[*] Pass 2: scanning for MC type patterns (%s)..." %
          ', '.join(f'0x{t:08x}' for t in MC_TYPES))

    mc_candidates = {}  # mc_addr -> {type, level1, entity, go, coords}

    for start, end, size in regions:
        addr = start
        while addr < end:
            chunk = read_at(fd, addr, min(CHUNK_SIZE, end - addr))
            if not chunk:
                break
            for mc_type, mc_pattern in MC_PATTERNS.items():
                hits = scan_chunk(chunk, addr, mc_pattern, 4)
                for ha in hits:
                    mc_data = read_at(fd, ha, 0x100)
                    if len(mc_data) < 0xF8:
                        continue

                    # Level1 at +0xA0
                    l1_ptr = read_u64(mc_data, 0xA0)
                    if l1_ptr not in level1_set:
                        continue

                    # Validate Level1 → Level2 chain
                    l1_data = read_at(fd, l1_ptr, 8)
                    if len(l1_data) < 4 or read_u32(l1_data, 0) != LEVEL1_TYPE:
                        continue
                    l2_data = read_at(fd, l1_ptr + 0x40, 4)
                    if len(l2_data) < 4 or read_u32(l2_data, 0) != LEVEL2_TYPE:
                        continue

                    # Valid! Read entity info
                    entity_ptr = read_u64(mc_data, 0x10)
                    go_ptr = read_u64(mc_data, 0x18)
                    x = read_float(mc_data, 0xF0)
                    y = read_float(mc_data, 0xF4)
                    z = read_float(mc_data, 0xF8)

                    # Skip zero/trash coords
                    if abs(x) < 0.001 and abs(y) < 0.001:
                        continue
                    if not (-10000 < x < 10000 and -10000 < y < 10000 and -100 < z < 1000):
                        continue

                    # Get GO ID if possible
                    go_id = -1
                    if go_ptr > 0x700000000000:
                        go_data = read_at(fd, go_ptr, 0x18)
                        if len(go_data) >= 0x14:
                            go_id = read_u32(go_data, 0x10)

                    mc_candidates[ha] = {
                        'type': mc_type,
                        'level1': l1_ptr,
                        'entity': entity_ptr,
                        'go': go_ptr,
                        'go_id': go_id,
                        'x': x, 'y': y, 'z': z,
                    }
            addr += CHUNK_SIZE

        pct = (addr - start) / size * 100
        print(f"    region 0x{start:x}-0x{end:x}: {len(mc_candidates)} MC so far", end='\r')
    print()

    os.close(fd)

    # ── Print results ──
    print(f"\n{'='*90}")
    print(f"{'#':>3} {'MC Address':>18} {'Type':>12} {'ID':>6} {'X':>10} {'Y':>10} {'Z':>8} {'Entity':>10}")
    print(f"{'='*90}")

    # Sort by distance from origin or by ID
    sorted_mcs = sorted(mc_candidates.items(), key=lambda kv: kv[1]['go_id'])

    for i, (addr, info) in enumerate(sorted_mcs):
        print(f"{i:3d}  0x{addr:016x}  0x{info['type']:08x}  {info['go_id']:5d}  "
              f"{info['x']:8.2f}  {info['y']:8.2f}  {info['z']:6.2f}  "
              f"0x{info['entity']:016x}")

    print(f"\n[*] Total valid MCs: {len(mc_candidates)}")
    print(f"[*] Elapsed: {time.time() - t0:.1f}s")


if __name__ == '__main__':
    main()
