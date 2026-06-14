# 4_find_via_codegen.py
# Ищет реальный код функции через:
# 1. Поиск всех функций в .text (не eh_frame)
# 2. Поиск XRefs к eh_frame_hdr entry 
# 3. Поиск по паттерну: функция с подписью (gyi*, short)
import idautils, idc

# RVA eh_frame_hdr entries
known_eh = {
    "cr0.ael": 0x19E8E88,
    "cr0.ahx": 0x19E9228,
    "cr0.v":   0x19E8EA8,
    "cr0.u":   0x19E9060,
    "cqy.ael": 0x19EA0E4,
}

# 1. Сначала найдем все функции в .text
print("=== 1. Все функции в .text с 'cr0', 'cqy', 'aj1' ===")
for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    if ".text" not in idc.get_segm_name(ea):
        continue
    has = False
    for kw in ["cr0", "cqy", "cow", "aj1", "ck1"]:
        if kw in name:
            has = True
            break
    if has:
        print(f"  {hex(ea)} ({idc.get_segm_name(ea)}) -> {name}")

# 2. Проверим, может ли адрес из eh_frame реально содержать код
print("\n=== 2. Проверка eh_frame адресов ===")
for name, rva in known_eh.items():
    ea = idaapi.get_imagebase() + rva
    seg = idc.get_segm_name(ea)
    # Проверим 20 байт по адресу
    bytes_ = []
    for i in range(16):
        b = idc.get_wide_byte(ea + i)
        bytes_.append(f"{b:02X}")
    print(f"  {name} @ 0x{ea:X} ({seg}): {' '.join(bytes_)}")

# 3. Поиск по уникальным опкодам
# Функции ael обычно начинаются с проверки аргументов и чтения из event
# Пробуем найти функции рядом с известными RVA
print("\n=== 3. Функции в .text рядом с eh_frame RVA ===")
for name, rva in known_eh.items():
    ea = idaapi.get_imagebase() + rva
    # Ищем ближайшую функцию в .text
    # Сначала проверим диапазон +-0x500
    found = False
    for delta in range(-0x500, 0x500, 4):
        check_ea = ea + delta
        func = idaapi.get_func(check_ea)
        if func and ".text" in idc.get_segm_name(func.start_ea):
            fname = idc.get_func_name(func.start_ea)
            if fname and fname != "nullsub":
                print(f"  {name}: ближайшая функция на {hex(check_ea)} ({delta:+d}): {hex(func.start_ea)} -> {fname}")
                found = True
                break
    if not found:
        print(f"  {name}: функции не найдены в диапазоне +-0x500")

# 4. Поиск ссылок на известные адреса
print("\n=== 4. XRefs из .text к eh_frame адресам ===")
for name, rva in known_eh.items():
    ea = idaapi.get_imagebase() + rva
    count = 0
    for ref in idautils.XrefsTo(ea):
        if ".text" in idc.get_segm_name(ref.frm):
            count += 1
            fname = idc.get_func_name(ref.frm)
            print(f"  {name}: ref from {hex(ref.frm)} ({fname})")
    if count == 0:
        print(f"  {name}: нет XRefs из .text")
