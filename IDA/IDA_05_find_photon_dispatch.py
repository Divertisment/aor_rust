# IDA_05_find_photon_dispatch.py
# Ищет Photon dispatch/OnEvent паттерны в il2cpp и .text
import idc, idaapi

base = idaapi.get_imagebase()
print("=" * 60)
print("IDA_05_find_photon_dispatch.py - search for photon dispatch/jump tables in cr0.* functions")
print("=" * 60)

# Паттерн: вызов виртуальной функции с switch по event code
# Ищем switch таблицы (jump tables) рядом с нашими адресами

# Адреса cr0.* функций (RVA в il2cpp)
targets = {
    "cr0.ael": 0x526A2F0,
    "cr0.v":   0x526A740,
    "cr0.u":   0x526CEE0,
    "cr0.ahx": 0x526EAF0,
}

for name, rva in targets.items():
    ea = base + rva
    func = idaapi.get_func(ea)
    if not func:
        continue
    
    print(f"\n=== {name} @ 0x{ea:X} ===")
    
    # Ищем switch jump tables внутри функции
    for head in idautils.Heads(func.start_ea, func.end_ea):
        insn = idaapi.insn_t()
        if idaapi.decode_insn(insn, head):
            # Ищем jump tables
            try:
                has_jumps = hasattr(insn, 'jumps') and len(insn.jumps) > 0
                if has_jumps:
                    jcount = 0
                    for j in range(256):
                        t = insn.jumps[j]
                        if t not in (0, idaapi.BADADDR, None):
                            jcount += 1
                    if jcount > 0:
                        print(f"  jump table @ 0x{head:X}: {idc.generate_disasm_line(head, 0)} ({jcount} entries)")
                        for j in range(256):
                            t = insn.jumps[j]
                            if t not in (0, idaapi.BADADDR, None):
                                tf = idc.get_func_name(t) or ""
                                print(f"    case {j}: 0x{t:X} {tf}")
            except:
                pass
    
    # Ищем вызовы функций через указатели (call [reg+offset])
    print(f"  searching indirect calls in range 0x{func.start_ea:X}-0x{func.end_ea:X}...")
    call_count = 0
    for head in idautils.Heads(func.start_ea, func.end_ea):
        mnem = idc.print_insn_mnem(head)
        if mnem not in ('call', 'jmp'):
            continue
        op = idc.print_operand(head, 0)
        if 'qword ptr' in op or '[' in op:
            call_count += 1
            if call_count <= 20:
                print(f"    indirect {mnem} @ 0x{head:X}: {idc.generate_disasm_line(head, 0)}")

    if call_count > 20:
        print(f"    ... and {call_count-20} more indirect calls")
    elif call_count == 0:
        print(f"    no indirect calls found")
