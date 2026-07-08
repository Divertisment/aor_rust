using System;
using System.Buffers.Binary;
using System.IO;
using System.Text.Json;

namespace AorScanner;

/// <summary>
/// C# reader for Unity Camera worldToCameraMatrix + projectionMatrix.
/// Used by radar_server / web_panel / kernel-driven bots to obtain the
/// active camera's transform for projecting world-space entity coords
/// (from <see cref="EntityFinderGom"/>) into screen space.
///
/// Two read paths, in priority order:
///   1. PRIMARY: parse /tmp/aor_camera_matrix.json (written every 200ms
///      by Frida's hook_camera_matrix.js). Most reliable — works as soon
///      as frida has bound the camera via the latched-cam cache.
///   2. FALLBACK: direct kernel-driver read at a known Camera address
///      (caller supplies the address from RE / GOM walk / frida).
///      Speculative offsets for worldToCameraMatrix / projectionMatrix /
///      position are used; verify in RE for your build.
///
/// Camera matrix layout (Unity 2021+ IL2CPP managed heap, struct):
///   worldToCameraMatrix : Matrix4x4 = float[16] (column-major, 64 bytes)
///   projectionMatrix    : Matrix4x4 = float[16] (column-major, 64 bytes)
///   position            : Vector3   = float[3]  (12 bytes)
///   pixelWidth/Height   : int       (4 bytes each)
///
/// Usage:
///   var snap = CameraMatrixReader.Read(pid);
///   if (snap.Found) {
///       // snap.WorldToCameraMatrix[0..15]   — 4x4 column-major
///       // snap.ProjectionMatrix[0..15]      — 4x4 column-major
///       // snap.Position[0..2]               — Vector3
///   } else {
///       // see snap.Diagnostic
///   }
///
/// Thread-safety: all members are static and stateless aside from the
/// /tmp JSON file read which is locked externally. Safe to call from
/// any thread.
/// </summary>
public static class CameraMatrixReader
{
    // ─── Paths ───────────────────────────────────────────────────────
    const string FridaJsonPath   = "/tmp/aor_camera_matrix.json";
    const long   JsonFreshnessMs = 2000; // accept JSON up to 2s old

    // ─── Sizes ───────────────────────────────────────────────────────
    const int Matrix4x4Size = 64;  // 16 floats × 4 bytes
    const int Vector3Size   = 12;  // 3 floats × 4 bytes

    // ─── Speculative Camera struct offsets for direct read path ─────
    // Unity 2021+ IL2CPP codegen for Camera class. NOT guaranteed across
    // builds; the RE pass for your specific Albion build may need to
    // adjust these. Position assumes the same +0x38/+0x3C/+0x40 used
    // by Hero MonoBehaviour (hook_camera_matrix.js).
    const int Speculative_W2C_Off  = 0xB0;  // worldToCameraMatrix
    const int Speculative_PROJ_Off = 0xF0;  // projectionMatrix
    const int Speculative_POS_Off  = 0x38;  // X,Y,Z (Hero layout)

    // ─── Direct read window (bytes from camAddr) ────────────────────
    const int DirectReadWindow = 256;

    /// <summary>
    /// Snapshot of a camera read. Found=false means caller must inspect
    /// Diagnostic and either retry later or supply a Camera address to
    /// <see cref="ReadFromMemory(int, ulong)"/>.
    /// </summary>
    public record struct CameraSnapshot(
        bool     Found,
        ulong    CameraAddr,
        float[]  WorldToCameraMatrix,  // 16 floats column-major
        float[]  ProjectionMatrix,      // 16 floats column-major
        float[]  Position,              // 3 floats (Vector3)
        int      Width,
        int      Height,
        long     TimestampMs,           // Unix ms of source tick
        string   Diagnostic
    );

    /// <summary>
    /// Read camera matrix. Tries frida JSON first; falls back to "no data
    /// found" with a descriptive Diagnostic. For a direct kernel read at a
    /// known address, call <see cref="ReadFromMemory(int, ulong)"/> explicitly.
    /// </summary>
    public static CameraSnapshot Read(int pid)
    {
        // PRIMARY PATH: parse /tmp/aor_camera_matrix.json if fresh.
        var jsonSnap = TryReadFromFridaJson();
        if (jsonSnap.Found) return jsonSnap;

        // FALLBACK PATH: nothing from frida. Return empty snapshot with
        // a strongly-worded diagnostic telling the user EXACTLY what to do.
        return new CameraSnapshot(
            Found: false,
            CameraAddr: 0,
            WorldToCameraMatrix: NewZeroMatrix(),
            ProjectionMatrix:    NewZeroMatrix(),
            Position:            new float[3],
            Width: 0, Height: 0,
            TimestampMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Diagnostic: $"[json] {jsonSnap.Diagnostic}. " +
                        $"FIX PATH 1: ensure hook_camera_matrix.js is running and producing " +
                        $"/tmp/aor_camera_matrix.json (<2s old). " +
                        $"FIX PATH 2: RE the Camera instance address via GOM walk (mirror " +
                        $"EntityFinderGom.cs strategy) and call " +
                        $"ReadFromMemory(pid, addr) — but NOTE offsets are speculative. " +
                        $"FIX PATH 3 (recommended): wait for frida R10/R11 live-validated " +
                        $"and JSON path will populate automatically."
        );
    }

    /// <summary>
    /// Direct kernel-driver read of camera matrix at a known address.
    /// Reads a 256-byte window from <paramref name="cameraAddr"/> and
    /// extracts matrices at the speculative offsets defined as constants.
    /// RE your specific build for accurate offsets.
    /// </summary>
    public static CameraSnapshot ReadFromMemory(int pid, ulong cameraAddr)
    {
        if (cameraAddr == 0 || !MemoryReader.IsValidHeapPtr(cameraAddr))
        {
            return EmptyWithDiag(cameraAddr, "invalid camera address (not in high-heap range)");
        }

        // Read the camera window via kernel driver (aor_mem.ko). If that
        // fails, fall back to process_vm_readv (auto-fallback inside
        // MemoryReader.Read).
        var buf = MemoryReader.ReadArray(pid, cameraAddr, DirectReadWindow);
        if (buf == null || buf.Length < DirectReadWindow)
        {
            return EmptyWithDiag(cameraAddr,
                $"kernel read short: {(buf?.Length ?? 0)}/{DirectReadWindow} bytes");
        }

        // Extract matrices at speculative offsets. Default fallback for
        // missing or zero-length arrays is a zero-filled Matrix4x4/Vector3.
        var w2c    = ExtractFloats(buf, Speculative_W2C_Off,  16);
        var proj   = ExtractFloats(buf, Speculative_PROJ_Off, 16);
        var pos    = ExtractFloats(buf, Speculative_POS_Off,   3);

        // Heuristic: if w2c is all-zero, the offset is likely wrong.
        // Signal via Diagnostic so the caller can RE the real offset.
        bool allZero = true;
        for (int i = 0; i < 16; i++) if (w2c[i] != 0f) { allZero = false; break; }
        string diag = allZero
            ? $"WARNING: worldToCameraMatrix all-zero at speculative offset 0x{Speculative_W2C_Off:x} " +
              "— RE the Camera struct for your build (offsets are NOT verified). " +
              "Values here are likely garbage from random memory."
            : "WARNING: kernel read OK but offsets 0xB0/0xF0/0x38 are SPECULATIVE " +
              "and not RE-verified for this build. " +
              "worldToCameraMatrix values may be from random memory. " +
              "Confirm with frida or RE the Camera instance first.";

        return new CameraSnapshot(
            Found: !allZero,
            CameraAddr: cameraAddr,
            WorldToCameraMatrix: w2c,
            ProjectionMatrix:    proj,
            Position:            pos,
            Width: 0, Height: 0,
            TimestampMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Diagnostic: diag
        );
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    static CameraSnapshot TryReadFromFridaJson()
    {
        try
        {
            if (!File.Exists(FridaJsonPath)) return EmptyWithDiag(0, "json file missing");
            var fi = new FileInfo(FridaJsonPath);
            long ageMs = (DateTimeOffset.UtcNow - fi.LastWriteTimeUtc).Ticks / TimeSpan.TicksPerMillisecond;
            if (ageMs > JsonFreshnessMs) return EmptyWithDiag(0, $"json stale ({ageMs}ms old, threshold {JsonFreshnessMs}ms)");
            if (fi.Length < 4) return EmptyWithDiag(0, "json too small");

            string json = File.ReadAllText(FridaJsonPath);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var w2c  = new float[16];
            var proj = new float[16];
            var pos  = new float[3];

            // Prefer full 4x4 if present.
            if (root.TryGetProperty("w2c_full", out var w2cFull) && w2cFull.GetArrayLength() == 16)
            {
                int i = 0;
                foreach (var f in w2cFull.EnumerateArray()) w2c[i++] = f.GetSingle();
            }
            else if (root.TryGetProperty("w2c", out var w2cShort) && w2cShort.GetArrayLength() == 12)
            {
                // 3x4 unrolled matrix; pad 4th row with [0,0,0,1] for full 4x4 form.
                w2c[0]  = w2cShort[0].GetSingle();   w2c[1]  = w2cShort[1].GetSingle();   w2c[2]  = w2cShort[2].GetSingle();   w2c[3]  = 0f;
                w2c[4]  = w2cShort[3].GetSingle();   w2c[5]  = w2cShort[4].GetSingle();   w2c[6]  = w2cShort[5].GetSingle();   w2c[7]  = 0f;
                w2c[8]  = w2cShort[6].GetSingle();   w2c[9]  = w2cShort[7].GetSingle();   w2c[10] = w2cShort[8].GetSingle();   w2c[11] = 0f;
                w2c[12] = w2cShort[9].GetSingle();   w2c[13] = w2cShort[10].GetSingle();  w2c[14] = w2cShort[11].GetSingle();  w2c[15] = 1f;
            }
            else
            {
                return EmptyWithDiag(0, "json missing both w2c_full[16] and w2c[12]");
            }

            if (root.TryGetProperty("proj_full", out var projEl) && projEl.GetArrayLength() == 16)
            {
                int i = 0;
                foreach (var f in projEl.EnumerateArray()) proj[i++] = f.GetSingle();
            }

            if (root.TryGetProperty("pos", out var posEl) && posEl.GetArrayLength() == 3)
            {
                int i = 0;
                foreach (var f in posEl.EnumerateArray()) pos[i++] = f.GetSingle();
            }

            int w = root.TryGetProperty("w", out var wEl) ? wEl.GetInt32() : 0;
            int h = root.TryGetProperty("h", out var hEl) ? hEl.GetInt32() : 0;

            string camHandle = root.TryGetProperty("cam_handle", out var chEl) ? chEl.GetString() ?? "0" : "0";
            ulong camAddr = 0;
            if (camHandle.StartsWith("0x") &&
                !ulong.TryParse(camHandle.AsSpan(2), System.Globalization.NumberStyles.HexNumber, null, out camAddr))
            {
                camAddr = 0;
            }

            long ts = root.TryGetProperty("ts", out var tsEl) ? tsEl.GetInt64() : 0;

            return new CameraSnapshot(
                Found: true,
                CameraAddr: camAddr,
                WorldToCameraMatrix: w2c,
                ProjectionMatrix:    proj,
                Position:            pos,
                Width: w, Height: h,
                TimestampMs: ts,
                Diagnostic: $"frida json age={ageMs}ms"
            );
        }
        catch (Exception ex)
        {
            return EmptyWithDiag(0, $"json parse error: {ex.GetType().Name}: {ex.Message}");
        }
    }

    static float[] ExtractFloats(byte[] buf, int offset, int count)
    {
        var result = new float[count];
        for (int i = 0; i < count; i++)
        {
            int byteOff = offset + i * 4;
            if (byteOff + 4 > buf.Length)
            {
                result[i] = 0f;
                continue;
            }
            result[i] = BitConverter.ToSingle(buf.AsSpan(byteOff, 4));
        }
        return result;
    }

    static float[] NewZeroMatrix() => new float[16];

    static CameraSnapshot EmptyWithDiag(ulong camAddr, string msg) => new CameraSnapshot(
        Found: false,
        CameraAddr: camAddr,
        WorldToCameraMatrix: NewZeroMatrix(),
        ProjectionMatrix:    NewZeroMatrix(),
        Position:            new float[3],
        Width: 0, Height: 0,
        TimestampMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        Diagnostic: msg
    );
}
