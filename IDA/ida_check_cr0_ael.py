# check_cr0_ael_text.py - проверяет что в .text по RVA 0x03A50194
import idautils, idc

rva = 0x03A50194
ea = idaapi.get_imagebase() + rva
seg = idc.get_segm_name(ea)
print(f"cr0.ael real code: 0x{ea:X}")
print(f"  section: {seg}")
print(f"  segment: {idc.get_segm_class(ea)}")

# Проверяем, функция ли это
func = idaapi.get_func(ea)
if func:
    fname = idc.get_func_name(ea)
    print(f"  function: {fname}")
    print(f"  size: {func.end_ea - func.start_ea} bytes")
else:
    print(f"  NO function at this address")
    # Ищем ближайшую функцию
    for d in range(0x100):
        for sign in [-1, 1]:
            check = ea + d * sign
            f = idaapi.get_func(check)
            if f:
                print(f"  nearest func: {hex(f.start_ea)} ({idc.get_func_name(f.start_ea)}) @ offset {d * sign:+d}")
                break
        else:
            continue
        break

# Показываем первые 16 байт
b = [idc.get_wide_byte(ea+i) for i in range(16)]
h = ' '.join(f'{x:02X}' for x in b)
print(f"  first bytes: {h}")
