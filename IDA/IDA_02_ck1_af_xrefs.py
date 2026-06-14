# IDA_02_ck1_af_xrefs.py
# Ищет все перекрёстные ссылки на ck1.af (регистрация обработчиков)
import idc, idaapi

base = idaapi.get_imagebase()

# ck1.af из Il2CppDumper: RVA = ?
# BTS entry для ck1.af
entries = {
    "ck1.af": 0x1BBAB10,
    "cow.af": 0x1BFF8CC,
}

print("=" * 60)
print("IDA_02_ck1_af_xrefs.py - cross-references to ck1.af/cow.af (handler registration)")
print("=" * 60)
for name, rva in entries.items():
    ea = base + rva
    seg = idc.get_segm_name(ea)
    print(f"\n=== {name} @ 0x{rva:X} ({seg}) ===")
    
    # Real address from BTS
    func_raw = idc.get_wide_dword(ea)
    if func_raw & 0x80000000:
        func_raw_signed = func_raw - 0x100000000
    else:
        func_raw_signed = func_raw
    
    real_va = 0x181A15C + func_raw_signed
    real_ea = base + real_va
    
    print(f"  BTS func_ea=0x{real_ea:X}")
    
    # Xrefs to this function
    xrefs = list(idautils.XrefsTo(real_ea))
    print(f"  XrefsTo: {len(xrefs)} references")
    for x in xrefs[:30]:
        caller_seg = idc.get_segm_name(x.frm)
        caller_func = idc.get_func_name(x.frm) or "???"
        print(f"    from 0x{x.frm:X} ({caller_seg}) in {caller_func} type={x.type}")
    
    if len(xrefs) > 30:
        print(f"    ... and {len(xrefs)-30} more")
    
    # Xrefs from this function
    print(f"  XrefsFrom:")
    for x in idautils.XrefsFrom(real_ea):
        to_seg = idc.get_segm_name(x.to)
        to_func = idc.get_func_name(x.to) or "???"
        print(f"    to 0x{x.to:X} ({to_seg}) in {to_func} type={x.type}")
