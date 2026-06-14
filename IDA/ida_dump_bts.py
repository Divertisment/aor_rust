# dump_all_bts.py - читает ВСЕ entry из Binary Search Table .eh_frame_hdr
import idc

base = idaapi.get_imagebase()

# Позиции eh_frame_hdr entries которые нас интересуют
# Это все ael/ahx из AOdump
entries = {
    "cr0.ael":     0x19E8E88,
    "cr0.v(gyi)":  0x19E8EA8,
    "cr0.u(gyi)":  0x19E9060,
    "cr0.ahx":     0x19E9228,
    "cqy.ael":     0x19EA0E4,
    "cqz.ael":     0x19EA120,  # virtual base ctg (slot 7 = ahx)
    "ck1.af":      0x1BBAB10,
    "cow.af":      0x1BFF8CC,  # cow.af(OperationCodes, cwj)
}

print("=== Binary Search Table: извлечение function_address ===")
for name, rva in entries.items():
    ea = base + rva
    seg = idc.get_segm_name(ea)
    if ".eh_frame" in seg:
        func_rva = idc.get_wide_dword(ea)
        fde_off = idc.get_wide_dword(ea + 4)
        func_ea = base + func_rva
        func_seg = idc.get_segm_name(func_ea)
        print(f"{name:15s}: eh_frame=0x{rva:X} -> func_rva=0x{func_rva:X} -> 0x{func_ea:X} ({func_seg}) FDE=0x{fde_off:X}")
    else:
        print(f"{name:15s}: already in {seg} at 0x{ea:X}")

# Также дамп всей таблицы - идем по eh_frame_hdr entries
# Ищем .eh_frame_hdr секцию
for seg_ea in idautils.Segments():
    seg_name = idc.get_segm_name(seg_ea)
    if "eh_frame_hdr" in seg_name or "EH_FRAME_HDR" in seg_name:
        seg_start = seg_ea
        seg_end = idc.get_segm_end(seg_ea)
        print(f"\n=== Бинарный поиск таблицы .eh_frame_hdr ===")
        print(f"  section: {seg_name} at 0x{seg_start:X} - 0x{seg_end:X}")
        # Читаем первые 4 байта - формат
        ver = idc.get_wide_byte(seg_start)
        ptr_enc = idc.get_wide_byte(seg_start + 1)
        cnt_enc = idc.get_wide_byte(seg_start + 2)
        tbl_enc = idc.get_wide_byte(seg_start + 3)
        print(f"  version={ver} ptr_enc=0x{ptr_enc:X} cnt_enc=0x{cnt_enc:X} tbl_enc=0x{tbl_enc:X}")
        
        # Если tbl_enc == 0x1B (data4|datarel) или 0x00 (absptr)
        # entries начинаются после eh_frame_ptr + fde_count
        # Пропускаем минимум 16 байт (заголовок + 8 байт указателей)
        hdr_size = 16
        # Максимум читаем 100 entries
        for idx in range(100):
            off = hdr_size + idx * 8
            if seg_start + off + 8 > seg_end:
                break
            func_rva = idc.get_wide_dword(seg_start + off)
            fde_off = idc.get_wide_dword(seg_start + off + 4)
            if func_rva == 0:
                continue
            func_ea = base + func_rva
            func_seg = idc.get_segm_name(func_ea)
            print(f"  [{idx:3d}] func_rva=0x{func_rva:X} -> 0x{func_ea:X} ({func_seg})")
        break
