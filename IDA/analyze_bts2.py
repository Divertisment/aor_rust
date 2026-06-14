#!/usr/bin/env python3
import struct, sys

def read_sections(path):
    with open(path, 'rb') as f:
        ident = f.read(64)
        endian = '<' if ident[5] == 1 else '>'
        e_shoff = struct.unpack(endian + 'Q', ident[40:48])[0]
        e_shentsize = struct.unpack(endian + 'H', ident[58:60])[0]
        e_shnum = struct.unpack(endian + 'H', ident[60:62])[0]
        e_shstrndx = struct.unpack(endian + 'H', ident[62:64])[0]
        
        f.seek(e_shoff)
        sections = []
        for i in range(e_shnum):
            shdr = f.read(e_shentsize)
            sh_name = struct.unpack(endian + 'I', shdr[0:4])[0]
            sh_type = struct.unpack(endian + 'I', shdr[4:8])[0]
            sh_flags = struct.unpack(endian + 'Q', shdr[8:16])[0]
            sh_addr = struct.unpack(endian + 'Q', shdr[16:24])[0]
            sh_offset = struct.unpack(endian + 'Q', shdr[24:32])[0]
            sh_size = struct.unpack(endian + 'Q', shdr[32:40])[0]
            sections.append((sh_name, sh_type, sh_flags, sh_addr, sh_offset, sh_size))
        
        f.seek(sections[e_shstrndx][4])
        strtab = f.read(sections[e_shstrndx][5])
        
        def name(off):
            end = strtab.index(b'\x00', off)
            return strtab[off:end].decode()
        
        result = []
        for sn, st, sf, sa, so, sz in sections:
            nm = name(sn)
            result.append((nm, sf, sa, so, sz))
        return result

def find_section(sections, addr):
    for nm, fl, sa, so, sz in sections:
        if sa <= addr < sa + sz:
            return nm, sa, so, sz
    return "???", 0, 0, 0

path = "/mnt/d10/albion/game_x64/GameAssembly.so"
sections = read_sections(path)

# Find .eh_frame_hdr
for nm, fl, sa, so, sz in sections:
    if 'eh_frame_hdr' in nm:
        print(f".eh_frame_hdr: VA=0x{sa:x} offset=0x{so:x} size={sz}")
        hdr_va = sa
        hdr_off = so
        hdr_sz = sz
        break

# Read BTS entries
with open(path, 'rb') as f:
    # BTS starts at offset 16 into eh_frame_hdr
    bts_off = hdr_off + 16
    
    # Our targets (absolute VA in the binary)
    targets = {
        "cr0.ael":    0x19E8E88,
        "cr0.v":      0x19E8EA8,
        "cr0.u":      0x19E9060,
        "cr0.ahx":    0x19E9228,
        "cqy.ael":    0x19EA0E4,
        "cqz.ael":    0x19EA120,
    }
    
    for name, tva in targets.items():
        # Convert target VA to file offset
        toff = tva - hdr_va + hdr_off
        f.seek(toff)
        d = f.read(8)
        
        func_raw = struct.unpack('<i', d[0:4])[0]  # signed int32
        fde_raw = struct.unpack('<i', d[4:8])[0]   # signed int32
        
        # tbl_enc = 0x3b = DW_EH_PE_datarel | DW_EH_PE_sdata4
        # function_address = eh_frame_hdr_va + signed_dword
        func_va = hdr_va + func_raw
        
        # fde_enc = 0x1b = DW_EH_PE_pcrel | DW_EH_PE_sdata4
        # FDE_offset = BTS_entry_address + signed_dword = tva + 4 + fde_raw... 
        # Actually it's relative to the FDE offset field's position
        fde_ofs_field_va = tva + 4
        fde_va = fde_ofs_field_va + fde_raw
        
        nm, sa, so, sz = find_section(sections, func_va)
        fde_nm, fde_sa, fde_so, fde_sz = find_section(sections, fde_va)
        
        print(f"\n{name:15s}: BTS @ VA=0x{tva:x}")
        print(f"  func_raw={func_raw:+d} (0x{func_raw & 0xffffffff:x})")
        print(f"  func_VA=0x{func_va:x} -> {nm} (section VA 0x{sa:x}, offset 0x{so + (func_va - sa):x})")
        print(f"  fde_VA=0x{fde_va:x} -> {fde_nm}")

    # Also print all sections for reference
    print("\n=== Sections ===")
    for nm, fl, sa, so, sz in sections:
        if sz > 0:
            print(f"  {nm:25s} VA=0x{sa:010x} size=0x{sz:x}")
