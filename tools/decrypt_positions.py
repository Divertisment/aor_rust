#!/usr/bin/env python3
"""
decrypt_positions.py — Offline Photon Move-decryption from pcap.

Algorithm (from Stas.AOR source — pure XOR with 8-byte KeySync salt):
  X[0..3] XOR salt[0..3]  →  float32 (little-endian)
  Y[0..3] XOR salt[4..7]  →  float32 (little-endian)

Photon protocol layout on UDP 5055:
  [12-byte Photon header] [N commands]
  Each command: [12-byte cmd header] [payload]
    cmd_type 6/7 = reliable/unreliable
      [1-byte signal] [1-byte msg_type] [msg payload]
        msg_type=4 (event): [1-byte event_code] [parameters]
          For Move (3): param[1] = byte[] (len>=17), pos at offset 9..17
          For KeySync (598): param[k] = byte[8] (the salt)

Usage:
  python3 decrypt_positions.py capture.pcap                  # default port 5055
  python3 decrypt_positions.py capture.pcap 5055             # explicit port
  python3 decrypt_positions.py capture.pcap 5055 moves.csv   # dump to CSV
  sudo python3 decrypt_positions.py --live                   # live capture (needs root)

Requires: scapy (pip install scapy)
"""

import sys
import struct
import argparse
from scapy.all import rdpcap, UDP, sniff


# ─── Photon protocol constants ────────────────────────────────────────────
PHOTON_HEADER_LEN = 12
CMD_HEADER_LEN = 12
KEYSYNC_CODE = 598   # EventCode.KeySync
MOVE_CODE = 3        # EventCode.Move
MSG_TYPE_EVENT = 4

# Photon type codes (from Protocol18Type.cs)
T_NULL = 0x00
T_BOOL = 0x01
T_SHORT = 0x02
T_INT = 0x03
T_LONG = 0x04
T_FLOAT = 0x05
T_DOUBLE = 0x06
T_STRING = 0x07
T_BYTE_ARRAY = 0x14
T_INT_ARRAY = 0x21


# ─── Photon parsing helpers ───────────────────────────────────────────────
def parse_photon_header(data):
    """Parse 12-byte Photon header. Returns (peer_id, flags, command_count)."""
    if len(data) < PHOTON_HEADER_LEN:
        return None
    peer_id = struct.unpack('>H', data[0:2])[0]
    flags = data[2]
    command_count = data[3]
    # bytes 4-11: timestamp(4) + challenge(4)
    return (peer_id, flags, command_count)


def parse_commands(data, command_count):
    """Parse N commands from Photon payload, yield (msg_type, msg_payload, channel_id)."""
    offset = PHOTON_HEADER_LEN
    for _ in range(command_count):
        if offset + CMD_HEADER_LEN > len(data):
            break
        cmd_type = data[offset]
        channel_id = data[offset + 1]
        # data[offset+2:offset+3] = commandFlags
        # data[offset+3] = reserved
        cmd_len = struct.unpack('>I', data[offset+4:offset+8])[0]
        # data[offset+8:offset+12] = reliableSequenceNumber
        if offset + cmd_len > len(data):
            break

        # Only reliable (6) and unreliable (7) carry messages
        if cmd_type in (6, 7):
            msg_start = offset + CMD_HEADER_LEN
            if msg_start + 2 <= offset + cmd_len:
                # data[msg_start] = signal byte
                msg_type = data[msg_start + 1]
                msg_payload = data[msg_start + 2:offset + cmd_len]
                yield (msg_type, msg_payload, channel_id)

        offset += cmd_len


def parse_typed_value(data, type_code):
    """Parse a single Photon-typed value, return (value, bytes_consumed)."""
    if type_code == T_NULL:
        return None, 0
    elif type_code == T_BOOL:
        if len(data) < 1: return None, 0
        return bool(data[0]), 1
    elif type_code == T_SHORT:
        if len(data) < 2: return None, 0
        return struct.unpack('>h', data[0:2])[0], 2
    elif type_code == T_INT:
        if len(data) < 4: return None, 0
        return struct.unpack('>i', data[0:4])[0], 4
    elif type_code == T_LONG:
        if len(data) < 8: return None, 0
        return struct.unpack('>q', data[0:8])[0], 8
    elif type_code == T_FLOAT:
        if len(data) < 4: return None, 0
        return struct.unpack('>f', data[0:4])[0], 4
    elif type_code == T_DOUBLE:
        if len(data) < 8: return None, 0
        return struct.unpack('>d', data[0:8])[0], 8
    elif type_code == T_STRING:
        if len(data) < 2: return None, 0
        slen = struct.unpack('>H', data[0:2])[0]
        if len(data) < 2 + slen: return None, 0
        return data[2:2+slen].decode('utf-8', errors='replace'), 2 + slen
    elif type_code == T_BYTE_ARRAY:
        if len(data) < 4: return None, 0
        blen = struct.unpack('>I', data[0:4])[0]
        if len(data) < 4 + blen: return None, 0
        return bytes(data[4:4+blen]), 4 + blen
    elif type_code == T_INT_ARRAY:
        if len(data) < 4: return None, 0
        alen = struct.unpack('>I', data[0:4])[0]
        if len(data) < 4 + alen*4: return None, 0
        return [struct.unpack('>i', data[4+i*4:8+i*4])[0] for i in range(alen)], 4 + alen*4
    else:
        # Unknown type — can't advance safely. Caller will treat as parse error
        # and skip the rest of the event. KeySync (598) and Move (3) use only
        # whitelisted types, so this is only hit by misformed packets.
        return None, 0


def parse_event(msg_payload):
    """Parse event message payload, return (event_code, params_dict) or None."""
    if len(msg_payload) < 3:
        return None
    event_code = msg_payload[0]
    param_count = struct.unpack('>H', msg_payload[1:3])[0]
    offset = 3
    params = {}
    for _ in range(param_count):
        if offset + 1 > len(msg_payload):
            break
        key = msg_payload[offset]
        offset += 1
        if offset >= len(msg_payload):
            break
        type_code = msg_payload[offset]
        offset += 1
        value, consumed = parse_typed_value(msg_payload[offset:], type_code)
        if consumed == 0 and value is None and type_code != T_NULL:
            break
        offset += consumed
        params[key] = value
    return (event_code, params)


# ─── Decryption (the actual XOR) ──────────────────────────────────────────
def _xor_with_salt(bytes4, salt_8, salt_pos):
    """Mirror of Stas.AOR.Decrypt:  bytes4[i] ^= salt_8[i % (8 - saltPos) + saltPos]

    For 4-byte input this gives:
      X (saltPos=0): bytes4[i] ^= salt_8[i]       (i=0..3)  →  uses salt[0..3]
      Y (saltPos=4): bytes4[i] ^= salt_8[i+4]     (i=0..3)  →  uses salt[4..7]

    Works for any bytes4 length (faithful to source).
    """
    modulus = len(salt_8) - salt_pos
    return bytes(bytes4[i] ^ salt_8[i % modulus + salt_pos] for i in range(len(bytes4)))


def decrypt_position(enc_x, enc_y, salt_8):
    """Decrypt X and Y coordinates using 8-byte salt (matches Stas.AOR source)."""
    if len(salt_8) != 8:
        raise ValueError(f"salt must be 8 bytes, got {len(salt_8)}")

    x = _xor_with_salt(enc_x, salt_8, 0)
    y = _xor_with_salt(enc_y, salt_8, 4)

    # Little-endian float (.NET on x86/x64, which Photon targets, uses LE for BitConverter.ToSingle)
    x_f = struct.unpack('<f', x)[0]
    y_f = struct.unpack('<f', y)[0]
    return x_f, y_f


# ─── Main pipeline ────────────────────────────────────────────────────────
def process_packets(packets, port=5055, output_file=None, verbose=True):
    """Process list of scapy packets, extract KeySync salts + decrypt Move events."""
    current_salt = None
    last_salt_ts = None
    stats = {
        'salts_seen': 0,
        'moves_total': 0,
        'moves_decoded': 0,
        'moves_no_salt': 0,
        'moves_bad_param': 0,
        'moves_decode_fail': 0,
    }

    out_f = open(output_file, 'w') if output_file else None
    if out_f:
        out_f.write("ts,salt_ts,x,y,channel,raw_x_hex,raw_y_hex\n")

    try:
        for pkt in packets:
            if not pkt.haslayer(UDP):
                continue
            udp = pkt[UDP]
            if udp.sport != port and udp.dport != port:
                continue
            payload = bytes(udp.payload)
            if len(payload) < PHOTON_HEADER_LEN:
                continue

            hdr = parse_photon_header(payload)
            if hdr is None:
                continue
            peer_id, flags, cmd_count = hdr
            if flags == 1:
                # Encrypted packet (Photon-level encryption) — skip contents
                continue

            for msg_type, msg_payload, channel_id in parse_commands(payload, cmd_count):
                if msg_type != MSG_TYPE_EVENT:
                    continue
                ev = parse_event(msg_payload)
                if ev is None:
                    continue
                event_code, params = ev

                # ── KeySync: extract salt ──
                if event_code == KEYSYNC_CODE:
                    for key, val in params.items():
                        if isinstance(val, (bytes, bytearray)) and len(val) == 8:
                            current_salt = bytes(val)
                            last_salt_ts = pkt.time
                            stats['salts_seen'] += 1
                            if verbose and (stats['salts_seen'] <= 3 or stats['salts_seen'] % 10 == 0):
                                print(f"  [t={pkt.time:.2f}] SALT  key={key}  bytes={current_salt.hex()}")
                            break

                # ── Move: decrypt position ──
                elif event_code == MOVE_CODE:
                    stats['moves_total'] += 1
                    if current_salt is None:
                        stats['moves_no_salt'] += 1
                        continue
                    raw = params.get(1)
                    if not isinstance(raw, (bytes, bytearray)) or len(raw) < 17:
                        stats['moves_bad_param'] += 1
                        continue
                    enc_x = raw[9:13]
                    enc_y = raw[13:17]
                    try:
                        x, y = decrypt_position(enc_x, enc_y, current_salt)
                        stats['moves_decoded'] += 1
                        if out_f:
                            out_f.write(f"{pkt.time},{last_salt_ts},{x:.4f},{y:.4f},{channel_id},{enc_x.hex()},{enc_y.hex()}\n")
                    except Exception as e:
                        stats['moves_decode_fail'] += 1
                        if verbose and stats['moves_decode_fail'] <= 3:
                            print(f"  [!] Move decode fail: {e}")

    finally:
        if out_f:
            out_f.close()

    return stats


def main():
    ap = argparse.ArgumentParser(description="Offline Photon Move-decryption from pcap")
    ap.add_argument('pcap', nargs='?', help='pcap file (or --live)')
    ap.add_argument('port_pos', nargs='?', type=int, default=5055,
                    help='UDP port (default 5055; or 2nd positional before output)')
    ap.add_argument('output', nargs='?', help='Output CSV file')
    ap.add_argument('--live', action='store_true', help='Live capture mode (requires root)')
    ap.add_argument('--count', type=int, default=0, help='Stop after N packets (live mode only)')
    ap.add_argument('-q', '--quiet', action='store_true', help='Quiet mode')
    args = ap.parse_args()

    if args.live:
        print(f"[*] Live capture on UDP {args.port_pos}... Ctrl-C to stop")
        if args.output:
            print(f"    Writing to {args.output}")
        pkts = sniff(filter=f"udp port {args.port_pos}", count=args.count or 0)
        print(f"[*] Captured {len(pkts)} packets")
    else:
        if not args.pcap:
            ap.print_help()
            sys.exit(1)
        print(f"[*] Reading {args.pcap}...")
        pkts = rdpcap(args.pcap)
        print(f"[*] Total packets: {len(pkts)}")

    stats = process_packets(pkts, port=args.port_pos, output_file=args.output, verbose=not args.quiet)

    print(f"\n=== Summary ===")
    print(f"  KeySync salts seen     : {stats['salts_seen']}")
    print(f"  Move events total      : {stats['moves_total']}")
    print(f"  Move decoded OK        : {stats['moves_decoded']}")
    print(f"  Move skipped (no salt) : {stats['moves_no_salt']}")
    print(f"  Move bad param         : {stats['moves_bad_param']}")
    print(f"  Move decode failures   : {stats['moves_decode_fail']}")
    if args.output:
        print(f"  Output CSV             : {args.output}")


if __name__ == '__main__':
    main()
