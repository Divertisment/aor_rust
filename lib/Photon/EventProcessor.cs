using System;
using System.Collections.Generic;
using AorLib.Decrypt;

namespace Stas.AOR;

public static class EventProcessor {
    public static void PostProcessEvent(EventData ev, string from) {
        if (ev == null) return;
        if (ev.Parameters == null) ev.Parameters = new Dictionary<byte, object>();

        // KeySync detection is signature-based, not code-based. The 5-year-old
        // Events enum has KeySync at ~460 but the wire is byte-wide; 598 doesn't
        // even fit. The frida hook confirmed the salt is at param[252] (the slot
        // we use for the back-pointer), and it's a byte[8]. We check this BEFORE
        // the auto-back-pointer fires below, because that line is `if (!Contains)`
        // and would clobber an existing 252 with ev.Code.
        if (TryExtractKeySyncSalt(ev.Parameters, from)) {
            // salt captured; fall through
        }

        // Auto-add back-pointer to ev.Code only if 252 is still missing.
        if (!ev.Parameters.ContainsKey(252))
            ev.Parameters[252] = ev.Code;

        if (ev.Code == (byte)EventCodes.Move)
            ExtractMovePositions(ev.Parameters, from);
    }

    public static void PostProcessRequest(OperationRequest req) {
        if (req == null) return;
        if (req.Parameters == null) req.Parameters = new Dictionary<byte, object>();
        if (!req.Parameters.ContainsKey(253))
            req.Parameters[253] = req.OperationCode;
    }

    public static void PostProcessResponse(OperationResponse resp) {
        if (resp == null) return;
        if (resp.Parameters == null) resp.Parameters = new Dictionary<byte, object>();
        if (!resp.Parameters.ContainsKey(253))
            resp.Parameters[253] = resp.OperationCode;
    }

    /// <summary>
    /// Returns true and writes to <see cref="SaltTable"/> iff
    /// <c>param[252]</c> is a non-null <c>byte[8]</c> (the KeySync salt shape).
    /// Defensive copy on store.
    /// </summary>
    private static bool TryExtractKeySyncSalt(Dictionary<byte, object> paramsTable, string from) {
        if (string.IsNullOrEmpty(from)) return false;
        if (!paramsTable.TryGetValue(252, out var saltObj)) return false;
        if (saltObj is not byte[] raw || raw.Length != 8) return false;
        var copy = new byte[8];
        Buffer.BlockCopy(raw, 0, copy, 0, 8);
        SaltTable.SetSalt(from, copy);
        return true;
    }

    /// <summary>
    /// Move payload: param[1] is byte[17+], with X at [9..13] and Y at [13..17]
    /// (little-endian IEEE 754 floats). Both 4-byte blocks are XOR-encrypted
    /// with the bot's current 8-byte KeySync salt (X uses salt[0..3], Y uses salt[4..7]).
    /// </summary>
    private static void ExtractMovePositions(Dictionary<byte, object> paramsTable, string from) {
        if (!paramsTable.TryGetValue(1, out object rawObj) || !(rawObj is byte[] raw) || raw.Length < 17)
            return;

        var salt = string.IsNullOrEmpty(from) ? null : SaltTable.GetSalt(from);
        if (salt != null && salt.Length == 8) {
            XorDecrypt.DecryptBlock(raw, 9, salt, 0);   // X: bytes 9..12 XOR salt[0..3]
            XorDecrypt.DecryptBlock(raw, 13, salt, 4);  // Y: bytes 13..16 XOR salt[4..7]
        }

        float x = BitConverter.ToSingle(raw, 9);
        float y = BitConverter.ToSingle(raw, 13);
        if (float.IsNaN(x) || float.IsInfinity(x) || float.IsNaN(y) || float.IsInfinity(y))
            return;
        paramsTable[4] = x;
        paramsTable[5] = y;
    }
}
