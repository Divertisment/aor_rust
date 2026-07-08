using System.Runtime.InteropServices;
using System.Text;

namespace AorScanner;

public static class PlayerNameFinder
{
    static byte[] _pattern = null!;

    public static ulong FindPlayerNameString(int pid, string playerName)
    {
        _pattern = Encoding.Unicode.GetBytes(playerName);
        var ranges = MemoryReader.GetAnonymousRwRanges(pid);
        byte[] buf = new byte[1024 * 1024];

        foreach (var (start, end) in ranges)
        {
            if (start < 0x700000000000 || start > 0x800000000000) continue;
            var size = (long)(end - start);
            if (size < _pattern.Length || size > 50 * 1024 * 1024) continue;

            long addr = (long)start;
            while (addr < (long)end)
            {
                var remaining = (long)end - addr;
                var chunkSize = (int)Math.Min(remaining, buf.Length);
                if (chunkSize < _pattern.Length) break;

                if (!MemoryReader.Read(pid, (ulong)addr, buf.AsSpan(0, chunkSize)))
                {
                    addr += chunkSize;
                    continue;
                }

                for (int off = 0; off <= chunkSize - _pattern.Length; off++)
                {
                    if (MatchPattern(buf, off))
                    {
                        var charsAddr = (ulong)(addr + off);
                        var strAddr = ValidateIl2CppString(pid, charsAddr, playerName.Length);
                        if (strAddr != 0)
                        {
                            Console.WriteLine($"[*] Found player name string at 0x{strAddr:x} (chars at 0x{charsAddr:x})");
                            return strAddr;
                        }
                    }
                }
                addr += chunkSize;
            }
        }

        return 0;
    }

    static bool MatchPattern(byte[] buf, int off)
    {
        if (off + _pattern.Length > buf.Length) return false;
        for (int i = 0; i < _pattern.Length; i++)
            if (buf[off + i] != _pattern[i]) return false;
        return true;
    }

    static ulong ValidateIl2CppString(int pid, ulong charsAddr, int expectedLen)
    {
        if (charsAddr < 0x20) return 0;

        // Il2CppString layout (no monitor field):
        // +0x00: klass (8 bytes) - can point to image data, not heap
        // +0x10: length (4 bytes)
        // +0x14: chars[]
        var strAddr = charsAddr - 0x14;

        var buf = new byte[0x18 + _pattern.Length];
        if (!MemoryReader.Read(pid, strAddr, buf)) return 0;

        var length = BitConverter.ToInt32(buf, 0x10);
        if (length != expectedLen) return 0;

        // Verify chars match
        for (int i = 0; i < _pattern.Length; i++)
            if (buf[0x14 + i] != _pattern[i]) return 0;

        return strAddr;
    }

    public static bool IsPlayerEntity(int pid, ulong entityPosAddr, ulong playerNameStrAddr)
    {
        if (playerNameStrAddr == 0 || entityPosAddr == 0) return false;

        Span<byte> buf = stackalloc byte[512];
        var scanStart = entityPosAddr > 256 ? entityPosAddr - 256 : 0;
        if (scanStart == 0) return false;
        if (!MemoryReader.Read(pid, scanStart, buf)) return false;

        var off = (int)(entityPosAddr - scanStart);
        var start = Math.Max(0, off - 256);
        var end = Math.Min(buf.Length - 8, off + 256);

        for (int i = start; i <= end; i += 8)
        {
            var qword = BitConverter.ToUInt64(buf.Slice(i));
            if (qword == playerNameStrAddr) return true;
        }
        return false;
    }
}
