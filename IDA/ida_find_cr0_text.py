# ida_find_cr0_text.py
# Ищет функции cr0 в .text (реальный код, не eh_frame)
import idautils, idc

targets = ["cr0.", "cow.", "ck1.", "aj1"]
for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    for t in targets:
        if t in name and ".text" in idc.get_segm_name(ea):
            print(f"{hex(ea)} -> {name}")
            break