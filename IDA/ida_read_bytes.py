# read_bytes.py - читает 16 байт по адресу
import idc
ea = idaapi.get_imagebase() + 0x19E8E88
b = [idc.get_wide_byte(ea+i) for i in range(16)]
h = ' '.join(f'{x:02X}' for x in b)
print(f"0x{ea:X}: {h}")
print(f"Первые 4 байта как DWORD: 0x{b[0]:02X}{b[1]:02X}{b[2]:02X}{b[3]:02X} = {b[0] | b[1]<<8 | b[2]<<16 | b[3]<<24}")
