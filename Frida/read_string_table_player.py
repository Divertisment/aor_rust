#!/usr/bin/env python3
"""Read string table from hero's component pointer chain and display in CE format."""
import struct

PID = 25355
MC_ADDR = 0x7CCAE04DDA80  # player's movement component

mem = open(f'/proc/{PID}/mem', 'rb')

# Chain: MC + 0xA0 -> L1 + 0x40 -> L2 + 0x18 -> StringTable
mem.seek(MC_ADDR + 0xA0)
l1 = struct.unpack('<Q', mem.read(8))[0]

mem.seek(l1 + 0x40)
l2 = struct.unpack('<Q', mem.read(8))[0]

# Using 0x18 instead of 0x10 for the player
mem.seek(l2 + 0x18)
st = struct.unpack('<Q', mem.read(8))[0]

print(f'; StringTable: {st:012X}')
print(f'; Chain: MC({MC_ADDR:012X}) +0xA0 -> L1({l1:012X}) +0x40 -> L2({l2:012X}) +0x18 -> ST')
print()

mem.seek(st)
data = mem.read(0x800)

offset = 0
while offset < len(data):
    str_start = offset
    while offset < len(data) and data[offset] != 0:
        offset += 1
    if offset > str_start:
        s = data[str_start:offset].decode('ascii', errors='replace')
        if len(s) >= 2:
            print(f'{str_start:04X}  {st + str_start:012X}  {s}')
    offset += 1

mem.close()
