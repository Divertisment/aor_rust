using System.Runtime.CompilerServices;

namespace AorLib.Decrypt;

/// <summary>
/// Pure XOR helper, mirrors the Stas.AOR <c>Decrypt(byte[] bytes4, byte[] saltBytes8, int saltPos)</c>:
///   bytes4[i] ^= saltBytes8[i % (saltBytes8.Length - saltPos) + saltPos]
/// For 4-byte inputs (the only case we use here) the modulo never wraps, so this
/// is equivalent to XOR with <c>salt[saltPos..saltPos+3]</c>. We still implement
/// the full formula for faithfulness to the source.
/// </summary>
public static class XorDecrypt {
    /// <summary>
    /// XOR <paramref name="count"/> bytes at <paramref name="offset"/> in <paramref name="buf"/>
    /// with <paramref name="salt8"/> starting at <paramref name="saltPos"/>.
    /// Mutates the buffer in place.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void DecryptBlock(byte[] buf, int offset, byte[] salt8, int saltPos) {
        if (buf is null) return;
        if (salt8 is null || salt8.Length != 8) return;
        if (offset < 0 || offset + 4 > buf.Length) return;
        if (saltPos < 0 || saltPos > 4) return;

        int mod = salt8.Length - saltPos;
        for (int i = 0; i < 4; i++) {
            int saltIndex = (i % mod) + saltPos;
            buf[offset + i] ^= salt8[saltIndex];
        }
    }
}
