using System.Text.Json.Serialization;

namespace AorLib.Output;

/// <summary>
/// One row emitted over UDS. Compatible with the existing <c>radar_server</c>
/// pretty-logger (it just prints whatever JSON it receives, so extra fields
/// are fine). <c>cluster</c> is null until a cluster-id → name mapping is wired in.
/// </summary>
public class TickDto {
    public double ts { get; set; }
    public string bot { get; set; } = "";
    public string? cluster { get; set; }
    public ulong player_id { get; set; }
    public float x { get; set; }
    public float y { get; set; }
    public string type { get; set; } = "Player";
}

/// <summary>
/// Source-generated JSON context — required for NativeAOT (no reflection-based
/// serialization). Adding a new <see cref="TickDto"/> field also requires
/// adding it to the <see cref="JsonSerializable"/> attribute list below.
/// </summary>
[JsonSourceGenerationOptions(WriteIndented = false)]
[JsonSerializable(typeof(TickDto))]
internal partial class TickDtoJsonContext : JsonSerializerContext {
}
