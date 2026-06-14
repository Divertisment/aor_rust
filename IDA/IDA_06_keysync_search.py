# IDA_06_keysync_search.py
# Специализированный поиск KeySync (кандидаты: 595, sand, encrypt)
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
    try:
        return idaapi.get_segm_class(ea) or ""
    except:
        pass
    try:
        return idc.get_segm_class(seg) or ""
    except:
        pass
    return ""

base = idaapi.get_imagebase()
print("=" * 60)
print("IDA_06_keysync_search.py - deep search for KeySync code 595, sand/encrypt strings, 'ej' attribute")
print("=" * 60)

# 1. Ищем все упоминания числа 595 в коде
print("\n1. Поиск константы 595 (KeySync code):")
count_595 = 0
for seg_ea in idautils.Segments():
    seg_name = idc.get_segm_name(seg_ea)
    seg_start = seg_ea
    seg_end = idc.get_segm_end(seg_ea)
    
    # Только код
    sc = seg_class(seg_ea)
    if sc not in ['CODE', 'DATA', 'CONST']:
        continue
    
    if seg_class == 'CODE':
        step = 4
    else:
        step = 4
    
    ea = seg_start
    while ea < seg_end - 3:
        val = idc.get_wide_dword(ea)
        if val == 595:
            xrefs = list(idautils.XrefsTo(ea))
            if xrefs or seg_class == 'CODE':
                count_595 += 1
                if count_595 <= 20:
                    seg = idc.get_segm_name(ea)
                    f = idc.get_func_name(ea) or "???"
                    print(f"  0x{ea:X} ({seg}) func={f} xrefs={len(xrefs)}")
                    # Показываем инструкцию
                    insn = idc.generate_disasm_line(ea, 0)
                    if insn:
                        print(f"    -> {insn}")
                    for x in xrefs[:3]:
                        xf = idc.get_func_name(x.frm) or "???"
                        print(f"    xref from: 0x{x.frm:X} in {xf}")
        ea += step

if count_595 > 20:
    print(f"  ... and {count_595-20} more")

# 2. Ищем функции связанные с encrypt/sand/key
print("\n2. Поиск строк 'sand', 'encrypt', 'session':")
for target_str in ["sand", "encrypt", "session_key", "Keysync", "keySync"]:
    for seg_ea in idautils.Segments():
        seg_name = idc.get_segm_name(seg_ea)
        sc = seg_class(seg_ea)
        if sc not in ['DATA', 'CONST']:
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
                if 3 <= length <= 64:
                    chars = [chr(idc.get_wide_byte(ea + i)) for i in range(length)]
                    mystr = ''.join(chars)
                    if target_str.lower() in mystr.lower():
                        xrefs = list(idautils.XrefsTo(ea))
                        print(f"  '{mystr}' @ 0x{ea:X} ({seg_name}) xrefs={len(xrefs)}")
                        for x in xrefs[:3]:
                            xf = idc.get_func_name(x.frm) or "???"
                            print(f"    -> 0x{x.frm:X} in {xf}")
                ea = end
            else:
                ea += 1

# 3. Ищем ej() метод - атрибут с кодом ивента
print("\n3. Поиск 'ej'/'Ej' атрибутов (event codes):")
for seg_ea in idautils.Segments():
    seg_name = idc.get_segm_name(seg_ea)
    sc = seg_class(seg_ea)
    if sc not in ['DATA', 'CONST']:
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
            if length == 2:
                chars = [chr(idc.get_wide_byte(ea + i)) for i in range(length)]
                mystr = ''.join(chars)
                if mystr == 'ej':
                    xrefs = list(idautils.XrefsTo(ea))
                    print(f"  'ej' @ 0x{ea:X} ({seg_name}) xrefs={len(xrefs)}")
                    for x in xrefs[:5]:
                        xf = idc.get_func_name(x.frm) or "???"
                        print(f"    -> 0x{x.frm:X} in {xf}")
            ea = end
        else:
            ea += 1
