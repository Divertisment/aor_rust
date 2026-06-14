# ida_find_keysync_handler.py
# Запусти: File -> Script file...
# Ищет кто вызывает ck1.af с event code 595 (KeySync)

import idautils
import idaapi
import idc

image_base = idaapi.get_imagebase()
ck1_af_rva = 0x1BBAB10
ck1_af_ea = image_base + ck1_af_rva

print(f"=== Поиск регистрации KeySync handler ===")
print(f"ck1.af addr: 0x{ck1_af_ea:X}")

# Ищем ВСЕ вызовы ck1.af
print(f"\n=== Все XRefs к ck1.af ===")
for ref in idautils.XrefsTo(ck1_af_ea):
    caller = ref.frm
    func = idaapi.get_func(caller)
    func_name = idc.get_func_name(caller) if func else "?"
    
    # Читаем инструкции вокруг вызова, ищем mov с 0x253 (595)
    # Типичный паттерн: mov edx, 595; call ck1.af
    # Или: mov edx, 40h; ...; call ck1.af (GetClusterData)
    # Читаем 20 инструкций назад от вызова
    for offset in range(-60, 0, 1):
        ea = caller + offset
        if idc.is_code(idc.get_full_flags(ea)):
            mnem = idc.print_insn_mnem(ea)
            op1 = idc.print_operand(ea, 0)
            op2 = idc.print_operand(ea, 1)
            if "mov" in mnem and (".253" in op2 or "595" in op2 or "0x253" in op2):
                print(f"  {func_name} @ 0x{caller:X}: {mnem} {op1}, {op2}")
                break
    
    print(f"  Caller: 0x{caller:X} ({func_name})")

# Дополнительно: ищем все константы 595 в .text, которые используются как arg
print(f"\n=== Поиск константы 595 (KeySync code) ===")
for head in idautils.Heads():
    if idc.is_code(idc.get_full_flags(head)):
        for i in range(8):  # проверяем операнды
            op = idc.print_operand(head, i)
            if "595" in op or "0x253" in op:
                func = idaapi.get_func(head)
                fname = idc.get_func_name(head) if func else "?"
                print(f"  0x{head:X} в {fname}: {idc.GetDisasm(head)}")
