using System.Runtime.InteropServices;
using System.Text;

namespace AorScanner;

public static class MemoryReader
{
    const string KmodPath = "/proc/aor_mem";

    /// <summary>Pluggable reader — default delegates to the static methods below.
    /// Tests can assign a mock to inject canned byte arrays without touching a real pid.
    /// </summary>
    public static IMemoryReader Current { get; set; } = new DefaultMemoryReader();

    private sealed class DefaultMemoryReader : IMemoryReader
    {
        public bool Read(int pid, ulong addr, Span<byte> buf) => MemoryReader.Read(pid, addr, buf);
        public byte[]? ReadArray(int pid, ulong addr, int size) => MemoryReader.ReadArray(pid, addr, size);
        public List<(ulong Start, ulong End)> GetAnonymousRwRanges(int pid) => MemoryReader.GetAnonymousRwRanges(pid);
    }

    [DllImport("libc", EntryPoint = "open", SetLastError = true)]
    static unsafe extern int open(byte* path, int flags, int mode);

    [DllImport("libc", EntryPoint = "write", SetLastError = true)]
    static unsafe extern nint write(int fd, byte* buf, int count);

    [DllImport("libc", EntryPoint = "read", SetLastError = true)]
    static unsafe extern nint read(int fd, byte* buf, int count);

    [DllImport("libc", EntryPoint = "close", SetLastError = true)]
    static extern int close(int fd);

    const int O_WRONLY = 1;
    const int O_RDONLY = 0;

    static readonly byte[] _kmodPathNul = Encoding.ASCII.GetBytes("/proc/aor_mem\0");

    public static unsafe bool Read(int pid, ulong addr, Span<byte> buf)
    {
        if (buf.Length == 0) return true;
        if (!File.Exists(KmodPath))
            return ReadViaProcessVm(pid, addr, buf);

        var reqStr = $"{pid} {addr:x} {buf.Length}\n";
        var reqBytes = Encoding.ASCII.GetBytes(reqStr);

        fixed (byte* pPath = _kmodPathNul)
        fixed (byte* pReq = reqBytes)
        {
            var wfd = open(pPath, O_WRONLY, 0);
            if (wfd < 0) return ReadViaProcessVm(pid, addr, buf);
            write(wfd, pReq, reqBytes.Length);
            close(wfd);

            var rfd = open(pPath, O_RDONLY, 0);
            if (rfd < 0) return ReadViaProcessVm(pid, addr, buf);

            int total = 0;
            fixed (byte* pDst = buf)
            {
                while (total < buf.Length)
                {
                    var n = read(rfd, pDst + total, buf.Length - total);
                    if (n <= 0) break;
                    total += (int)n;
                }
            }
            close(rfd);
            return total == buf.Length;
        }
    }

    static unsafe bool ReadViaProcessVm(int pid, ulong addr, Span<byte> buf)
    {
        fixed (byte* p = buf)
        {
            var local = new IOVec { iov_base = (IntPtr)p, iov_len = (UIntPtr)buf.Length };
            var remote = new IOVec { iov_base = (IntPtr)addr, iov_len = (UIntPtr)buf.Length };
            var ret = process_vm_readv(pid, &local, 1, &remote, 1, 0);
            return ret > 0 && (nint)ret == buf.Length;
        }
    }

    /// <summary>
    /// Mirrors <c>Stas.GA.Memory.ReadArray&lt;T&gt;</c>: allocate-and-return a
    /// contiguous byte array from the target process. Returns null on read failure.
    /// </summary>
    public static byte[]? ReadArray(int pid, ulong addr, int size)
    {
        if (size <= 0) return null;
        var buf = new byte[size];
        return Read(pid, addr, buf) ? buf : null;
    }

    public static ulong ReadU64(int pid, ulong addr)
    {
        Span<byte> buf = stackalloc byte[8];
        return Read(pid, addr, buf) ? BitConverter.ToUInt64(buf) : 0;
    }

    public static int ReadI32(int pid, ulong addr)
    {
        Span<byte> buf = stackalloc byte[4];
        return Read(pid, addr, buf) ? BitConverter.ToInt32(buf) : 0;
    }

    public static float ReadF32(int pid, ulong addr)
    {
        Span<byte> buf = stackalloc byte[4];
        return Read(pid, addr, buf) ? BitConverter.ToSingle(buf) : 0f;
    }

    public static bool IsValidHeapPtr(ulong addr) =>
        addr >= 0x700000000000 && addr <= 0x800000000000 && addr != 0;

    static List<(ulong Start, ulong End)>? _anonCache;
    static int _anonCachePid;

    public static bool IsAddressInAnonymousRw(int pid, ulong addr)
    {
        if (_anonCachePid != pid || _anonCache == null)
        {
            _anonCache = GetAnonymousRwRanges(pid);
            _anonCachePid = pid;
        }
        foreach (var r in _anonCache)
            if (addr >= r.Start && addr < r.End) return true;
        return false;
    }

    public static List<(ulong Start, ulong End)> GetAnonymousRwRanges(int pid)
    {
        var result = new List<(ulong, ulong)>();
        var mapsPath = $"/proc/{pid}/maps";
        if (!File.Exists(mapsPath)) return result;

        foreach (string line in File.ReadLines(mapsPath))
        {
            var tokens = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (tokens.Length < 2) continue;

            var range = tokens[0].Split('-');
            if (range.Length != 2) continue;

            if (!ulong.TryParse(range[0], System.Globalization.NumberStyles.HexNumber, null, out var start) ||
                !ulong.TryParse(range[1], System.Globalization.NumberStyles.HexNumber, null, out var end))
                continue;

            var perms = tokens[1];
            if (!perms.StartsWith("rw") || !perms.EndsWith("p")) continue;

            result.Add((start, end));
        }
        return result;
    }

    public static ulong GetModuleBase(int pid, string name)
    {
        var mapsPath = $"/proc/{pid}/maps";
        if (!File.Exists(mapsPath)) return 0;

        foreach (var line in File.ReadLines(mapsPath))
        {
            if (!line.Contains(name)) continue;
            if (!line.Contains("r-xp") && !line.Contains("r--p")) continue;
            if (line.Contains(" 00000000"))
            {
                var range = line.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0].Split('-');
                if (range.Length == 2 && ulong.TryParse(range[0], System.Globalization.NumberStyles.HexNumber, null, out var baseAddr))
                    return baseAddr;
            }
        }

        foreach (var line in File.ReadLines(mapsPath))
        {
            if (!line.Contains(name)) continue;
            var range = line.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0].Split('-');
            if (range.Length == 2 && ulong.TryParse(range[0], System.Globalization.NumberStyles.HexNumber, null, out var baseAddr))
                return baseAddr;
        }
        return 0;
    }

    public static void ForEachUnityRwPage(int pid, Func<ulong, ulong, byte[], bool> callback)
    {
        var mapsPath = $"/proc/{pid}/maps";
        if (!File.Exists(mapsPath)) return;

        foreach (var line in File.ReadLines(mapsPath))
        {
            if (!line.Contains("UnityPlayer.so") || !line.Contains("rw-p")) continue;

            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) continue;
            var range = parts[0].Split('-');
            if (range.Length != 2) continue;

            if (!ulong.TryParse(range[0], System.Globalization.NumberStyles.HexNumber, null, out var start) ||
                !ulong.TryParse(range[1], System.Globalization.NumberStyles.HexNumber, null, out var end))
                continue;

            var size = (int)(end - start);
            if (size < 8 || size > 16 * 1024 * 1024) continue;

            var buf = new byte[size];
            if (!Read(pid, start, buf)) continue;

            if (!callback(start, end, buf))
                return;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IOVec
    {
        public IntPtr iov_base;
        public UIntPtr iov_len;
    }

    [DllImport("libc", SetLastError = true)]
    static extern unsafe nint process_vm_readv(
        int pid,
        IOVec* local_iov,
        ulong local_iov_count,
        IOVec* remote_iov,
        ulong remote_iov_count,
        ulong flags);
}
