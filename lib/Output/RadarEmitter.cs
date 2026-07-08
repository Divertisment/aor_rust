using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace AorLib.Output;

/// <summary>
/// Fire-and-forget NDJSON emitter over the same Unix Domain Socket that
/// <c>radar_server</c> listens on (<c>/tmp/aor_radar.sock</c>). Locks around
/// <c>Send</c> because SharpPcap invokes <c>OnPacketArrival</c> from multiple
/// threads (one per device). Auto-reconnects after a transient drop.
/// </summary>
public sealed class RadarEmitter : IDisposable {
    private const string SocketPath = "/tmp/aor_radar.sock";

    private readonly object _lock = new();
    private Socket? _socket;
    private bool _disposed;

    public void Emit(TickDto tick) {
        if (_disposed) return;
        lock (_lock) {
            try {
                EnsureConnected();
                if (_socket is null) return;
                string json = JsonSerializer.Serialize(tick, TickDtoJsonContext.Default.TickDto);
                byte[] bytes = Encoding.UTF8.GetBytes(json + "\n");
                _socket.Send(bytes);
            } catch {
                Disconnect();
            }
        }
    }

    private void EnsureConnected() {
        if (_socket is not null) return;
        if (!File.Exists(SocketPath)) return;  // radar_server not listening — drop silently
        try {
            var endpoint = new UnixDomainSocketEndPoint(SocketPath);
            _socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            _socket.Connect(endpoint);
        } catch {
            _socket = null;
        }
    }

    private void Disconnect() {
        try { _socket?.Close(); } catch { /* ignore */ }
        _socket = null;
    }

    public void Dispose() {
        if (_disposed) return;
        _disposed = true;
        lock (_lock) { Disconnect(); }
    }
}
