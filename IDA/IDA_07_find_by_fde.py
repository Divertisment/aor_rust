# IDA_07_find_by_fde.py
# Ищет BTS entry по FDE адресу (для ck1.af, cow.af и др.)
import idc, idaapi

base = idaapi.get_imagebase()

# FDE адреса из Il2CppDumper (RVA)
target_fdes = {
    "ck1.af":  0x1BBAB10,
    "cow.af":  0x1BFF8CC,
}

# Параметры .eh_frame_hdr
EH_HDR_VA = 0x181A15C
EH_HDR_SIZE = 0x2B2DCC
BTS_START = EH_HDR_VA + 16
ENTRIES = (EH_HDR_SIZE - 16) // 8

print("=" * 60)
print("IDA_07_find_by_fde.py - search BTS by FDE address (for ck1.af, cow.af)")
print("=" * 60)
print(f"  .eh_frame_hdr: 0x{EH_HDR_VA:x} size={EH_HDR_SIZE}")
print(f"  BTS entries: {ENTRIES}")
print()

for name, target_fde_rva in target_fdes.items():
    target_fde_ea = base + target_fde_rva
    target_seg = idc.get_segm_name(target_fde_ea)
    print(f"\n{name:15s}: target FDE @ 0x{target_fde_ea:X} ({target_seg})")
    
    # Сканируем все BTS entry
    found = False
    for idx in range(ENTRIES):
        bts_ea = base + BTS_START + idx * 8

        # Читаем функцию и FDE
        func_raw = idc.get_wide_dword(bts_ea)
        fde_raw = idc.get_wide_dword(bts_ea + 4)
        
        # Signed int32
        if func_raw & 0x80000000:
            func_signed = func_raw - 0x100000000
        else:
            func_signed = func_raw
        if fde_raw & 0x80000000:
            fde_signed = fde_raw - 0x100000000
        else:
            fde_signed = fde_raw
        
        # tbl_enc=0x3b => datarel|sdata4: addr = eh_frame_hdr_va + signed_dword
        func_va = EH_HDR_VA + func_signed
        # FDE тоже datarel: fde_va = eh_frame_hdr_va + fde_signed
        fde_va = EH_HDR_VA + fde_signed
        
        if fde_va == target_fde_rva:
            func_ea = base + func_va
            func_seg = idc.get_segm_name(func_ea)
            func_name = idc.get_func_name(func_ea) or "???"
            print(f"  FOUND! idx={idx} BTS@0x{bts_ea:X}")
            print(f"    func_raw={func_raw:+d} func_VA=0x{func_va:X} -> 0x{func_ea:X} ({func_seg})")
            print(f"    function: {func_name}")
            
            # Показываем первые инструкции
            f = idaapi.get_func(func_ea)
            if f:
                print(f"    size={f.end_ea - f.start_ea} bytes")
                for i in range(0, min(f.end_ea - f.start_ea, 48), 4):
                    insn_ea = f.start_ea + i
                    insn = idc.generate_disasm_line(insn_ea, 0)
                    if insn:
                        print(f"      {insn_ea:X}: {insn}")
            found = True
            break
    
    if not found:
        print(f"  NOT FOUND in BTS!")
        
        # Может быть FDE кодирован иначе? Попробуем pcrel
        print(f"  Retrying with pcrel encoding for FDE...")
        for idx in range(ENTRIES):
            bts_ea = base + BTS_START + idx * 8
            func_raw = idc.get_wide_dword(bts_ea)
            fde_raw = idc.get_wide_dword(bts_ea + 4)
            
            if func_raw & 0x80000000:
                func_signed = func_raw - 0x100000000
            else:
                func_signed = func_raw
            if fde_raw & 0x80000000:
                fde_signed = fde_raw - 0x100000000
            else:
                fde_signed = fde_raw
            
            # FDE с pcrel: fde_va = bts_ea + 4 + fde_signed  (position of FDE field + signed offset)
            fde_va_pcrel = (bts_ea + 4) + fde_signed
            
            if fde_va_pcrel == target_fde_ea:
                func_va = EH_HDR_VA + func_signed
                func_ea = base + func_va
                func_seg = idc.get_segm_name(func_ea)
                print(f"  FOUND (pcrel)! idx={idx} BTS@0x{bts_ea:X}")
                print(f"    func_VA=0x{func_va:X} -> 0x{func_ea:X} ({func_seg})")
                break
        else:
            print(f"  NOT FOUND with pcrel either")
