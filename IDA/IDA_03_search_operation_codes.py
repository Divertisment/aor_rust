# IDA_03_search_operation_codes.py
# Ищет KeySync (код 595), OperationCodes и другие Photon константы
import idc, idaapi

def seg_class(ea):
    seg = idaapi.getseg(ea)
    if not seg:
        return ""
    # segment_t class field: попробуем все варианты
    for attr in ['clas', 'sclass', 'sec_class', 'type']:
        if hasattr(seg, attr):
            val = getattr(seg, attr)
            if isinstance(val, (bytes, bytearray)):
                return val.split(b'\x00')[0].decode(errors='replace')
            return str(val)
    # Fallback: проверим idaapi.get_segm_class
    try:
        return idaapi.get_segm_class(ea) or ""
    except:
        pass
    # Fallback 2: seg_class = idc.get_segm_class(seg) - если есть
    try:
        return idc.get_segm_class(seg) or ""
    except:
        pass
    return ""

base = idaapi.get_imagebase()
print("=" * 60)
print("IDA_03_search_operation_codes.py - search for KeySync(595)/Move(3)/OperationCodes strings")
print("=" * 60)

codes = [595, 3, 41, 255, 101, 102, 103]
for code in codes:
    found = 0
    for seg_ea in idautils.Segments():
        seg_name = idc.get_segm_name(seg_ea)
        seg_start = seg_ea
        seg_end = idc.get_segm_end(seg_ea)
        sc = seg_class(seg_ea)
        if sc not in ('DATA', 'CONST', 'data', 'const'):
            continue
        ea = seg_start
        while ea < seg_end - 3:
            val = idc.get_wide_dword(ea)
            if val == code:
                xrefs = list(idautils.XrefsTo(ea))
                if xrefs:
                    found += 1
                    if found <= 5:
                        print(f"  code={code}: found at 0x{ea:X} ({seg_name}) xrefs={len(xrefs)}")
                        for x in xrefs[:3]:
                            f = idc.get_func_name(x.frm) or "???"
                            print(f"    -> 0x{x.frm:X} in {f}")
            ea += 4
    if found > 5:
        print(f"  code={code}: total {found} matches (showing first 5)")
    elif found == 0:
        print(f"  code={code}: NOT FOUND in data sections")

print("\n=== Поиск строк 'OperationCodes', 'KeySync', 'ej' ===")
for s in ["OperationCodes", "KeySync", "ej", "OnEvent"]:
    for seg_ea in idautils.Segments():
        seg_name = idc.get_segm_name(seg_ea)
        sc = seg_class(seg_ea)
        if sc not in ('DATA', 'CONST', 'data', 'const'):
            continue
        seg_start = seg_ea
        seg_end = idc.get_segm_end(seg_ea)
        ea = seg_start
        while ea < seg_end:
            b = idc.get_wide_byte(ea)
            if 0x20 <= b <= 0x7E:
                end = ea
                while end < seg_end:
                    c = idc.get_wide_byte(end)
                    if 0x20 <= c <= 0x7E:
                        end += 1
                    else:
                        break
                length = end - ea
                if length >= len(s) and length <= 64:
                    chars = [chr(idc.get_wide_byte(ea + i)) for i in range(length)]
                    mystr = ''.join(chars)
                    if s in mystr:
                        print(f"  '{mystr}' @ 0x{ea:X} ({seg_name})")
                ea = end
            else:
                ea += 1
