# IDA_01_cr0_ael_real_addr.py
# Читает BTS entry для cr0.ael и показывает реальный код в il2cpp
import idc, idaapi, idautils

base = idaapi.get_imagebase()
entries = {
    "cr0.ael":     0x19E8E88,
    "cr0.v":       0x19E8EA8,
    "cr0.u":       0x19E9060,
    "cr0.ahx":     0x19E9228,
    "cqy.ael":     0x19EA0E4,
    "cqz.ael":     0x19EA120,
    "ck1.af":      0x1BBAB10,
    "cow.af":      0x1BFF8CC,
}

print("=" * 60)
print("IDA_01_cr0_ael_real_addr.py - BTS entry -> real function addresses")
print("=" * 60)
for name, rva in entries.items():
    ea = base + rva
    seg = idc.get_segm_name(ea)
    func_raw = idc.get_wide_dword(ea)  # signed int32
    
    # tbl_enc=0x3b => datarel|sdata4: addr = eh_frame_hdr_va + signed_dword
    # eh_frame_hdr VA = 0x181A15C (for this binary)
    eh_hdr_va = 0x181A15C
    
    if func_raw & 0x80000000:
        func_raw_signed = func_raw - 0x100000000
    else:
        func_raw_signed = func_raw
    
    real_va = eh_hdr_va + func_raw_signed
    real_ea = base + real_va
    real_seg = idc.get_segm_name(real_ea)
    
    func = idaapi.get_func(real_ea)
    if func:
        fname = idc.get_func_name(real_ea)
        fsize = func.end_ea - func.start_ea
        print(f"{name:15s}: BTS@0x{rva:X} -> func_ea=0x{real_ea:X} ({real_seg}) func='{fname}' size={fsize}")
    else:
        print(f"{name:15s}: BTS@0x{rva:X} -> func_ea=0x{real_ea:X} ({real_seg}) NO FUNCTION")
        # Ищем ближайшую функцию
        for d in range(0x200):
            for sign in [-1, 1]:
                check = real_ea + d * sign
                f = idaapi.get_func(check)
                if f:
                    print(f"    nearest: {idc.get_func_name(f.start_ea)} @ 0x{f.start_ea:X} (offset {d*sign:+d})")
                    break
            else:
                continue
            break
