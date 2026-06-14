# ida_find_calls_ck1af.py
# Кто вызывает ck1.af? Ищем XRefs к ck1.af в .text
import idautils, idc

ck1_af_ea = idaapi.get_imagebase() + 0x1BBAB10
print(f"ck1.af addr: {hex(ck1_af_ea)}")

for ref in idautils.XrefsTo(ck1_af_ea):
    seg = idc.get_segm_name(ref.frm)
    if ".text" in seg:
        name = idc.get_func_name(ref.frm)
        print(f"  {hex(ref.frm)} -> {name}")
