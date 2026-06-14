# 5_find_photon_dispatch.py
# Ищет dispatch-функции Photon: получает событие и вызывает ael
import idautils, idc

# 1. Ищем все функции с Dispatch в имени
print("=== Dispatch/Receive функции ===")
for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    if ".text" not in idc.get_segm_name(ea):
        continue
    for kw in ["Dispatch", "dispatch", "RECEIVE", "Receive", "receive", "OnEvent", "on_event"]:
        if kw in name:
            print(f"  {hex(ea)} -> {name}")
            break

# 2. Ищем функции, которые вызывают ael через vtable
# slot 6 = ael. Вызов через call [rax+30h] или похожий
print("\n=== Функции, содержащие вызовы ael (slot 6) ===")
for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    if ".text" not in idc.get_segm_name(ea):
        continue
    # Проверяем первые инструкции
    func_name = name.lower()
    for kw in ["traffic", "receive", "dispatch", "event", "process", "message", "photon", "loadbalanc", "peer"]:
        if kw in func_name:
            print(f"  {hex(ea)} -> {name}")
            break

# 3. Ищем все функции с подстрокой "photon" или "Peer"
print("\n=== Функции с 'Peer' или 'Photon' ===")
for ea in idautils.Functions():
    name = idc.get_func_name(ea).lower()
    if ".text" in idc.get_segm_name(ea):
        continue
