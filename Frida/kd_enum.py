#!/usr/bin/env python3
"""
kd_enum.py — Kernel-driver based entity enumeration.

Uses /proc/aor_mem for targeted reads (NOT full heap scan).

Strategy:
  1. From known MC addresses, walk linked lists
  2. Read entity structures, follow next pointers
  3. Collect all entities in the chain

Usage: sudo python3 kd_enum.py <PID> [MC_ADDR]
"""

import struct, os, sys

PROC_MEM = "/proc/aor_mem"


class KReader:
    def __init__(self, pid: int):
        self.pid = pid
        self.fd = os.open(PROC_MEM, os.O_RDWR)

    def read(self, addr: int, sz: int) -> bytes:
        os.write(self.fd, f"{self.pid} {addr:x} {sz}\n".encode())
        return os.read(self.fd, sz)

    def r8(self, a): return self.read(a, 8)
    def u32(self, a): return struct.unpack("<I", self.r8(a)[:4])[0]
    def u64(self, a): return struct.unpack("<Q", self.r8(a))[0]
    def flt(self, a): return struct.unpack("<f", self.r8(a)[:4])[0]
    def close(self): os.close(self.fd)


def walk_entity_chain(kr, start_entity):
    """Walk entity linked list from start_entity via +0x30."""
    entities = []
    seen = set()
    cur = start_entity
    while cur and cur not in seen and len(entities) < 200:
        seen.add(cur)
        try:
            vt = kr.u64(cur)
            comp = kr.u64(cur + 0x28)
            nxt = kr.u64(cur + 0x30)
            go = kr.u64(comp + 0x18) if 0x700000000000 < comp < 0x7ff000000000 else 0
            go_id = -1
            if 0x700000000000 < go < 0x7ff000000000:
                go_id = kr.u32(go + 0x10)
            x = kr.flt(comp + 0xF0) if comp else 0
            y = kr.flt(comp + 0xF4) if comp else 0
            z = kr.flt(comp + 0xF8) if comp else 0
            entities.append((cur, vt, comp, go, go_id, x, y, z))
            cur = nxt if 0x700000000000 < nxt < 0x7ff000000000 else 0
        except:
            break
    return entities


def main():
    pid = int(sys.argv[1])
    start_mc = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x7CCAE04DDA80

    kr = KReader(pid)

    # Read entity from MC+0x10
    entity = kr.u64(start_mc + 0x10)
    print(f"[*] MC: 0x{start_mc:x} → Entity: 0x{entity:x}")

    # Walk linked list
    ents = walk_entity_chain(kr, entity)
    print(f"\n{'='*100}")
    print(f"{'#':>3} {'Entity':>18} {'VTable':>18} {'ID':>5} {'X':>9} {'Y':>9} {'Z':>6}")
    print(f"{'='*100}")
    for i, (addr, vt, comp, go, go_id, x, y, z) in enumerate(ents):
        print(f"{i:3d}  0x{addr:016x}  0x{vt:016x}  {go_id:5d}  {x:8.2f} {y:8.2f} {z:6.2f}")
    print(f"\n[*] Total in chain: {len(ents)}")

    kr.close()


if __name__ == "__main__":
    main()
