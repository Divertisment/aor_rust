#!/usr/bin/env python3
"""
analyze_elf_signatures.py — Find AOB signatures for global pointer references in ELF binaries.

Uses PT_LOAD program headers for correct VAddr ↔ FileOffset translation.

x86_64 patterns:
  48 8B 05 ?? ?? ?? ??   MOV RAX, [RIP + disp32]
  48 8B 0D ?? ?? ?? ??   MOV RCX, [RIP + disp32]
  48 8B 15 ?? ?? ?? ??   MOV RDX, [RIP + disp32]
  48 8D 05 ?? ?? ?? ??   LEA RAX, [RIP + disp32]
  48 8D 0D ?? ?? ?? ??   LEA RCX, [RIP + disp32]

Output:
  - File offset of instruction
  - Runtime VAddr of instruction (relative to module base)
  - Target VAddr of the referenced pointer
  - File offset of target
  - IDA-style signature with wildcards
"""

import struct
import sys
import os
from collections import Counter

# ── RIP-relative opcode patterns (x86_64) ──────────────────────────────
# Format: (mnemonic, pattern_bytes, modrm_reg)
PATTERNS = [
    ("MOV RAX", bytes([0x48, 0x8B, 0x05]), 0),  # 48 8B 05
    ("MOV RCX", bytes([0x48, 0x8B, 0x0D]), 1),  # 48 8B 0D
    ("MOV RDX", bytes([0x48, 0x8B, 0x15]), 2),  # 48 8B 15
    ("MOV RBX", bytes([0x48, 0x8B, 0x1D]), 3),  # 48 8B 1D
    ("MOV RSI", bytes([0x48, 0x8B, 0x35]), 6),  # 48 8B 35
    ("MOV RDI", bytes([0x48, 0x8B, 0x3D]), 7),  # 48 8B 3D
    ("LEA RAX", bytes([0x48, 0x8D, 0x05]), 0),  # 48 8D 05
    ("LEA RCX", bytes([0x48, 0x8D, 0x0D]), 1),  # 48 8D 0D
    ("LEA RDX", bytes([0x48, 0x8D, 0x15]), 2),  # 48 8D 15
    ("LEA RBX", bytes([0x48, 0x8D, 0x1D]), 3),  # 48 8D 1D
    ("LEA RSI", bytes([0x48, 0x8D, 0x35]), 6),  # 48 8D 35
    ("LEA RDI", bytes([0x48, 0x8D, 0x3D]), 7),  # 48 8D 3D
]


def read_elf_program_headers(path):
    """
    Parse ELF and return PT_LOAD segments.
    Returns list of dicts with: p_type, p_flags, p_offset, p_vaddr, p_filesz, p_memsz
    """
    with open(path, "rb") as f:
        ident = f.read(16)
        if ident[:4] != b"\x7fELF":
            raise ValueError("Not an ELF file")

        is_64bit = ident[4] == 2
        endian = "<" if ident[5] == 1 else ">"

        if is_64bit:
            f.seek(0x20)  # e_phoff
            e_phoff = struct.unpack(endian + "Q", f.read(8))[0]
            f.seek(0x36)  # e_phentsize
            e_phentsize = struct.unpack(endian + "H", f.read(2))[0]
            e_phnum = struct.unpack(endian + "H", f.read(2))[0]

            segments = []
            for i in range(e_phnum):
                f.seek(e_phoff + i * e_phentsize)
                phdr = f.read(e_phentsize)
                p_type = struct.unpack(endian + "I", phdr[0:4])[0]
                p_flags = struct.unpack(endian + "I", phdr[4:8])[0]
                p_offset = struct.unpack(endian + "Q", phdr[8:16])[0]
                p_vaddr = struct.unpack(endian + "Q", phdr[16:24])[0]
                p_paddr = struct.unpack(endian + "Q", phdr[24:32])[0]
                p_filesz = struct.unpack(endian + "Q", phdr[32:40])[0]
                p_memsz = struct.unpack(endian + "Q", phdr[40:48])[0]
                p_align = struct.unpack(endian + "Q", phdr[48:56])[0]
                segments.append({
                    "type": p_type,
                    "flags": p_flags,
                    "offset": p_offset,
                    "vaddr": p_vaddr,
                    "filesz": p_filesz,
                    "memsz": p_memsz,
                    "align": p_align,
                })
        else:
            f.seek(0x1C)
            e_phoff = struct.unpack(endian + "I", f.read(4))[0]
            f.seek(0x2A)
            e_phentsize = struct.unpack(endian + "H", f.read(2))[0]
            e_phnum = struct.unpack(endian + "H", f.read(2))[0]

            segments = []
            for i in range(e_phnum):
                f.seek(e_phoff + i * e_phentsize)
                phdr = f.read(e_phentsize)
                p_type = struct.unpack(endian + "I", phdr[0:4])[0]
                p_offset = struct.unpack(endian + "I", phdr[4:8])[0]
                p_vaddr = struct.unpack(endian + "I", phdr[8:12])[0]
                p_paddr = struct.unpack(endian + "I", phdr[12:16])[0]
                p_filesz = struct.unpack(endian + "I", phdr[16:20])[0]
                p_memsz = struct.unpack(endian + "I", phdr[20:24])[0]
                p_flags = struct.unpack(endian + "I", phdr[24:28])[0]
                p_align = struct.unpack(endian + "I", phdr[28:32])[0]
                segments.append({
                    "type": p_type,
                    "flags": p_flags,
                    "offset": p_offset,
                    "vaddr": p_vaddr,
                    "filesz": p_filesz,
                    "memsz": p_memsz,
                    "align": p_align,
                })

    return segments, is_64bit, endian


def get_data_sections_from_phdrs(segments):
    """
    Derive data region boundaries from non-executable PT_LOAD segments.
    Returns list of (vaddr_start, vaddr_end, name).
    """
    data_regions = []
    for seg in segments:
        if seg["type"] != 1:  # PT_LOAD
            continue
        if seg["flags"] & 1:  # PF_X = executable, skip
            continue
        if seg["flags"] & 2:  # PF_W = writable (data, bss)
            name = ".data"
        else:  # read-only data
            name = ".rodata"
        data_regions.append((seg["vaddr"], seg["vaddr"] + seg["memsz"], name, seg))
    return data_regions


def target_in_data(target_vaddr, data_regions):
    """Check if a VAddr falls within any data region."""
    for start, end, name, _ in data_regions:
        if start <= target_vaddr < end:
            return name, target_vaddr - start
    return None, None


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 analyze_elf_signatures.py <path_to_elf> [--data-only]")
        sys.exit(1)

    path = sys.argv[1]
    data_only = "--data-only" in sys.argv

    print(f"[*] Analyzing: {path}")
    print(f"[*] File size: {os.path.getsize(path) / 1024 / 1024:.1f} MB")

    segments, is_64bit, endian = read_elf_program_headers(path)
    print(f"[*] ELF: {'64-bit' if is_64bit else '32-bit'}, {'Little' if endian == '<' else 'Big'} Endian")
    print(f"[*] Program headers: {len(segments)}")

    # Find PT_LOAD executable segment(s)
    exec_segs = [s for s in segments if s["type"] == 1 and (s["flags"] & 1)]  # PT_LOAD + PF_X
    if not exec_segs:
        print("[-] No executable PT_LOAD segment found")
        sys.exit(1)

    print(f"\n[*] Executable PT_LOAD segments:")
    for i, seg in enumerate(exec_segs):
        mb = seg["filesz"] / 1048576
        print(f"    [{i}] offset=0x{seg['offset']:x}  vaddr=0x{seg['vaddr']:x}  "
              f"filesz={mb:.1f} MB  memsz={seg['memsz']/1048576:.1f} MB  "
              f"flags={'R' if seg['flags']&4 else ''}{'W' if seg['flags']&2 else ''}{'X' if seg['flags']&1 else ''}")

    # Get data regions for filtering
    data_regions = get_data_sections_from_phdrs(segments)
    print(f"\n[*] Data regions (for target filtering):")
    for start, end, name, _ in data_regions:
        print(f"    {name}: 0x{start:x} - 0x{end:x} ({(end-start)/1024:.1f} KB)")

    results = []

    for seg_idx, seg in enumerate(exec_segs):
        # Read the segment data from file
        with open(path, "rb") as f:
            f.seek(seg["offset"])
            code_data = f.read(seg["filesz"])

        seg_vaddr = seg["vaddr"]  # Base VAddr of this segment
        print(f"\n[*] Scanning segment [{seg_idx}] ({len(code_data)/1024:.0f} KB)...")

        for mnemonic, pat_bytes, reg_num in PATTERNS:
            pat_len = len(pat_bytes)
            pos = 0
            count = 0
            while True:
                pos = code_data.find(pat_bytes, pos)
                if pos == -1 or pos + 7 > len(code_data):
                    break

                # Instruction layout:
                #   [0..2] = opcode + modrm (3 bytes: 48 8B 05 etc.)
                #   [3..6] = disp32 (signed, little-endian)
                disp = struct.unpack_from("<i", code_data, pos + 3)[0]

                # Runtime VAddr of this instruction (relative to module base)
                instr_vaddr = seg_vaddr + pos

                # Target VAddr = instr_vaddr + instruction_length + displacement
                # instruction_length = 7 bytes (3 bytes opcode/modrm + 4 bytes disp32)
                target_vaddr = instr_vaddr + 7 + disp

                results.append({
                    "seg_idx": seg_idx,
                    "file_offset": seg["offset"] + pos,
                    "instr_vaddr": instr_vaddr,
                    "mnemonic": mnemonic,
                    "disp": disp,
                    "target_vaddr": target_vaddr,
                })

                pos += 1
                count += 1
        # end for pattern
    # end for segment

    if not results:
        print("[-] No RIP-relative patterns found")
        sys.exit(0)

    # Filter by target in data regions
    if data_only:
        filtered = []
        for r in results:
            name, offs = target_in_data(r["target_vaddr"], data_regions)
            if name:
                r["target_section"] = name
                r["target_offset"] = offs
                filtered.append(r)
        results = filtered
    else:
        for r in results:
            name, offs = target_in_data(r["target_vaddr"], data_regions)
            r["target_section"] = name if name else "?"
            r["target_offset"] = offs if offs else 0

    # Sort by target_vaddr for grouping
    results.sort(key=lambda r: r["target_vaddr"])

    # Group by target
    targets = Counter(r["target_vaddr"] for r in results)

    print(f"\n{'='*100}")
    print(f"{'Target VAddr':>18} {'Section':>12} {'Offset':>10} {'Refs':>5}  {'Example Instr':>40}")
    print(f"{'='*100}")

    shown = 0
    for target_vaddr, count in targets.most_common(50):
        name, offs = target_in_data(target_vaddr, data_regions)
        if not name:
            name = "?"
            offs = 0

        # Find first reference to this target for the example
        example = None
        for r in results:
            if r["target_vaddr"] == target_vaddr:
                example = r
                break

        if example is None:
            continue

        # Generate signature from first reference
        sig_offset_in_seg = example["instr_vaddr"] - exec_segs[example["seg_idx"]]["vaddr"]
        sig_file_off = exec_segs[example["seg_idx"]]["offset"] + sig_offset_in_seg

        # Build signature:
        # 48 8B/8D ?5 ?? ?? ?? ??  where ?5 encodes the destination register
        # The modrm byte (at file offset + 2) has reg bits [5:3] that vary
        # We use ?? for the modrm byte to make it a wildcard
        op_byte = "8B" if "MOV" in example["mnemonic"] else "8D"
        sig = f"48 {op_byte} ?5 ? ? ? ?"

        shown += 1
        if shown > 40:
            print(f"  ... and {len(targets) - 40} more targets")
            break

        print(f"0x{target_vaddr:016x}  {name:<12} +0x{offs:06x}  {count:4d}x  "
              f"{sig}  ; at file+0x{sig_file_off:x}")

    # Also show the most referenced targets with section mapping
    data_targets = {t: c for t, c in targets.items() if target_in_data(t, data_regions)[0]}
    if data_targets:
        print(f"\n[*] Hot data structure candidates (most referenced .data/.rodata targets):")
        for target_vaddr, count in Counter(data_targets).most_common(15):
            name, offs = target_in_data(target_vaddr, data_regions)
            print(f"    0x{target_vaddr:016x} ({name}+0x{offs:x}) — {count} references")

    # Generate kernel-ready AOB signature for the most interesting target
    if data_targets:
        top_target = max(data_targets, key=data_targets.get)
        print(f"\n[*] Most referenced data target: 0x{top_target:016x}")
        print(f"[*] This is likely the global entity manager or a hot static field.")
        print(f"[*] To generate kernel AOB:")
        print(f"    - Find this pattern in runtime .text")
        print(f"    - Read at runtime_vaddr + 7 + disp32 = pointer to target data")

    print(f"\n[*] Total RIP-relative instructions: {len(results)}")
    print(f"[*] Unique targets: {len(targets)}")


if __name__ == "__main__":
    main()
