using System.Collections.Concurrent;

namespace AorLib.Decrypt;

/// <summary>
/// Per-bot KeySync salt cache. The Photon KeySync event carries an 8-byte salt
/// in <c>param[252]</c>; this salt is used by the same bot to XOR-encrypt all
/// subsequent Move positions until the next KeySync. The cache is keyed by the
/// IPv4 destination address of the incoming packet (= which bot received it).
/// </summary>
public static class SaltTable {
    private static readonly ConcurrentDictionary<string, byte[]> _salts = new();

    /// <summary>Store (or overwrite) the salt for <paramref name="key"/>. Defensive copy.</summary>
    public static void SetSalt(string key, byte[] salt) {
        if (string.IsNullOrEmpty(key)) return;
        if (salt is null || salt.Length != 8) return;
        _salts[key] = (byte[])salt.Clone();
    }

    /// <summary>
    /// Returns a defensive copy of the salt, or <c>null</c> if not seen yet.
    /// Copy on Get matches the Set-side invariant so callers cannot mutate
    /// the cached salt and corrupt every future packet on that bot.
    /// </summary>
    public static byte[]? GetSalt(string key) {
        if (string.IsNullOrEmpty(key)) return null;
        return _salts.TryGetValue(key, out var s) ? (byte[])s.Clone() : null;
    }

    public static int Count => _salts.Count;

    public static void Clear() => _salts.Clear();
}
