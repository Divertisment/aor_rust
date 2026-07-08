using System.Collections.Concurrent;

namespace AorScanner;

/// <summary>
/// Heap-based entity scanner targeting the Albion Online Linux native
/// Unity+IL2CPP build. The scanner walks the process heap looking for
/// "Node" structs (one per in-game entity). Each Node carries a back-pointer
/// to the player's "Hero" MonoBehaviour at <c>+0x18</c>. The Hero layout
/// was confirmed by auto_search.js (Frida+IL2CPP):
/// id@0x10, X@0x38, Y@0x3C, plus Angle@0x40 and a near-by name string ptr.
///
///   ┌─── Node (entity) ─────────────┐   ┌──── Hero MonoBehaviour ────┐
///   │ +0x00 Il2CppClass*            │   │ +0x00 Il2CppClass*         │
///   │ +0x10 EntityRef*              │   │ +0x10 Int32 id             │
///   │ +0x18 HeroPtr* ──────────────────► +0x38 float X              │
///   │ +0xF0 Cached_X (float)        │   │ +0x3C float Y              │
///   │ +0xF4 Cached_Y (float)        │   │ +0x40 float Angle          │
///   │ +0xF8 Cached_Z (float)        │   │ [±256] name ptr ─►String   │
///   └───────────────────────────────┘   └────────────────────────────┘
///
/// World coordinate filter (per user): <c>|X|, |Y|, |Z| ≤ 500</c>.
/// In addition: <c>|X|, |Y| ≥ 3</c> (inherited unchanged from the original
/// filter, where it served as an anti-uninitialised-float guard). No lower
/// bound is imposed on Z — the user prefers to inspect real in-game Z values
/// directly rather than rely on guessed floors.
/// </summary>
public static class HeapScanner
{
    const int Step = 8;
    const int ChunkBytes = 84_000;
    const int MaxParallel = 4;

    // ─── Hero MonoBehaviour header ──────────────────────────────────────
    const int Hero_Id        = 0x10;
    const int Hero_X         = 0x38;
    const int Hero_Y         = 0x3C;
    const int Hero_Angle     = 0x40;
    const int Hero_BlockSize = 0x44;        // up to & incl. Angle

    // ─── Node (in-game entity) header ───────────────────────────────────
    const int Node_Klass     = 0x00;        // Il2CppClass*
    const int Node_EntityRef = 0x10;        // heap ptr
    const int Node_Hero      = 0x18;        // heap ptr  ──► Hero MonoBehaviour
    const int Node_CachedX   = 0xF0;        // float cache
    const int Node_CachedY   = 0xF4;        // float cache
    const int Node_CachedZ   = 0xF8;        // float cache (altitude)

    // ─── Heap ranges ─────────────────────────────────────────────────────
    const ulong LowHeapMin  = 0x10000000;
    const ulong LowHeapMax  = 0x00006FFFFFFFFFFF;
    const ulong HighHeapMin = 0x700000000000;
    const ulong HighHeapMax = 0x800000000000;

    // ─── World-coordinate acceptance (per user constraint) ─────────────
    const float Coord_MaxAbs = 500f;        // |X|,|Y|,|Z| ≤ 500 — user-confirmed
    const float XY_MinAbs    = 3f;          // inherited from original filter
    const float Angle_Min    = 0f;
    const float Angle_Max    = 360f;

    static int _lastPlayerId;

    /// <summary>When true, hexdump ±256 around the Hero when the local player
    /// is identified via name pointer.</summary>
    public static bool Debug { get; set; }

    record struct Chunk(int Pid, ulong Addr, int Size);

    // ─── Entry point ─────────────────────────────────────────────────────
    public static List<Entity> ScanEntities(int pid, int maxEntities = 200)
    {
        var ranges = MemoryReader.GetAnonymousRwRanges(pid);
        var chunks = BuildChunks(pid, ranges);

        var results = new ConcurrentBag<Entity>();
        var seenId  = new ConcurrentDictionary<int, byte>();

        var opts = new ParallelOptions { MaxDegreeOfParallelism = MaxParallel };

        Parallel.For(0, chunks.Count, opts, (i, loop) =>
        {
            if (results.Count >= maxEntities) { loop.Stop(); return; }

            var ch = chunks[i];
            var buf = new byte[ch.Size];
            if (!MemoryReader.Read(ch.Pid, ch.Addr, buf)) return;

            ScanChunk(ch, buf, pid, seenId, results, maxEntities, loop);
        });

        return [.. results];
    }

    // ─── Helpers ─────────────────────────────────────────────────────────
    static List<Chunk> BuildChunks(int pid, List<(ulong Start, ulong End)> ranges)
    {
        var chunks = new List<Chunk>(ranges.Count * 2);
        foreach (var (start, end) in ranges)
        {
            if (start < HighHeapMin || start > HighHeapMax) continue;
            var size = (long)(end - start);
            if (size < 0x100) continue;
            var addr = start;
            while (addr < end)
            {
                var remaining = (long)(end - addr);
                var cs = (int)Math.Min(remaining, ChunkBytes);
                if (cs < 0x100) break;
                chunks.Add(new Chunk(pid, addr, cs));
                addr += (ulong)cs;
            }
        }
        return chunks;
    }

    static void ScanChunk(Chunk ch, byte[] buf, int pid,
                          ConcurrentDictionary<int, byte> seen,
                          ConcurrentBag<Entity> results,
                          int maxEntities, ParallelLoopState loop)
    {
        var maxOff = ch.Size - Node_CachedZ - 4;
        for (int off = 0; off <= maxOff; off += Step)
        {
            if (results.Count >= maxEntities) { loop.Stop(); return; }

            // — Node header validation —
            var klass = BitConverter.ToUInt64(buf, off + Node_Klass);
            if (!LooksLikeIl2CppClass(klass)) continue;
            if (!InHighHeap(BitConverter.ToUInt64(buf, off + Node_EntityRef))) continue;

            var heroPtr = BitConverter.ToUInt64(buf, off + Node_Hero);
            if (!InHighHeap(heroPtr)) continue;

            var nodeZ = BitConverter.ToSingle(buf, off + Node_CachedZ);
            if (!IsAcceptableZ(nodeZ)) continue;

            // — Read Hero header (single syscall, no 4-call storm) —
            var hero = ReadHero(ch, buf, heroPtr, pid);
            if (hero.id <= 0) continue;
            if (!seen.TryAdd(hero.id, 0)) continue;

            results.Add(new Entity
            {
                Id              = hero.id,
                X               = hero.x,
                Y               = hero.y,
                Z               = nodeZ,
                Angle           = hero.angle,
                GameObjectAddr  = heroPtr,
            });
        }
    }

    static (int id, float x, float y, float angle) ReadHero(Chunk ch, byte[] buf, ulong heroPtr, int pid)
    {
        // Fast path: Hero header fits inside the chunk we already have.
        if (heroPtr >= ch.Addr && heroPtr + Hero_BlockSize <= ch.Addr + (ulong)ch.Size)
        {
            var off = (int)(heroPtr - ch.Addr);
            return DecodeHero(buf, off);
        }

        // Slow path: Hero spans a chunk boundary. One syscall (0x44 bytes)
        // replaces the legacy four-call syscall storm.
        Span<byte> oneShot = stackalloc byte[Hero_BlockSize];
        if (!ReadWithRetry(pid, heroPtr, oneShot)) return (0, 0, 0, 0);
        return DecodeHero(oneShot, 0);
    }

    static (int id, float x, float y, float angle) DecodeHero(ReadOnlySpan<byte> s, int off)
    {
        var id    = BitConverter.ToInt32  (s.Slice(off + Hero_Id,    4));
        var x     = BitConverter.ToSingle (s.Slice(off + Hero_X,     4));
        var y     = BitConverter.ToSingle (s.Slice(off + Hero_Y,     4));
        var angle = BitConverter.ToSingle (s.Slice(off + Hero_Angle, 4));

        if (id <= 0) return (0, 0, 0, 0);
        if (!IsAcceptableXY(x) || !IsAcceptableXY(y)) return (0, 0, 0, 0);
        if (!IsValidAngle(angle)) return (0, 0, 0, 0);

        return (id, x, y, angle);
    }

    static bool ReadWithRetry(int pid, ulong addr, Span<byte> buf)
    {
        for (int attempt = 0; attempt < 3; attempt++)
            if (MemoryReader.Read(pid, addr, buf)) return true;
        return false;
    }

    // ─── Validators ──────────────────────────────────────────────────────
    static bool InHighHeap(ulong a) => a >= HighHeapMin && a <= HighHeapMax;
    static bool InLowHeap(ulong a)  => a >= LowHeapMin  && a <= LowHeapMax;

    static bool LooksLikeIl2CppClass(ulong klass) =>
        InLowHeap(klass) && (klass & 0xFFF) <= 0xFF0;

    static bool IsAcceptableXY(float v) =>
        float.IsFinite(v) && MathF.Abs(v) >= XY_MinAbs && MathF.Abs(v) <= Coord_MaxAbs;

    static bool IsAcceptableZ(float v) =>
        float.IsFinite(v) && MathF.Abs(v) <= Coord_MaxAbs;

    static bool IsValidAngle(float a) =>
        float.IsFinite(a) && a >= Angle_Min && a <= Angle_Max;

    // ─── Player identification ──────────────────────────────────────────
    public static int FindPlayerByName(List<Entity> entities, int pid, ulong playerNameStrAddr)
    {
        if (playerNameStrAddr == 0 || entities.Count == 0) return 0;
        foreach (var e in entities)
        {
            if (PlayerNameFinder.IsPlayerEntity(pid, e.GameObjectAddr, playerNameStrAddr))
            {
                Console.WriteLine($"[*] Found player by name: ID={e.Id} at ({e.X:F1}, {e.Y:F1}) Hero@0x{e.GameObjectAddr:x}");
                if (Debug) DumpHeroSurroundings(pid, e.GameObjectAddr);
                return e.Id;
            }
        }
        return 0;
    }

    static void DumpHeroSurroundings(int pid, ulong heroPtr)
    {
        const int radius = 256;
        if (heroPtr < (ulong)radius) return;
        var start = heroPtr - (ulong)radius;
        const int dumpLen = (radius * 2) + Hero_BlockSize;
        Span<byte> buf = stackalloc byte[dumpLen];
        if (!ReadWithRetry(pid, start, buf)) return;

        Console.WriteLine($"  [debug] ±0x{radius:x} around Hero@0x{heroPtr:x}:");
        var heroRel = (int)(heroPtr - start);
        for (int i = 0; i < dumpLen; i += 16)
        {
            var line = $"    {start + (ulong)i:x12}: ";
            for (int j = 0; j < 16 && i + j < dumpLen; j++)
                line += buf[i + j].ToString("x2") + (j == 15 ? "  " : " ");
            var mark = (i <= heroRel && heroRel < i + 16) ? "  ←── Hero" : "";
            Console.WriteLine(line + mark);
        }
    }

    public static void FilterAndClassify(List<Entity> entities, int playerId = 0)
    {
        if (entities.Count == 0) return;

        Entity? player = null;
        if (playerId > 0)            player = entities.FirstOrDefault(e => e.Id == playerId);
        if (player == null)          player = entities.FirstOrDefault(e => e.Id == _lastPlayerId);
        if (player == null)          player = entities.FirstOrDefault(e => e.Id == 533);   // legacy fallback
        if (player == null)          player = entities.FirstOrDefault(e => e.IsPlayer);
        if (player == null && entities.Count > 0) player = entities[0];
        if (player == null) return;

        player.IsPlayer = true;
        _lastPlayerId   = player.Id;

        var px = player.X;
        var py = player.Y;
        entities.RemoveAll(e => !e.IsPlayer && e.DistanceTo(px, py) > 200f);

        foreach (var e in entities)
        {
            if (e.IsPlayer) continue;
            var dist = e.DistanceTo(px, py);
            if      (dist < 15f) e.IsEnemy = true;
            else if (dist < 50f) e.IsNpc   = true;
        }
    }
}
