"""Python wrapper for /proc/aor_mem kernel driver (requires sudo).

NOTE: /proc/aor_mem doesn't support lseek, so each read() opens a new fd.
Use for targeted reads (known addresses), NOT for bulk scanning.
"""

import struct
import os

PROC_MEM = "/proc/aor_mem"


class KernelReader:
    """Read game memory via kernel driver. Each read() opens/closes fd."""

    def __init__(self, pid: int):
        self.pid = pid

    def read(self, addr: int, sz: int) -> bytes:
        fd = os.open(PROC_MEM, os.O_RDWR)
        os.write(fd, f"{self.pid} {addr:x} {sz}\n".encode())
        data = os.read(fd, sz)
        os.close(fd)
        return data

    def u32(self, a: int) -> int:
        return struct.unpack_from("<I", self.read(a, 4))[0]

    def u64(self, a: int) -> int:
        return struct.unpack_from("<Q", self.read(a, 8))[0]

    def flt(self, a: int) -> float:
        return struct.unpack_from("<f", self.read(a, 4))[0]

    def mc(self, addr: int) -> dict:
        """Read a MC component structure, return parsed dict."""
        d = self.read(addr, 0x100)
        if len(d) < 0xFC:
            return None
        return {
            "type": struct.unpack_from("<I", d, 0)[0],
            "entity": struct.unpack_from("<Q", d, 0x10)[0],
            "go": struct.unpack_from("<Q", d, 0x18)[0],
            "level1": struct.unpack_from("<Q", d, 0xA0)[0],
            "x": struct.unpack_from("<f", d, 0xF0)[0],
            "y": struct.unpack_from("<f", d, 0xF4)[0],
            "z": struct.unpack_from("<f", d, 0xF8)[0],
        }

    def entity(self, addr: int) -> dict:
        """Read an Entity structure, return parsed dict."""
        d = self.read(addr, 0x40)
        if len(d) < 0x38:
            return None
        return {
            "vtable": struct.unpack_from("<Q", d, 0)[0],
            "component": struct.unpack_from("<Q", d, 0x28)[0],
            "next": struct.unpack_from("<Q", d, 0x30)[0],
        }

    def go_id(self, go_addr: int) -> int:
        """Read GameObject ID."""
        d = self.read(go_addr, 0x14)
        if len(d) < 0x14:
            return -1
        return struct.unpack_from("<i", d, 0x10)[0]


def test():
    import sys
    pid = int(sys.argv[1]) if len(sys.argv) > 1 else 25355
    addr = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x7CCAE04DDA80

    kr = KernelReader(pid)
    data = kr.read(addr, 0x100)
    print(f"Read {len(data)} bytes from 0x{addr:x}")
    for i in range(0, len(data), 16):
        chunk = data[i:i+16]
        hexs = " ".join(f"{b:02x}" for b in chunk)
        ascii_str = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        print(f"  +0x{i:02x}: {hexs:<48s}  {ascii_str}")


if __name__ == "__main__":
    test()
