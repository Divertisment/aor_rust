# read_cr0_ael_addr.py
# Читает 4 байта по адресу cr0.ael в .eh_frame_hdr
# Это function_address из Binary Search Table
import idc
base = idaapi.get_imagebase()
ea = base + 0x19E8E88
func_rva = idc.get_wide_dword(ea)
func_ea = base + func_rva
fde_off = idc.get_wide_dword(ea + 4)
seg = idc.get_segm_name(func_ea)
print(f"cr0.ael eh_frame_hdr entry: {hex(ea)}")
print(f"  function_address RVA: {hex(func_rva)}")
print(f"  real code address: {hex(func_ea)} ({seg})")
print(f"  FDE offset: {hex(fde_off)}")
