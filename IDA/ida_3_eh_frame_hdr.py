# 3_extract_from_eh_frame_hdr.py
# .eh_frame_hdr содержит таблицу: function_address + fde_address
# Извлекаем реальный function_address для cr0.ael и других
import idautils, idc

# RVA из Il2CppDumper
rvads = {
    "cr0.ael": 0x19E8E88,
    "cr0.ahx": 0x19E9228,
    "cqy.ael": 0x19EA0E4,
    "cr0.v(gyi)": 0x19E8EA8,
}

# .eh_frame_hdr Binary Search Table (x64, LP64 format):
# После заголовка идут пары:
#   function_address (4 байта, image-relative)
#   fde_address (4 байта, relative to .eh_frame section)

print("=== Извлечение адресов из .eh_frame_hdr ===")

for name, rva in rvads.items():
    ea = idaapi.get_imagebase() + rva
    # В .eh_frame_hdr каждая запись:
    # function_address (4 байта LE, relative to 0)
    # fde_address (4 байта LE, relative to .eh_frame base)
    
    # Читаем с этой позиции как entry в binary search table
    # Функция addr может быть за符号 или наоборот
    func_rva = idc.get_wide_dword(ea)
    fde_off = idc.get_wide_dword(ea + 4)
    
    func_addr = idaapi.get_imagebase() + func_rva
    seg = idc.get_segm_name(func_addr)
    
    print(f"\n{name}:")
    print(f"  .eh_frame_hdr entry: 0x{ea:X}")
    print(f"  function_address: 0x{func_rva:X} -> 0x{func_addr:X} ({seg})")
    print(f"  FDE offset: 0x{fde_off:X}")
    
    if ".text" in seg:
        print(f"  >>> ВАЛИДНЫЙ RVA: 0x{func_rva:X}")

# Также пробуем прочитать начальный байт как смещение
# Некоторые сборки хранят relative offset от текущей позиции
print("\n=== Альтернатива: offset от текущей позиции ===")
for name, rva in rvads.items():
    ea = idaapi.get_imagebase() + rva
    # Пробуем pattern: byte 0x94 + 3 байта padding + 4 байта offset
    b0 = idc.get_wide_byte(ea)
    if b0 == 0x94:
        # 0x94 = DW_CIE_VERSION | augmentation
        # Это может быть не entry, а смещение
        off = idc.get_wide_dword(ea + 4)
        func_addr = ea + off
        seg = idc.get_segm_name(func_addr)
        print(f"  {name}: 0x{ea:X} -> offset=0x{off:X} -> 0x{func_addr:X} ({seg})")
