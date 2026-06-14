# IDA_08_search_immediates.py
# Ищет константы 595/3/41 как immediate операнды в инструкциях (CODE sections)
import idc, idaapi

def seg_class(ea):
    seg = idaapi.getseg(ea)
    if not seg:
        return ""
    for attr in ['clas', 'sclass', 'sec_class', 'type']:
        if hasattr(seg, attr):
            val = getattr(seg, attr)
            if isinstance(val, (bytes, bytearray)):
                return val.split(b'\x00')[0].decode(errors='replace')
            return str(val)
    return ""

base = idaapi.get_imagebase()
print("=" * 60)
print("IDA_08_search_immediates.py - search for operation codes as instruction immediates")
print("=" * 60)

codes = {595: "KeySync", 3: "Move", 41: "ChangeCluster", 255: "255", 101: "101", 102: "102", 103: "103"}

for code, name in codes.items():
    print(f"\n--- Searching for {code} ({name}) ---")
    found = 0
    for seg_ea in idautils.Segments():
        seg_name = idc.get_segm_name(seg_ea)
        sc = seg_class(seg_ea)
        if sc not in ('CODE', 'code', 'data', 'DATA'):
            continue
        seg_start = seg_ea
        seg_end = idc.get_segm_end(seg_ea)
        
        # Search for dword value as instruction data
        ea = seg_start
        while ea < seg_end - 3:
            val = idc.get_wide_dword(ea)
            if val == code:
                # Verify this is part of code (check if there's a function or instruction here)
                func = idaapi.get_func(ea)
                insn = idc.generate_disasm_line(ea, 0)
                if func or insn:
                    found += 1
                    if found <= 10:
                        fname = idc.get_func_name(ea) or "???"
                        print(f"  0x{ea:X} ({seg_name}): func={fname} insn={insn}")
            ea += 1
    if found > 10:
        print(f"  ... total {found} occurrences")

# Also search for these as immediate in instructions specifically
print("\n--- Searching via opcode pattern (cmp eax/ecx/edx, imm32) ---")
for code, name in codes.items():
    found = 0
    # Common patterns: 81 F9 / 81 F8 / 81 FA (cmp ecx/eax/edx, imm32)
    # 3D (cmp eax, imm32)
    # B8 (mov eax, imm32)
    # C7 ?? (mov [??], imm32)
    patterns = {
        f'81 F8 {code:02X} {code>>8:02X} 00 00': f'cmp eax, {code}',
        f'81 F9 {code:02X} {code>>8:02X} 00 00': f'cmp ecx, {code}',
        f'81 FA {code:02X} {code>>8:02X} 00 00': f'cmp edx, {code}',
        f'3D {code:02X} {code>>8:02X} 00 00': f'cmp eax, {code}',
        f'B8 {code:02X} {code>>8:02X} 00 00': f'mov eax, {code}',
    }
    for pat, desc in patterns.items():
        hex_bytes = [int(b, 16) for b in pat.split()]
        seg_start = seg_ea
        seg_end = idc.get_segm_end(seg_ea)
        ea = seg_start
        while ea < seg_end - len(hex_bytes):
            match = True
            for i, b in enumerate(hex_bytes):
                if idc.get_wide_byte(ea + i) != b:
                    match = False
                    break
            if match:
                found += 1
                if found <= 5:
                    f = idc.get_func_name(ea) or "???"
                    print(f"  {desc} @ 0x{ea:X} ({seg_name}) in {f}")
            ea += 1
    if found:
        print(f"  {name}({code}): total {found} matches")
    else:
        print(f"  {name}({code}): NOT found as immediate operand")
