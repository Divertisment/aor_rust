# 1_find_all_targets.py
# Ищет все нужные функции в .text
import idautils, idc

targets = ["cr0$$", "cqy$$", "ck1$$", "aj1$$", "cow$$", ".ael", ".ahx", ".af("]
for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    for t in targets:
        if t in name and ".text" in idc.get_segm_name(ea):
            print(f"{hex(ea)} -> {name}")
            break