// ============================================================================
// radar_server/MatrixProjector.cs
//
// R22 fix from R21 review/build-cycle:
//   1. ADD proj_full[16] to ScreenOut (read from source JSON) — web panel
//      needs projectionMatrix for perspective divide + viewport scale.
//   2. RENAME misleading DTO field `in_front` -> `depth_nonzero`. Same boolean
//      (true iff |depth| > 1e-6, regardless of sign) but the new name is honest
//      about what it signals — "depth is non-degenerate", not "in front of camera".
//      Web panel applies its own forward/back heuristic based on Unity's
//      camera-space convention (LH for Unity default, RH for OpenGL backend).
//
// R21 fix from R20 build/CSR review (still applied):
//   1. Drop readonly struct on CamSnap/EntRow (CS8340: instances must be readonly).
//   2. Drop JsonSourceGenerationOptions+JsonSerializerContext (CS0534: partial class abstract members not implemented). Use plain JsonSerializer reflection — fine for 5 Hz small payloads.
//   3. FIX(R21) CRITICAL: depth cull direction was inverted. R20 had `if (depth <= 0f) continue;` which culled correctly for Unity Linux LH (z>0 = forward) but inverted for OpenGL RH (z<0 = forward). The convention is genuinely ambiguous, so emit raw depth + `depth_nonzero` heuristic, NO cull — let the web panel decide per its own convention.
//
// Background projector: polls /tmp/aor_camera_matrix.json (frida R19, 200ms) +
// /tmp/aor_entities.json (AOR_core scanner, every Config.Game.PollIntervalSecs).
// For each entity: project through world→camera transform, write
// /tmp/aor_screen_positions.json for the web panel radar UI.
//
// PROJECTION FORMULA (m12 12-float column-major 4x4 with row 3=[0,0,0,1]):
//   sx    = X * m[0]  + Y * m[3]  + Z * m[6]  + m[9]
//   sy    = X * m[1]  + Y * m[4]  + Z * m[7]  + m[10]
//   depth = X * m[2]  + Y * m[5]  + Z * m[8]  + m[11]
// matches hook_camera_matrix.js comment block.
//
// STALE/MISSING: camera_matrix.json > StaleThresholdMs (5000) -> emit {} shell.
// ============================================================================
using System.Text.Json;
using System.Text.Json.Serialization;  // FIX(R22.1): restore — JsonIgnoreCondition lives here. (R22 first attempt removed this; broke CS0103.)

namespace AorRadar.Server;

public sealed class MatrixProjector
{
    // ─── Source paths (must match what R19 + Program.cs write) ───────
    const string CameraMatrixJsonPath = "/tmp/aor_camera_matrix.json";
    const string EntitiesJsonPath     = "/tmp/aor_entities.json";

    // ─── Output path (consumed by web panel) ──────────────────────────
    public const string ScreenPositionsJsonPath = "/tmp/aor_screen_positions.json";

    // ─── Cadence + freshness window (ms) ──────────────────────────────
    public const int PollIntervalMs   = 200;   // matches frida R19 5 Hz
    public const int StaleThresholdMs = 5000;  // 25 missed frida ticks -> drop

    // ─── Cancellation ─────────────────────────────────────────────────
    readonly CancellationToken _ct;

    static readonly JsonSerializerOptions JsonOpts = new() {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    public MatrixProjector(CancellationToken ct) => _ct = ct;

    /// <summary>Blocking loop; runs until cancellation.</summary>
    public void Run()
    {
        Console.WriteLine($"[proj] MatrixProjector started — polling @ {PollIntervalMs}ms -> {ScreenPositionsJsonPath}");
        long tickCount = 0;
        while (!_ct.IsCancellationRequested)
        {
            try
            {
                ProjectOnce(tickCount++);
            }
            catch (Exception ex)
            {
                // Never let the projector crash the radar server. Quiet log every ~6s.
                if ((tickCount & 31) == 0)
                    Console.Error.WriteLine($"[-] proj loop error: {ex.GetType().Name}: {ex.Message}");
            }
            // Block this loop iteration for PollIntervalMs, but respect cancel.
            try { Task.Delay(PollIntervalMs, _ct).Wait(_ct); }
            catch (OperationCanceledException) { break; }
            catch (AggregateException) when (_ct.IsCancellationRequested) { break; }
        }
        Console.WriteLine("[proj] MatrixProjector stopped");
    }

    // ─── One inline tick: read both JSONs, project, write ─────────────
    void ProjectOnce(long tickNum)
    {
        // 1. Parse camera matrix. If missing/stale/invalid -> empty shell.
        if (!TryReadCamera(out var cam))
        {
            WriteJson(new ScreenOut {
                ts = NowMs(), tick = (int)(tickNum % int.MaxValue),
                cam_handle = "0", cam_pos = Zero3(), proj_full = Zero16(),
                w = 0, h = 0,
                matrix_age_ms = cam.matrix_age_ms,
                positions = Array.Empty<ScreenEntity>()
            });
            return;
        }

        // 2. Parse entities (may be "[]" if no Player-class matches).
        var entities = TryReadEntities();

        // 3. Project every entity. NO depth cull — emit raw depth +
        //    `depth_nonzero` heuristic; web panel decides per convention.
        var positions = new List<ScreenEntity>(entities.Count);
        for (int i = 0; i < entities.Count; i++)
        {
            var e = entities[i];
            float sx    = e.x * cam.m[0] + e.y * cam.m[3] + e.z * cam.m[6] + cam.m[9];
            float sy    = e.x * cam.m[1] + e.y * cam.m[4] + e.z * cam.m[7] + cam.m[10];
            float depth = e.x * cam.m[2] + e.y * cam.m[5] + e.z * cam.m[8] + cam.m[11];
            // Cull only true NaN/Inf (degenerate matrix). Don't decide forward/backwards.
            if (float.IsNaN(sx) || float.IsInfinity(sx) ||
                float.IsNaN(sy) || float.IsInfinity(sy) ||
                float.IsNaN(depth) || float.IsInfinity(depth)) continue;
            // R22: rename misleading in_front -> depth_nonzero. True for ANY non-zero depth;
            // web panel uses raw `depth` + Unity LH vs OpenGL RH convention to decide
            // forward/back — we deliberately don't cull.
            bool depthNonzero = depth > 1e-6f || depth < -1e-6f;
            positions.Add(new ScreenEntity {
                id = e.id, type = e.type ?? "Entity",
                sx = sx, sy = sy, depth = depth,
                wx = e.x, wy = e.y, wz = e.z,
                depth_nonzero = depthNonzero
            });
        }

        WriteJson(new ScreenOut {
            ts = NowMs(), tick = (int)(tickNum % int.MaxValue),
            ts_src = cam.ts_src,                       // mirrors frida tick stamp into output
            cam_handle = cam.handle,
            cam_pos    = cam.pos,
            proj_full  = cam.proj,                     // R22: publish projectionMatrix for web panel
            w = cam.w, h = cam.h,
            matrix_age_ms = cam.matrix_age_ms,
            positions = positions.ToArray()
        });
    }

    // ─── Camera JSON read ─────────────────────────────────────────────
    struct CamSnap {
        public string handle;
        public float[] pos;
        public float[] m;          // 12-float column-major world→camera view matrix
        public float[] proj;       // R22: 16-float column-major projection matrix (optional)
        public int w, h;
        public long matrix_age_ms;
        public long ts_src;
    }
    bool TryReadCamera(out CamSnap snap)
    {
        snap = default;
        try
        {
            if (!File.Exists(CameraMatrixJsonPath)) return false;
            var fi = new FileInfo(CameraMatrixJsonPath);
            long age = (DateTimeOffset.UtcNow - fi.LastWriteTimeUtc).Ticks / TimeSpan.TicksPerMillisecond;
            if (age > StaleThresholdMs) { snap.matrix_age_ms = age; return false; }
            if (fi.Length < 4) { snap.matrix_age_ms = age; return false; }

            using var doc = JsonDocument.Parse(File.ReadAllText(CameraMatrixJsonPath));
            var root = doc.RootElement;

            float[] m = new float[12];
            if (root.TryGetProperty("w2c", out var w2cEl) && w2cEl.GetArrayLength() == 12)
            {
                int i = 0;
                foreach (var f in w2cEl.EnumerateArray()) m[i++] = f.GetSingle();
            }
            else return false;

            float[] pos = new float[3] { 0, 0, 0 };
            if (root.TryGetProperty("pos", out var posEl) && posEl.GetArrayLength() == 3)
            {
                int i = 0;
                foreach (var f in posEl.EnumerateArray()) pos[i++] = f.GetSingle();
            }
            int w = root.TryGetProperty("w", out var wEl) ? wEl.GetInt32() : 0;
            int h = root.TryGetProperty("h", out var hEl) ? hEl.GetInt32() : 0;
            string handle = root.TryGetProperty("cam_handle", out var chEl) ? chEl.GetString() ?? "0" : "0";
            long  tsSrc   = root.TryGetProperty("ts", out var tsEl) ? tsEl.GetInt64() : 0;

            // R22: read proj_full[16] for web panel perspective divide; default zero if absent.
            float[] proj = new float[16];
            if (root.TryGetProperty("proj_full", out var projEl) && projEl.GetArrayLength() == 16)
            {
                int i = 0;
                foreach (var f in projEl.EnumerateArray()) proj[i++] = f.GetSingle();
            }

            snap = new CamSnap {
                handle = handle, pos = pos, m = m, proj = proj, w = w, h = h,
                matrix_age_ms = age, ts_src = tsSrc
            };
            return true;
        }
        catch { return false; }
    }

    // ─── Entity JSON read ─────────────────────────────────────────────
    struct EntRow { public int id; public float x, y, z; public string? type; }
    List<EntRow> TryReadEntities()
    {
        var list = new List<EntRow>();
        try
        {
            if (!File.Exists(EntitiesJsonPath)) return list;
            using var doc = JsonDocument.Parse(File.ReadAllText(EntitiesJsonPath));
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                int id = el.TryGetProperty("id", out var idEl) ? idEl.GetInt32() : 0;
                float x = el.TryGetProperty("x", out var xEl) ? xEl.GetSingle() : 0;
                float y = el.TryGetProperty("y", out var yEl) ? yEl.GetSingle() : 0;
                float z = el.TryGetProperty("z", out var zEl) ? zEl.GetSingle() : 0;
                string? type = el.TryGetProperty("type", out var tEl) ? tEl.GetString() : null;
                list.Add(new EntRow { id = id, x = x, y = y, z = z, type = type });
            }
        }
        catch { /* entities read failed; return collected-partial */ }
        return list;
    }

    // ─── Output ───────────────────────────────────────────────────────
    void WriteJson(ScreenOut payload)
    {
        // Plain reflection-based JsonSerializer (source-gen dropped per R21 fix)
        string json = JsonSerializer.Serialize(payload, JsonOpts);
        // Atomic write via tmp + File.Move(overwrite). Brief read window OK for our cadence.
        var tmp = ScreenPositionsJsonPath + ".tmp";
        File.WriteAllText(tmp, json);
        File.Move(tmp, ScreenPositionsJsonPath, overwrite: true);
    }

    static long    NowMs()  => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static float[] Zero3()  => new float[3];
    static float[] Zero16() => new float[16];

    // ─── DTOs ─────────────────────────────────────────────────────────
    public sealed class ScreenOut
    {
        public long ts { get; set; }
        public int tick { get; set; }
        public long ts_src { get; set; }
        public string cam_handle { get; set; } = "0";
        public float[] cam_pos { get; set; } = Array.Empty<float>();
        public float[] proj_full { get; set; } = Array.Empty<float>();   // R22: published for web panel
        public int w { get; set; }
        public int h { get; set; }
        public long matrix_age_ms { get; set; }
        public ScreenEntity[] positions { get; set; } = Array.Empty<ScreenEntity>();
    }
    public sealed class ScreenEntity
    {
        public int id { get; set; }
        public string type { get; set; } = "Entity";
        public float sx { get; set; }
        public float sy { get; set; }
        public float depth { get; set; }
        public float wx { get; set; }
        public float wy { get; set; }
        public float wz { get; set; }
        // R22: renamed from `in_front`. Returns true iff |depth| > 1e-6 — i.e. depth
        // is non-degenerate. Web panel applies its own heuristic for forward/back
        // based on Unity LH vs OpenGL RH convention.
        public bool depth_nonzero { get; set; }
    }
}
