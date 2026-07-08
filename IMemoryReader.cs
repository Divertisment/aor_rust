using System;
using System.Collections.Generic;

namespace AorScanner;

/// <summary>
/// Abstraction over the kernel memory-read primitives used by
/// <see cref="EntityListFinder"/>. The default implementation lives in
/// <see cref="MemoryReader"/>; tests can swap it via
/// <c>MemoryReader.Current = mockInstance</c> to inject canned byte arrays
/// without touching a real process.
/// </summary>
public interface IMemoryReader
{
    /// <summary>Read <c>buf.Length</c> bytes from <paramref name="pid"/> at
    /// <paramref name="addr"/> into <paramref name="buf"/>. Returns false
    /// on read failure or short read.</summary>
    bool Read(int pid, ulong addr, Span<byte> buf);

    /// <summary>Allocate-and-return a contiguous byte array of <paramref name="size"/>
    /// bytes from <paramref name="pid"/> at <paramref name="addr"/>.
    /// Returns null on read failure or if <paramref name="size"/> ≤ 0.</summary>
    byte[]? ReadArray(int pid, ulong addr, int size);

    /// <summary>List of anonymous rw heap regions (start, end) for the given pid.
    /// Used by the scanner to identify candidate high-heap ranges.</summary>
    List<(ulong Start, ulong End)> GetAnonymousRwRanges(int pid);
}
