using System;
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

[assembly: InternalsVisibleTo("AOR_core.Tests")] // matches AOR_core.Tests csproj name (case-sensitive)

namespace AorScanner;

/// <summary>
/// High-performance entity-list scanner for the Albion Online Linux native
/// Unity+IL2CPP build. Walks the anonymous rw heap regions looking for
/// "Node" structs (one per in-game entity). Each Node carries a back-pointer
/// to the player's "Hero" MonoBehaviour at <c>+0x18</c>.
///
///   ┌─── Node (entity) ─────────────┐   ┌──── Hero MonoBehaviour ────┐
///   │ +0x00 Il2CppClass* (Klass lo) │   │ +0x00 Il2CppClass*         │
///   │ +0x10 EntityRef* (high heap)  │   │ +0x10 Int32 id             │
///   │ +0x18 HeroPtr* ──────────────────► +0x38 float X              │
///   │ +0xF0 Cached_X (float)        │   │ +0x3C float Y              │
///   │ +0xF4 Cached_Y (float)        │   │ +0x40 float Angle          │
///   │ +0xF8 Cached_Z (float)        │   │ [±256] name ptr ─►String   │
///   └───────────────────────────────┘   └────────────────────────────┘
///
/// Rejection pipeline (sequential guards, all `continue` early):
///   ① Anti-ghost  — raw uint == (100.0f, 100.0f, 0.0f) precomputed LE bits
///   ② NaN/Inf     — IEEE-754 exponent mask 0x7F800000 (no float cast)
///   ③ World range — MathF.Abs(cX/cY) outside [3, 500]
///   ④ PatternSpec — exclusive filter (radar mode): keeps PlayerMC + CreatureMC
///   ⑤ HeroPtr     — high-heap range check
///   ⑥ Hero read   — fast path (in-chunk pointer) / slow path (1 syscall 0x44)
///   ⑦ id range    — id == 0 OK (own player), id in [1..100] rejected, etc.
///
/// Performance:
///   ⋅ 1 MB chunks (ChunkBytes) → 1 syscall per MB instead of per 84 KB
///   ⋅ ThreadLocal&lt;byte[]&gt;  → 0 allocations in the hot loop
///   ⋅ unsafe pointers + fixed blocks → no bounds checking overhead
///   ⋅ Flat Parallel.ForEach over ranges → no nested parallelism context-switch
///   ⋅ Idempotent chunk overlap (`addr += chunkSize - 0x100`) → no missed boundary entities
/// </summary>
public static unsafe class EntityListFinder
{
    // ─── Scan stride + chunking ──────────────────────────────────────
    const int Step = 8;                          // 8-byte struct alignment on x64
    const int ChunkBytes = 1 * 1024 * 1024;      // 1 MB buffer per thread, single RPM syscall
    const int ChunkOverlap = 0x100;              // 256-byte tail overlap so boundary entities aren't lost

    // ─── Node (entity) header ────────────────────────────────────────
    // internal (not private) so test helpers (EntityMockBuilder) can
    // reference the same offsets and stay in lockstep with production.
    internal const int Node_Klass     = 0x00;             // Il2CppClass* (low-heap)
    internal const int Node_EntityRef = 0x10;             // heap ptr
    internal const int Node_Hero      = 0x18;             // heap ptr ──► Hero MonoBehaviour
    internal const int Node_CachedX   = 0xF0;             // float cache
    internal const int Node_CachedY   = 0xF4;             // float cache
    internal const int Node_CachedZ   = 0xF8;             // float cache (altitude)

    // ─── Hero MonoBehaviour header ───────────────────────────────────
    internal const int Hero_Id        = 0x10;
    internal const int Hero_X         = 0x38;
    internal const int Hero_Y         = 0x3C;
    internal const int Hero_Angle     = 0x40;
    internal const int Hero_BlockSize = 0x44;             // up to & incl. Angle

    // ─── Heap ranges (x64 Linux) ──────────────────────────────────────
    const ulong HighHeapMin = 0x700000000000;
    const ulong HighHeapMax = 0x800000000000;

    // ─── World-coordinate acceptance ─────────────────────────────────
    const float Coord_MaxAbs = 500f;             // |X|,|Y|,|Z| ≤ 500 (user-confirmed)
    const float XY_MinAbs    = 3f;               // uninitialized-float guard

    // ─── Anti-ghost pre-computed LE byte halves of IEEE-754 floats ──
    //   100.0f LE == 0x42C80000   (sign=0, exp=0x85, mant=0x480000)
    //     0.0f LE == 0x00000000
    const uint AG_Float100_Bits = 0x42C80000;
    const uint AG_Float0_Bits   = 0x00000000;

    // ─── PatternSpec: soft labels for known entity classes ──────────
    const uint PlayerMC_TypeId   = 0x18f98ae0;
    const uint CreatureMC_TypeId = 0x189af180;

    // ─── Validation predicates (extracted for testability + clarity) ──
    // All four operate on raw uint bits where possible (no float cast in hot path).
    // Marked `internal` so a test project (aor_scanner.Tests) can call them directly
    // via [InternalsVisibleTo] above.
    internal static bool IsAntiGhostBits(uint rawX, uint rawY, uint rawZ) =>
        rawX == AG_Float100_Bits && rawY == AG_Float100_Bits && rawZ == AG_Float0_Bits;

    internal static bool HasNanOrInfCoord(uint rawX, uint rawY) =>
        ((rawX & 0x7F800000) == 0x7F800000) || ((rawY & 0x7F800000) == 0x7F800000);

    internal static bool IsWorldCoordInRange(float cX, float cY)
    {
        // Hoist abs to halve MathF.Abs calls.
        float absX = MathF.Abs(cX);
        float absY = MathF.Abs(cY);
        return absX <= Coord_MaxAbs && absY <= Coord_MaxAbs
            && absX >= XY_MinAbs && absY >= XY_MinAbs;
    }

    internal static bool IsEntityIdInRange(int id) =>
        !(id < 0 || (id > 0 && id <= 100) || id >= 500_000_000);

    // ─── Per-thread reusable buffer (zero allocs in hot loop) ───────
    private static readonly ThreadLocal<byte[]> ThreadBuffer =
        new(() => new byte[ChunkBytes]);

    // ─── Metrics (per-scan, reset on entry) ──────────────────────────
    private static int _readHeroFast;
    private static int _readHeroSlow;
    private static int _ghostsCount;
    private static int _stopped;
    private static int _dumped;       // 0/1 flag — single Debug dump per scan

    public record struct ScanStats(int Total, int Real, int Ghosts, int FastReads, int SlowReads);

    /// <summary>When true, dumps ±256 bytes around the Hero MonoBehaviour
    /// whenever an entity is matched as <see cref="PlayerMC"/>. Useful for
    /// reverse engineering the live Unity/IL2CPP layout.</summary>
    public static bool Debug { get; set; }

    // ─── Entry point ─────────────────────────────────────────────────
    public static (List<Entity> Entities, ScanStats Stats) Scan(
        int pid,
        int maxEntities = 200,
        bool playersAndCreaturesOnly = false)
    {
        var ranges   = MemoryReader.Current.GetAnonymousRwRanges(pid);
        var results  = new ConcurrentBag<Entity>();
        var seenIds  = new ConcurrentDictionary<int, byte>();

        // reset metrics
        _readHeroFast = 0;
        _readHeroSlow = 0;
        _ghostsCount  = 0;
        _stopped      = 0;
        _dumped       = 0;

        var parallelOpts = new ParallelOptions
        {
            MaxDegreeOfParallelism = Environment.ProcessorCount,
        };

        // Flat parallel walk over heap regions. No nested parallelism.
        Parallel.ForEach(ranges, parallelOpts, (range, state) =>
        {
            if (Volatile.Read(ref _stopped) > 0 || seenIds.Count >= maxEntities)
            {
                state.Stop();
                return;
            }

            ulong start = range.Start;
            ulong end   = range.End;

            if (start < HighHeapMin || start > HighHeapMax) return;
            if ((end - start) < 0x200) return;

            byte[] buf = ThreadBuffer.Value!;
            long addr  = (long)start;

            while (addr < (long)end)
            {
                if (Volatile.Read(ref _stopped) > 0) break;

                long remaining = (long)end - addr;
                int chunkSize  = (int)Math.Min(remaining, buf.Length);
                if (chunkSize < 0x200) break;

                // One ReadArray call per 1 MB chunk — replaces Stas.GA's
                // "RPM storm" pattern. Reuses the same ThreadLocal buffer.
                if (!MemoryReader.Current.Read(pid, (ulong)addr, buf.AsSpan(0, chunkSize)))
                {
                    addr += chunkSize;
                    continue;
                }

                ProcessChunk(pid, buf, chunkSize, addr, seenIds, results, maxEntities, playersAndCreaturesOnly);

                if (seenIds.Count >= maxEntities)
                {
                    Volatile.Write(ref _stopped, 1);
                    break;
                }

                // Idempotent overlap: shift by chunkSize - 0x100 so entities
                // straddling chunk boundaries are not missed.
                addr += (chunkSize - ChunkOverlap);
            }
        });

        var list       = new List<Entity>(results);
        int emitted    = list.Count;
        int ghosts     = Volatile.Read(ref _ghostsCount);
        int total      = emitted + ghosts;

        var stats = new ScanStats(
            total,
            emitted,
            ghosts,
            Volatile.Read(ref _readHeroFast),
            Volatile.Read(ref _readHeroSlow));

        return (list, stats);
    }

    /// <summary>
    /// Radar convenience wrapper: only PlayerMC and CreatureMC entities.
    /// Equivalent to <c>Scan(pid, maxEntities, playersAndCreaturesOnly: true)</c>.
    /// Drops unknown entity-classes early, before Hero read.
    /// </summary>
    public static (List<Entity> Entities, ScanStats Stats) ScanPlayersAndCreaturesOnly(
        int pid,
        int maxEntities = 200)
        => Scan(pid, maxEntities, playersAndCreaturesOnly: true);

    // ─── Chunk processor (single-threaded, called per chunk per range) ─
    private static void ProcessChunk(
        int pid,
        byte[] buf,
        int chunkSize,
        long chunkAddr,
        ConcurrentDictionary<int, byte> seenIds,
        ConcurrentBag<Entity> results,
        int maxEntities,
        bool playersAndCreaturesOnly)
    {
        int maxOff = chunkSize - 0x100;

        // Один stackalloc на весь чанк — исправляет CA2014 (stack overflow в цикле).
        // heroBuf переиспользуется во всех slow-path итерациях (MemoryReader.Read синхронный).
        Span<byte> heroBuf = stackalloc byte[Hero_BlockSize];

        fixed (byte* pBuf = buf)
        {
            for (int off = 0; off <= maxOff; off += Step)
            {
                if (Volatile.Read(ref _stopped) > 0) return;

                // ─── Read raw uint bits for ALL coordinates and Klass ───
                uint klass = *(uint*)(pBuf + off + Node_Klass);
                uint rawX  = *(uint*)(pBuf + off + Node_CachedX);
                uint rawY  = *(uint*)(pBuf + off + Node_CachedY);
                uint rawZ  = *(uint*)(pBuf + off + Node_CachedZ);

                // ─── ① ANTI-GHOST PRE-CHECK (raw uint, no float cast) ───
                if (IsAntiGhostBits(rawX, rawY, rawZ))
                {
                    Interlocked.Increment(ref _ghostsCount);
                    continue;
                }

                // ─── ② NAN/INF via IEEE-754 exponent mask (before cast) ───
                if (HasNanOrInfCoord(rawX, rawY))
                {
                    Interlocked.Increment(ref _ghostsCount);
                    continue;
                }

                // ─── ③ WORLD RANGE / LOWER BOUND (cast + MathF.Abs) ───
                float cX = *(float*)&rawX;
                float cY = *(float*)&rawY;
                if (!IsWorldCoordInRange(cX, cY))
                {
                    Interlocked.Increment(ref _ghostsCount);
                    continue;
                }

                // ─── ④ PATTERNSPEC EXCLUSIVE FILTER (radar mode only) ───
                if (playersAndCreaturesOnly
                    && klass != PlayerMC_TypeId
                    && klass != CreatureMC_TypeId)
                {
                    // Drop unknown entity-classes in exclusive mode
                    continue;
                }

                // ─── ⑤ HERO PTR RANGE CHECK ───
                ulong heroPtr = *(ulong*)(pBuf + off + Node_Hero);
                if (heroPtr < HighHeapMin || heroPtr > HighHeapMax) continue;

                // ─── ⑥ HERO READ (fast / slow path) ───
                int   id     = 0;
                float hX     = 0f;
                float hY     = 0f;
                float hAngle = 0f;
                bool  readOk = false;

                long heroOffsetInBuf = (long)heroPtr - chunkAddr;
                if (heroOffsetInBuf >= 0 && (heroOffsetInBuf + Hero_BlockSize) <= chunkSize)
                {
                    // Fast path: Hero header is in the same chunk we just read.
                    // Zero syscalls — just unsafe pointer arithmetic.
                    byte* pHero = pBuf + heroOffsetInBuf;
                    id         = *(int*  )(pHero + Hero_Id);
                    hX         = *(float*)(pHero + Hero_X);
                    hY         = *(float*)(pHero + Hero_Y);
                    hAngle     = *(float*)(pHero + Hero_Angle);
                    readOk     = true;
                    Interlocked.Increment(ref _readHeroFast);
                }
                else
                {
                    // Slow path: Hero spans a chunk boundary. ONE syscall
                    // for the full 0x44-byte header (no 4-call storm).
                    if (MemoryReader.Current.Read(pid, heroPtr, heroBuf))
                    {
                        fixed (byte* pHero = heroBuf)
                        {
                            id     = *(int*  )(pHero + Hero_Id);
                            hX     = *(float*)(pHero + Hero_X);
                            hY     = *(float*)(pHero + Hero_Y);
                            hAngle = *(float*)(pHero + Hero_Angle);
                            readOk = true;
                        }
                        Interlocked.Increment(ref _readHeroSlow);
                    }
                }

                if (!readOk) continue;

                // ─── ⑦ ID RANGE CHECK (id == 0 is the local player) ───
                if (!IsEntityIdInRange(id))
                {
                    Interlocked.Increment(ref _ghostsCount);
                    continue;
                }

                // ─── ⑧ DEDUPE BY HERO.ID ───
                if (!seenIds.TryAdd(id, 0)) continue;

                // ─── ⑨ PATTERNSPEC — soft LABEL (not exclusive filter) ───
                bool isPlayer = (klass == PlayerMC_TypeId);
                bool isNpc    = (klass == CreatureMC_TypeId);

                // ─── ⑩ EMIT ENTITY ───
                var ent = new Entity
                {
                    Id             = id,
                    X              = hX,
                    Y              = hY,
                    Z              = *(float*)&rawZ,
                    Angle          = hAngle,
                    Klass          = klass,
                    GameObjectAddr = (ulong)(chunkAddr + off),
                    IsPlayer       = isPlayer,
                    IsNpc          = isNpc,
                };

                results.Add(ent);

                // Debug dump: single PlayerMC match per scan, label identifies class.
                if (Debug && isPlayer
                    && Interlocked.CompareExchange(ref _dumped, 1, 0) == 0)
                {
                    DumpHeroSurroundings(pid, heroPtr, "PlayerMC", hX, hY);
                }

                if (results.Count >= maxEntities)
                {
                    Volatile.Write(ref _stopped, 1);
                    return;
                }
            }
        }
    }

    // ─── Debug helpers ───────────────────────────────────────────────
    private static void DumpHeroSurroundings(int pid, ulong heroPtr, string label, float hX, float hY)
    {
        const int radius = 256;
        if (heroPtr < (ulong)radius) return;
        ulong start = heroPtr - (ulong)radius;
        const int dumpLen = (radius * 2) + Hero_BlockSize;

        Span<byte> dumpBuf = stackalloc byte[dumpLen];
        if (!MemoryReader.Current.Read(pid, start, dumpBuf))
        {
            Console.Error.WriteLine($"[debug] failed to read 0x{dumpLen:x} bytes at 0x{start:x}");
            return;
        }

        Console.WriteLine($"[debug] ±0x{radius:x} around Hero[{label}]@0x{heroPtr:x} (X={hX:F2}, Y={hY:F2}):");
        int heroRel = (int)(heroPtr - start);
        // Один StringBuilder на весь dump — 0 alloc в цикле
        var sb = new System.Text.StringBuilder(96);
        for (int i = 0; i < dumpLen; i += 16)
        {
            sb.Clear();
            sb.Append($"    {start + (ulong)i:x12}: ");
            for (int j = 0; j < 16 && i + j < dumpLen; j++)
            {
                sb.Append(dumpBuf[i + j].ToString("x2"));
                sb.Append(j == 15 ? "  " : " ");
            }
            if (i <= heroRel && heroRel < i + 16) sb.Append("  ←── Hero");
            Console.WriteLine(sb.ToString());
        }
    }
}
