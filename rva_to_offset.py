#!/usr/bin/env python3
r"""
rva_to_offset.py — map an Il2CppDumper `Address` (which is an RVA / virtual
address) to a file offset inside the GameAssembly.so ELF, by shelling
out to `readelf -l` (battle-tested parser) instead of hand-rolling one.

Background
----------
Il2CppDumper's `Address` field is the RVA = `p_vaddr` of the method.
When the dynamic loader maps the ELF into memory, it lays out the
PT_LOAD segments using `p_vaddr`, NOT `p_offset`.  So the runtime
address of a method is `module_base + RVA` (Pass D in
scan_passability.py already does this).

For STATIC analysis (xxd, hex editor, offline disassembly) we instead
need the file offset so we can read the bytes from the .so on disk.
That translation is: `file_offset = p_offset + (RVA - p_vaddr)`.

Usage
-----
    # Single RVA
    python rva_to_offset.py /mnt/hgfs/D/AOR_ubu/GameAssembly.so 0x1c1d818

    # Bulk: add FILE_OFFSET_HEX column to a TSV from filter_il2cpp_json.py
    python rva_to_offset.py /mnt/hgfs/D/AOR_ubu/GameAssembly.so \
        --bulk map_methods.tsv -o map_methods_with_offset.tsv

    # Show all PT_LOAD segments and their mapping
    python rva_to_offset.py /mnt/hgfs/D/AOR_ubu/GameAssembly.so --print-segments

Notes
-----
* Falls back to `llvm-readelf` / `greadelf` if GNU `readelf` is not on
  PATH (typical on macOS without binutils).
* Only PT_LOAD segments are considered; DWARF debug sections don't
  affect runtime.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# readelf -l output parser.
#
# Example section we care about (from `readelf -l --wide GameAssembly.so`):
#
#   LOAD           0x000000000000 0x0000000000000000 0x0000000000000000
#                  0x0000000000b1b150 0x0000000000b1b150  R E    0x1000
#
# We capture (vaddr, memsz, offset) - filesz, flags, align ignored.
# ---------------------------------------------------------------------------
_LOAD_LINE_RE = re.compile(
    r"^\s*LOAD\s+"
    r"0x(?P<offset>[0-9a-f]+)\s+"
    r"0x(?P<vaddr>[0-9a-f]+)\s+"
    r"0x(?P<paddr>[0-9a-f]+)\s+"
    r"0x(?P<filesz>[0-9a-f]+)\s+"
    r"0x(?P<memsz>[0-9a-f]+)\s+"
    r"(?P<flags>[RWE ]+)\s+"
    r"0x(?P<align>[0-9a-f]+)\s*$"
)


def _find_readelf() -> str | None:
    """Locate a working readelf binary on PATH."""
    for name in ("readelf", "llvm-readelf", "greadelf"):
        path = shutil.which(name)
        if path is not None:
            return path
    return None


def parse_pt_load(elf: str | Path) -> list[tuple[int, int, int]]:
    """Return list of (p_vaddr, p_memsz, p_offset) for every PT_LOAD.

    Sorts ascending by p_vaddr so a linear scan is correct.
    """
    readelf = _find_readelf()
    if readelf is None:
        print("[!] no readelf/llvm-readelf found on PATH", file=sys.stderr)
        print("    install binutils (apt install binutils / brew install binutils)",
              file=sys.stderr)
        raise SystemExit(3)

    try:
        out = subprocess.run(
            [readelf, "-l", "--wide", str(elf)],
            check=True, capture_output=True, text=True, timeout=15,
        )
    except subprocess.CalledProcessError as e:
        print(f"[!] {readelf} returned {e.returncode}", file=sys.stderr)
        print(e.stderr, file=sys.stderr)
        raise SystemExit(4)
    except subprocess.TimeoutExpired:
        print(f"[!] {readelf} timed out", file=sys.stderr)
        raise SystemExit(5)

    segs: list[tuple[int, int, int]] = []
    for ln in out.stdout.splitlines():
        m = _LOAD_LINE_RE.match(ln)
        if not m:
            continue
        vaddr  = int(m.group("vaddr"),  16)
        memsz  = int(m.group("memsz"),  16)
        offset = int(m.group("offset"), 16)
        segs.append((vaddr, memsz, offset))
    segs.sort()
    return segs


def rva_to_offset(rva: int,
                  segs: list[tuple[int, int, int]]) -> int | None:
    """Translate an RVA to a file offset.  Returns None if RVA falls in
    no PT_LOAD segment."""
    for p_vaddr, p_memsz, p_offset in segs:
        if p_vaddr <= rva < p_vaddr + p_memsz:
            return p_offset + (rva - p_vaddr)
    return None


def _parse_rva(s: str) -> int:
    s = s.strip()
    if s.startswith(("0x", "0X")):
        return int(s, 16)
    return int(s, 0)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("elf", help="path to the ELF (.so) file")
    p.add_argument("rva", nargs="?",
                   help="single RVA to convert (hex 0x... or decimal)")
    p.add_argument("--bulk", metavar="TSV",
                   help="read a TSV with RVA_HEX in column 1; "
                        "append FILE_OFFSET_HEX column")
    p.add_argument("-o", "--output",
                   help="output TSV (only with --bulk; default: stdout)")
    p.add_argument("--print-segments", action="store_true",
                   help="print all PT_LOAD segments and exit")
    args = p.parse_args(argv)

    if not Path(args.elf).exists():
        print(f"[!] file not found: {args.elf}", file=sys.stderr)
        return 6

    segs = parse_pt_load(args.elf)
    if args.print_segments:
        print(f"PT_LOAD segments in {args.elf} (via readelf -l):")
        for v, msz, off in segs:
            print(f"  vaddr=0x{v:08x}  memsz=0x{msz:08x}  "
                  f"file_off=0x{off:08x}")
        return 0

    if args.bulk:
        with open(args.bulk, encoding='utf-8') as f:
            lines = f.readlines()
        if not lines:
            print("[!] bulk input is empty", file=sys.stderr)
            return 1
        header = lines[0].rstrip('\n')
        rows = [ln.rstrip('\n').split('\t') for ln in lines[1:]]
        out_fh = (open(args.output, 'w', encoding='utf-8')
                  if args.output else sys.stdout)
        out_fh.write(f"{header}\tFILE_OFFSET_HEX\n")
        n_ok = n_missing = 0
        for row in rows:
            rva = _parse_rva(row[0])
            off = rva_to_offset(rva, segs)
            tag = f"0x{off:x}" if off is not None else "<not-mapped>"
            if off is None:
                n_missing += 1
            else:
                n_ok += 1
            out_fh.write('\t'.join(row) + f"\t{tag}\n")
        if out_fh is not sys.stdout:
            out_fh.close()
        print(f"[done] {n_ok} mapped, {n_missing} not-mapped", file=sys.stderr)
        return 0

    if args.rva:
        rva = _parse_rva(args.rva)
        off = rva_to_offset(rva, segs)
        if off is None:
            print(f"RVA 0x{rva:x} is not in any PT_LOAD segment of {args.elf}",
                  file=sys.stderr)
            return 2
        print(f"0x{off:x}")
        return 0

    p.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
