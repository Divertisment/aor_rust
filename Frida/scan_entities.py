#!/usr/bin/env python3
"""
scan_entities.py — Entity enumeration via Frida + kernel driver.

Usage:
  sudo python3 scan_entities.py <PID> [--driver-only]

Uses Frida for bulk scanning (TypeID patterns), kernel driver for targeted reads.
Outputs JSON Lines for the C# client or kernel driver integration.

Requires: aor_mem.ko loaded, Frida attached to game process.
"""

import struct
import os
import sys
import json
import time

PROC_MEM = "/proc/aor_mem"

# === Frida-based scanning (discovery) ===
FRIDA_SCRIPT = """
'use strict';

const TYPES = %s;  // [type_id, ...]
const RANGES = Process.enumerateRanges('rw-').filter(r =>
    r.size >= 256*1024 && r.base.compare(ptr('0x700000000000')) >= 0);

function scan() {
    const results = [];
    for (const t of TYPES) {
        const ty = t[0];
        // Build 4-byte little-endian hex pattern from type ID
        const hexPat = [
            (ty        & 0xFF).toString(16).padStart(2,'0'),
            ((ty>>8)   & 0xFF).toString(16).padStart(2,'0'),
            ((ty>>16)  & 0xFF).toString(16).padStart(2,'0'),
            ((ty>>24)  & 0xFF).toString(16).padStart(2,'0'),
        ].join(' ');

        for (const r of RANGES) {
            try {
                const hits = Memory.scanSync(r.base, r.size, hexPat);
                for (const h of hits) {
                    const a = h.address;
                    const ent = a.add(0x10).readU64();
                    const go = a.add(0x18).readU64();
                    if (ent > 0x700000000000 && go > 0x700000000000) {
                        const id = ptr(go).add(0x10).readS32();
                        if (id > 0 && id < 50000) {
                            const x = a.add(0xF0).readFloat();
                            const y = a.add(0xF4).readFloat();
                            if (isFinite(x) && Math.abs(x) < 10000 && Math.abs(x) > 0.1) {
                                const z = a.add(0xF8).readFloat();
                                results.push({
                                    mc: a.toString(),
                                    type: t[0],
                                    type_name: t[1],
                                    entity: '0x' + ent.toString(16),
                                    go: '0x' + go.toString(16),
                                    id: id,
                                    x: x, y: y, z: z
                                });
                            }
                        }
                    }
                }
            } catch(e) {}
        }
    }
    return results;
}

rpc.exports = { scan: scan };
"""


def get_pid_by_name(name):
    for d in os.listdir('/proc'):
        if d.isdigit():
            try:
                with open(f'/proc/{d}/comm') as f:
                    if f.read().strip() == name:
                        return int(d)
            except:
                pass
    return None


def frida_scan(pid, types):
    """Use Frida to scan for TypeIDs in game memory."""
    import frida
    session = frida.attach(pid)
    script = session.create_script(FRIDA_SCRIPT % json.dumps(types))
    script.load()
    results = script.exports_sync.scan()
    session.detach()
    return results


# === Kernel driver reads (verification) ===
class KReader:
    def __init__(self, pid):
        self.pid = pid

    def read(self, addr, sz):
        fd = os.open(PROC_MEM, os.O_RDWR)
        os.write(fd, f"{self.pid} {addr:x} {sz}\n".encode())
        data = os.read(fd, sz)
        os.close(fd)
        return data

    def entity(self, addr):
        d = self.read(addr, 0x38)
        if len(d) < 0x38:
            return None
        return {
            "vtable": struct.unpack("<Q", d[:8])[0],
            "component": struct.unpack("<Q", d[0x28:0x30])[0],
            "next": struct.unpack("<Q", d[0x30:0x38])[0],
        }

    def walk_list(self, start_entity, max_steps=200):
        entities = []
        seen = set()
        cur = start_entity
        while cur and cur not in seen and len(entities) < max_steps:
            seen.add(cur)
            e = self.entity(cur)
            if not e:
                break
            entities.append({"addr": cur, **e})
            if e["next"] == 0 or e["next"] == start_entity:
                break
            cur = e["next"]
        return entities


def main():
    if len(sys.argv) < 2:
        print("Usage: sudo python3 scan_entities.py <PID> [--driver-only]")
        sys.exit(1)

    pid = int(sys.argv[1])
    driver_only = "--driver-only" in sys.argv

    # Known component TypeIDs
    TYPES = [
        [0x18f98ae0, "PlayerMC"],
        [0x189af180, "CreatureMC"],
    ]

    t0 = time.time()

    if driver_only:
        # TODO: implement kernel-only scanning
        print("Driver-only scanning not yet implemented. Use Frida for discovery.")
        sys.exit(1)

    # Step 1: Frida scan for all entities
    print(f"[*] Scanning PID {pid} via Frida for TypeIDs...")
    entities = frida_scan(pid, TYPES)
    print(f"[*] Frida found {len(entities)} entities ({time.time()-t0:.1f}s)")

    if not entities:
        print("[-] No entities found")
        sys.exit(0)

    # Step 2: Verify with kernel driver (optional)
    kr = KReader(pid)
    verified = []
    for e in entities:
        mc_addr = int(e["mc"], 16)
        mc = kr.read(mc_addr, 0x100)
        if len(mc) >= 0xFC:
            x = struct.unpack_from("<f", mc, 0xF0)[0]
            y = struct.unpack_from("<f", mc, 0xF4)[0]
            e["x_verify"] = x
            e["y_verify"] = y
            verified.append(e)

    # Step 3: Walk entity linked list from player
    player = [e for e in entities if e["type_name"] == "PlayerMC"]
    if player:
        ent_addr = int(player[0]["entity"], 16)
        print(f"[*] Walking entity linked list from {hex(ent_addr)}...")
        chain = kr.walk_list(ent_addr)
        print(f"[*] Linked list chain: {len(chain)} entities")
        for i, c in enumerate(chain):
            mc = kr.read(c["component"], 0x100) if c["component"] > 0x700000000000 else b""
            id_val = -1
            if len(mc) >= 0x1C:
                go = struct.unpack_from("<Q", mc, 0x18)[0]
                if go > 0x700000000000:
                    go_data = kr.read(go, 0x14)
                    if len(go_data) >= 0x14:
                        id_val = struct.unpack_from("<i", go_data, 0x10)[0]
            print(f"  [{i}] {hex(c['addr'])} vt={hex(c['vtable'])} id={id_val}")

    # Step 4: Print results
    print(f"\n{'='*90}")
    print(f"{'ID':>5} {'Type':>12} {'X':>9} {'Y':>9} {'Z':>6} {'MC':>18}")
    print(f"{'='*90}")

    for e in sorted(entities, key=lambda x: x["id"]):
        print(f"{e['id']:5d} {e['type_name']:>12} {e['x']:8.1f} {e['y']:8.1f} "
              f"{e['z']:5.1f} {e['mc']}")

    print(f"\n[*] Done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
