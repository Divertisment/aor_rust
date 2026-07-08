"""Reliable entity feeder: scans heap and sends JSON entities to AOR_web (port 4448)."""
import os, struct, time, json, socket, math

PID = 25355
TYPES = {
    0x18f98ae0: ("Me", False, True),
    0x189af180: ("Mob", False, False),
    0x18f0cc90: ("Enemy", True, False),
}

def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def flt(d, o): return struct.unpack_from("<f", d, o)[0]

def readm(addr, sz):
    fd = os.open("/proc/aor_mem", os.O_RDWR)
    os.write(fd, f"{PID} {addr:x} {sz}\n".encode())
    data = os.read(fd, sz)
    os.close(fd)
    return data

def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect(("127.0.0.1", 4448))
    print("[FEED] Connected to 4448")
    
    while True:
        maps = open(f"/proc/{PID}/maps").read()
        for line in maps.split("\n"):
            if "rw" not in line: continue
            parts = line.split()
            s, e = parts[0].split("-")
            start, end = int(s, 16), int(e, 16)
            if end - start < 0x10000: continue
            
            for base in range(start, end, 4*1024*1024):
                try: data = readm(base, min(4*1024*1024, end-base))
                except: continue
                
                for typ, (label, hostile, is_self) in TYPES.items():
                    patt = struct.pack("<I", typ)
                    off = 0
                    while True:
                        off = data.find(patt, off)
                        if off == -1: break
                        addr = base + off
                        if off + 0x20 > len(data): off += 4; continue
                        e_addr = u64(data, off + 0x10)
                        g_addr = u64(data, off + 0x18)
                        
                        if (0x7cc000000000 < e_addr < 0x7cf000000000 and 
                            0x7cc000000000 < g_addr < 0x7cf000000000):
                            x = flt(data, off+0xF0)
                            y = flt(data, off+0xF4)
                            try:
                                gd = readm(g_addr, 0x14)
                                goid = u32(gd, 0x10)
                            except: goid = -1
                            
                            if 0 < goid < 500000:
                                if is_self:
                                    msg = {"t":"p", "id":goid, "x":x, "y":y}
                                else:
                                    msg = {"t":"e", "id":goid, "n":label, "x":x, "y":y, "h":1 if hostile else 0}
                                sock.sendall((json.dumps(msg) + "\n").encode())
                        off += 4
        time.sleep(1.0) # Частота сканирования 1Гц для стабильности

if __name__ == "__main__":
    main()
