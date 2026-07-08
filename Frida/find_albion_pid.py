import frida
import sys

# Варианты возможных имён процесса
game_names = ["Albion-Online", "Albion Online", "Albion"]

try:
    device = frida.get_local_device()
    print("Подключено к локальному устройству Frida.")

    processes = device.enumerate_processes()
    found = False

    for name_variant in game_names:
        if found:
            break
        for process in processes:
            if name_variant.lower() in process.name.lower():
                print(f"Найден процесс:")
                print(f"  Название: {process.name}")
                print(f"  PID: {process.pid}")
                found = True
                break

    if not found:
        print("Процесс не найден среди запущенных.")
        print("Запущенные процессы (первые 30):")
        for p in processes[:30]:
            print(f"  PID: {p.pid}, Name: {p.name}")

except frida.TransportError as e:
    print(f"Ошибка подключения к Frida. Убедитесь, что 'frida-server' запущен (возможно, через sudo). Детали: {e}")
except Exception as e:
    print(f"Ошибка: {e}")
