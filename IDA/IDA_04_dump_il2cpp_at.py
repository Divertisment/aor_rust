# IDA_04_dump_il2cpp_at.py
# Дизассемблирует код в il2cpp секции по указанным адресам
import idc, idaapi

base = idaapi.get_imagebase()

# Реальные адреса функций из BTS (RVA в il2cpp)
addrs = {
    "cr0.ael": 0x526A2F0,
    "cr0.v":   0x526A740,
    "cr0.u":   0x526CEE0,
    "cr0.ahx": 0x526EAF0,
    "ck1.af":  None,  # будет найден в IDA_02
    "cqz.ael": 0x5289B70,
}

print("=" * 60)
print("IDA_04_dump_il2cpp_at.py - disassemble il2cpp code at BTS function addresses")
print("=" * 60)
for name, rva in addrs.items():
    if rva is None:
        continue
    ea = base + rva
    seg = idc.get_segm_name(ea)
    
    func = idaapi.get_func(ea)
    if func:
        fname = idc.get_func_name(ea)
        print(f"\n{name:15s} @ 0x{ea:X} ('{fname}' size={func.end_ea - func.start_ea}):")
        count = 0
        insn_ea = func.start_ea
        while insn_ea < func.end_ea and count < 40:
            insn = idc.generate_disasm_line(insn_ea, 0)
            if insn and insn[0] != '.':
                print(f"    {insn_ea:X}: {insn}")
            else:
                b = [idc.get_wide_byte(insn_ea + j) for j in range(4)]
                h = ' '.join(f'{x:02X}' for x in b)
                print(f"    {insn_ea:X}: {h}")
            count += 1
            next_ea = idaapi.next_head(insn_ea, func.end_ea)
            if next_ea == idaapi.BADADDR or next_ea == insn_ea:
                insn_ea += 1  # fallback
            else:
                insn_ea = next_ea
    else:
        print(f"\n{name:15s} @ 0x{ea:X} ({seg}): NO FUNCTION")
        b = [idc.get_wide_byte(ea + i) for i in range(16)]
        h = ' '.join(f'{x:02X}' for x in b)
        print(f"    first bytes: {h}")
        print(f"    disasm:")
        insn_ea = ea
        for _ in range(20):
            insn = idc.generate_disasm_line(insn_ea, 0)
            if insn and insn[0] != '.':
                print(f"      {insn_ea:X}: {insn}")
            else:
                b = [idc.get_wide_byte(insn_ea + j) for j in range(4)]
                h = ' '.join(f'{x:02X}' for x in b)
                print(f"      {insn_ea:X}: {h}")
            next_ea = idaapi.next_head(insn_ea, ea + 64)
            if next_ea == idaapi.BADADDR or next_ea == insn_ea:
                insn_ea += 1
            else:
                insn_ea = next_ea
