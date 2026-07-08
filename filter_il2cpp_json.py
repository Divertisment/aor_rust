#!/usr/bin/env python3
"""
filter_il2cpp_json.py — filter Il2CppDumper's AOscript.json for candidate
methods, output a TSV that is easy to `column -t`, `sort`, open in a
spreadsheet, or feed into `rva_to_offset.py --bulk` / IDA.

Typical use:

    # Find all methods on Map/Grid/Nav/Pass classes that Load/Init/Get/etc.
    python filter_il2cpp_json.py \\
        -i "/mnt/hgfs/D/AOR ubu/AOscript.json" \\
        --cls "Map|Grid|Nav|Pass|Block|Cluster|Tile|Terrain|World|Hard|Solid|Walk" \\
        --met "Load|Get|Init|Update|Apply|Refresh|Build|Create|On|Set" \\
        -o map_methods.tsv

    # Just dump everything (no filter)
    python filter_il2cpp_json.py --no-class-regex --no-method-regex -o all.tsv

    # Limit to 100 hits for triage
    python filter_il2cpp_json.py --cls "Cluster" --met "Get" --limit 100

OUTPUT TSV columns:
    RVA_HEX      e.g. 0x1c1d818     (matches IDA's "Go to address" input)
    CLASS        e.g. Cluster.GetData
    METHOD       e.g. GetData
    FULL_NAME    e.g. Cluster$$GetData (Il2CppDumper scope form)
    SIGNATURE    e.g. "int32_t Cluster__GetData (Cluster_o* __this, ...)"

The file is streamed line-by-line so we never materialise the 112MB
JSON tree in memory.  We do a single regex over the ScriptMethod
substring (still ~110MB of text) which is fast in CPython.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Defaults — tuned for the passability/collision-map hunt in Albion Online.
# ---------------------------------------------------------------------------
DEFAULT_INPUT = "/mnt/hgfs/D/AOR ubu/AOscript.json"
DEFAULT_CLS   = r"Map|Grid|Nav|Pass|Block|Cluster|Tile|Terrain|World|Hard|Solid|Walk"
DEFAULT_MET   = r"Load|Get|Init|Update|Apply|Refresh|Build|Create|On|Set|Check|Step|Tick"

# Regex that captures a single ScriptMethod entry's three core fields.
# We rely on the fact that Il2CppDumper emits one pretty-printed entry per
# 4-5-line block, and within a block the field order is fixed:
#     Address, Name, Signature, TypeSignature
ENTRY_RE = re.compile(
    r'"Address"\s*:\s*(\d+)\s*,\s*'                  # int
    r'"Name"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*'        # string
    r'"Signature"\s*:\s*"((?:[^"\\]|\\.)*)"'          # string
)


def find_scriptmethod_span(text: str) -> tuple[int, int]:
    """Return [start, end) of the ScriptMethod array body in `text`.

    Handles escaped quotes inside JSON strings so we don't get confused
    by a stray `"` inside a Signature.
    """
    m = re.search(r'"ScriptMethod"\s*:\s*\[', text)
    if not m:
        raise ValueError("`ScriptMethod` key not found in JSON")
    i = m.end()
    depth = 1
    n = len(text)
    while i < n and depth > 0:
        c = text[i]
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
        elif c == '"':
            # Skip over a JSON string literal, including \" escapes.
            i += 1
            while i < n and text[i] != '"':
                if text[i] == '\\':
                    i += 1
                i += 1
        i += 1
    if depth != 0:
        raise ValueError("`ScriptMethod` array never closed")
    return m.end(), i - 1


def iter_methods(text: str):
    """Yield (address:int, name:str, signature:str) for every method."""
    start, end = find_scriptmethod_span(text)
    for m in ENTRY_RE.finditer(text, start, end):
        addr = int(m.group(1))
        name = m.group(2)
        sig  = m.group(3)
        yield addr, name, sig


def split_name(name: str) -> tuple[str, str]:
    """`Foo$$Bar$$Baz` -> (`Foo.Bar`, `Baz`).

    The rightmost `$$` separates method from class.  Earlier `$$` are
    nested-class boundaries (Il2CppDumper uses $$ for both); we
    convert them to `.` so the TSV reads naturally in a spreadsheet.
    """
    if '$$' not in name:
        return '', name
    cls_raw, met = name.rsplit('$$', 1)
    cls = cls_raw.replace('$$', '.')
    return cls, met


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("-i", "--input", default=DEFAULT_INPUT,
                   help=f"AOscript.json path (default: {DEFAULT_INPUT})")
    p.add_argument("--cls", default=DEFAULT_CLS,
                   help="regex matched against the class portion of `Name`")
    p.add_argument("--met", default=DEFAULT_MET,
                   help="regex matched against the method portion of `Name`")
    p.add_argument("--no-class-regex",  action="store_true",
                   help="disable class-name filter (match every class)")
    p.add_argument("--no-method-regex", action="store_true",
                   help="disable method-name filter (match every method)")
    p.add_argument("--limit", type=int, default=0,
                   help="stop after N hits (0 = no limit)")
    p.add_argument("-o", "--output", default=None,
                   help="output TSV path (default: stdout)")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="print progress to stderr")
    args = p.parse_args(argv)

    cls_re = None if args.no_class_regex  else re.compile(args.cls)
    met_re = None if args.no_method_regex else re.compile(args.met)

    # One read of the file is unavoidable, but we never call json.loads()
    # on the full document (which would ~2x peak RAM via the parser's
    # intermediate dicts).
    in_path = Path(args.input)
    if args.verbose:
        print(f"[*] reading {in_path} ({in_path.stat().st_size/1e6:.1f} MB)",
              file=sys.stderr)
    text = in_path.read_text(encoding='utf-8', errors='replace')
    if args.verbose:
        print(f"[*] parsing ScriptMethod array…", file=sys.stderr)

    out_fh = open(args.output, 'w', encoding='utf-8') if args.output else sys.stdout
    out_fh.write("RVA_HEX\tCLASS\tMETHOD\tFULL_NAME\tSIGNATURE\n")

    n_total = 0
    n_hits  = 0
    for addr, name, sig in iter_methods(text):
        n_total += 1
        cls, met = split_name(name)
        if cls_re and not cls_re.search(cls):
            continue
        if met_re and not met_re.search(met):
            continue
        out_fh.write(f"0x{addr:x}\t{cls}\t{met}\t{name}\t{sig}\n")
        n_hits += 1
        if args.limit and n_hits >= args.limit:
            break

    if out_fh is not sys.stdout:
        out_fh.close()

    if args.verbose:
        print(f"[+] scanned {n_total:,} methods, {n_hits:,} matched",
              file=sys.stderr)
    else:
        print(f"[done] {n_hits:,}/{n_total:,} methods matched", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
