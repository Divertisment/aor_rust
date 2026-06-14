# ida_find_methods_from_eh_frame.py
# Запусти: File -> Script file...
# Извлекает real code адреса из FDE записей .eh_frame
# Il2CppDumper дает RVA в .eh_frame, а код в .text

import idautils
import idaapi
import idc

image_base = idaapi.get_imagebase()

# RVA из Il2CppDumper (точки в .eh_frame)
rvads = [
    ("cr0.ael",       0x19E8E88),  # cr0.ael (OnEvent)
    ("cr0.ahx",       0x19E9228),  # cr0.ahx (OnOperationResponse)
    ("cqy.ael",       0x19EA0E4),  # cqy.ael
    ("ck1.af",        0x1BBAB10),  # ck1.af (handler registration)
    ("cr0.v(gyi)",    0x19E8EA8),  # cr0.private_v
    ("cr0.u(gyi)",    0x19E9060),  # cr0.private_u
]

# Формат FDE в .eh_frame (ARM64 = 24 bytes, x64 = 24 bytes):
# offset 0: length (4 bytes, или 0xFFFFFFFF для DWARF64)
# offset 4: CIE_pointer (4 bytes)
# offset 8: initial_location (8 bytes на x64)
# offset 16: address_range (8 bytes на x64)

print("=== Извлечение real code адресов из .eh_frame ===")

for name, rva in rvads:
    ea = image_base + rva
    seg = idc.get_segm_name(ea)
    
    # Пробуем прочитать FDE (Common Entry Format)
    # Сначала читаем длину
    length = idc.get_wide_dword(ea)
    if length == 0xFFFFFFFF:
        # DWARF64 не поддерживаем
        print(f"  {name}: 0x{ea:X} ({seg}) -> DWARF64, skip")
        continue
    
    if length <= 0:
        print(f"  {name}: 0x{ea:X} ({seg}) -> length={length}, not FDE")
        continue
    
    # Читаем CIE pointer
    cie_ptr = idc.get_wide_dword(ea + 4)
    
    # Если CIE pointer == 0, это CIE, не FDE
    if cie_ptr == 0:
        print(f"  {name}: 0x{ea:X} ({seg}) -> CIE entry, skip")
        continue
    
    # FDE: читаем initial_location (8 bytes на x64) и address_range
    # Проверяем, адресуется ли как x64
    try:
        init_loc = idc.get_wide_qword(ea + 8)
        addr_range = idc.get_wide_qword(ea + 16)
    except:
        init_loc = idc.get_wide_dword(ea + 8)
        addr_range = idc.get_wide_dword(ea + 12)
    
    if init_loc > 0 and init_loc < 0xFFFFFFFFFFFFFFFF:
        init_seg = idc.get_segm_name(init_loc)
        print(f"  {name}:")
        print(f"    eh_frame: 0x{ea:X}")
        print(f"    real code: 0x{init_loc:X} ({init_seg})")
        print(f"    address_range: 0x{addr_range:X}")
        
        # Показываем, какая это функция в IDA
        func = idaapi.get_func(init_loc)
        if func:
            fname = idc.get_func_name(init_loc)
            print(f"    function name: {fname}")
    else:
        print(f"  {name}: 0x{ea:X} ({seg}) -> init_loc=0x{init_loc:X} (invalid)")

print("\n=== Поиск реальных RVA для Frida ===")
