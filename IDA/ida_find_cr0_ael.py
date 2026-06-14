# ida_find_cr0_ael.py
# Запусти в IDA: File -> Script file...
# Ищет реальный адрес функции cr0.ael в секции .text

import idautils
import idaapi
import idc

# Известные RVAs из Il2CppDumper (это ea в .eh_frame, надо найти код)

# ck1.af (handler registration) - известный работающий RVA
ck1_af_rva = 0x1BBAB10

# cr0.ael (OnEvent для game simulation) - RVA из дампа (ведет в eh_frame)
cr0_ael_rva_fake = 0x19E8E88 

print("=== IDA: Поиск реальных адресов функций ===")

# 1. Проверяем, в какой секции лежит ck1.af
ea_ck1_af = idaapi.get_imagebase() + ck1_af_rva
seg_name = idc.get_segm_name(ea_ck1_af)
print(f"ck1.af (by RVA): 0x{ea_ck1_af:X} -> секция: {seg_name}")

# 2. Пробуем найти cr0.ael через XRefs к ck1.af
print("\n=== Cross-references TO ck1.af ===")
for ref in idautils.XrefsTo(ea_ck1_af):
        func = idaapi.get_func(ref.frm)
        func_name = idc.get_func_name(ref.frm) if func else "?"
        print(f"  0x{ref.frm:X} ({func_name}) -> reftype: {ref.type}")

# 3. Ищем функцию cr0.ael в .text по имени
print("\n=== Поиск всех функций с именем 'ael' ===")
for addr in idautils.Functions():
        name = idc.get_func_name(addr)
        if "ael" in name.lower() or "ael" in name:
                seg = idc.get_segm_name(addr)
                print(f"  0x{addr:X} ({name}) -> секция: {seg}")

# 4. Ищем все функции в GameAssembly, которые могут быть обработчиками
#    Ищем функции с подписью: void func(gyi*, short)
print("\n=== Поиск в .text всех функций cr0.ael (по slot 6 vtable) ===")
# Slot 6 = ael в cr0::ctg
# Ищем упоминания cr0_ael_rva_fake в .text
for addr in idautils.Functions():
        name = idc.get_func_name(addr)
        if "cr0" in name and ("ael" in name.lower() or "OnEvent" in name):
                seg = idc.get_segm_name(addr)
                print(f"  0x{addr:X} ({name}) -> секция: {seg}")

# 5. Ищем вызовы DispatchEvent или OnEvent в Photon
print("\n=== Ищем функции, вызывающие cr0.ael ===")
# Ищем все функции, которые вызывают адрес в диапазоне +-0x200 от cr0_ael_rva_fake

# 6. Выводим все методы в cr0 классе
print("\n=== Все функции, содержащие 'cr0' ===")
for addr in idautils.Functions():
        name = idc.get_func_name(addr)
        if "cr0" in name:
                seg = idc.get_segm_name(addr)
                print(f"  0x{addr:X} ({name}) -> секция: {seg}")

print("\n=== Готово ===")
