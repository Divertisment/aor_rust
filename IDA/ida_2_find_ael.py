# 2_find_ael_handlers.py
# Ищет ВСЕ функции ael в .text - это обработчики Photon событий
import idautils, idc

for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    if "ael" in name and ".text" in idc.get_segm_name(ea):
        print(f"{hex(ea)} -> {name}")
