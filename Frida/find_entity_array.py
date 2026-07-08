#!/usr/bin/env python3
"""
find_entity_array.py — Search GameAssembly.so code/data for global entity array patterns.

Strategy:
  1. Scan GameAssembly.so .data/.rdata for references to known entity MC addresses
  2. If found, check if nearby data looks like an array of entity pointers
  3. Scan .text for code patterns that iterate over entity arrays
  4. Generate AOB signatures for kernel driver use
"""

import struct
import sys
import os
import time

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 25355

# Known addresses (from current session)
PLAYER_MC      = 0x7CCAE04DDA80
PLAYER_ENTITY  = 0x7CCD2CA49A00
SQUIRREL_MC    = 0x7CCADE5B3000
SQUIRREL_ENTITY = 0x7CCAF1FFAB60
ENTITY_VTABLE  = 0x7CCD7AA2D080
SQUIRREL_MC2   = 0x7CCADB2F2A80  # ID=519
LEVEL2_ADDR    = 0x1788D980

CHUNK_SIZE = 64 * 1024 * 1024  # 64MB


def get_module_sections(pid):
    """Parse /proc/pid/maps, return named regions belonging to GameAssembly.so."""
    sections = {}
    with open(f'/proc/{pid}/maps') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 6:
                continue
            addr_range, perms, offset_s, dev, inode, path = parts[:6]
            if 'GameAssembly.so' not in path:
                continue
            start, end = addr_range.split('-')
            start, end = int(start, 16), int(end, 16)
            offset = int(offset_s, 16)
            size = end - start
            label = f"{offset:08x}-{path}"
            sections[label] = {
                'start': start, 'end': end, 'size': size,
                'offset': offset, 'perms': perms, 'path': path
            }
    return sections


def read_at(fd, addr, size):
    try:
        os.lseek(fd, addr, os.SEEK_SET)
        return os.read(fd, size)
    except (OSError, PermissionError):
        return b''


def scan_for_pattern(fd, start, size, pattern, name=""):
    """Scan memory region for a byte pattern, return list of absolute addresses."""
    hits = []
    addr = start
    while addr < start + size:
        chunk = read_at(fd, addr, min(CHUNK_SIZE, start + size - addr))
        if not chunk:
            break
        pos = 0
        while True:
            pos = chunk.find(pattern, pos)
            if pos == -1:
                break
            hits.append(addr + pos)
            pos += 1
        addr += CHUNK_SIZE
    return hits


def search_address_references(fd, region, target_addr, label):
    """Search a memory region for 8-byte pointer values matching target_addr."""
    pattern = struct.pack('<Q', target_addr)
    hits = scan_for_pattern(fd, region['start'], region['size'], pattern, label)
    return hits


def dump_surrounding(fd, addr, context=32):
    """Dump hex + ASCII around an address."""
    data = read_at(fd, addr - context, context * 2)
    if not data:
        return ""
    lines = []
    for i in range(0, len(data), 16):
        chunk = data[i:i+16]
        hex_str = ' '.join(f'{b:02x}' for b in chunk)
        ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        lines.append(f"  0x{addr - context + i:016x}: {hex_str:<48s}  {ascii_str}")
    return '\n'.join(lines)


def main():
    t0 = time.time()
    sections = get_module_sections(PID)

    print(f"[*] GameAssembly.so sections for PID {PID}:")
    for label, sec in sorted(sections.items()):
        mb = sec['size'] / 1048576
        print(f"    {sec['start']:016x}-{sec['end']:016x} {sec['perms']:5s} "
              f"offset={sec['offset']:08x}  {mb:7.1f} MB  {sec['path']}")

    fd = os.open(f'/proc/{PID}/mem', os.O_RDONLY)

    targets = [
        ('Player MC', PLAYER_MC),
        ('Player Entity', PLAYER_ENTITY),
        ('Squirrel MC #1', SQUIRREL_MC),
        ('Squirrel Entity #1', SQUIRREL_ENTITY),
        ('Squirrel MC #2 (ID=519)', SQUIRREL_MC2),
        ('Entity VTable', ENTITY_VTABLE),
    ]

    for name, addr in targets:
        print(f"\n{'='*80}")
        print(f"[*] Searching for '{name}' = 0x{addr:016x}")
        print(f"{'='*80}")

        for label, sec in sorted(sections.items()):
            if 'r' not in sec['perms']:
                continue
            hits = search_address_references(fd, sec, addr, label)
            if hits:
                print(f"  [{sec['perms']}] {sec['start']:016x}-{sec['end']:016x} "
                      f"({sec['size']/1048576:.1f} MB): {len(hits)} hit(s)")
                # Show context for first 3 hits
                for i, ha in enumerate(hits[:3]):
                    print(f"\n  Hit #{i+1} at 0x{ha:016x}:")
                    print(dump_surrounding(fd, ha, 24))
            else:
                print(f"  [{sec['perms']}] — no hits")

    os.close(fd)
    print(f"\n[*] Elapsed: {time.time() - t0:.1f}s")


if __name__ == '__main__':
    main()
