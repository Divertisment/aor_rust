// ============================================================================
// radar_server/Program.cs
// — Tiny C# listener for /tmp/aor_radar.sock (Unix Domain Socket).
// — Receives newline-delimited JSON lines emitted by AOR_core/Program.cs and
//   pretty-logs them. No Albion interaction. Suitable for AnyDesk session:
//   user runs this in a terminal, then connects the AOR scanner as client.
// ============================================================================
using System.Net.Sockets;
using System.Text;
using AorRadar.Server;  // FIX(R22): MatrixProjector lives here; top-level statements Program.cs is in the global namespace, so need explicit using.

const string SocketPath = "/tmp/aor_radar.sock";
const int    Backlog    = 4;

Console.WriteLine($"=== AOR Radar Server (C#) ===");
Console.WriteLine($"[cfg] listening on unix://{SocketPath}");

if (File.Exists(SocketPath))
{
    try { File.Delete(SocketPath); } catch (Exception ex) { Console.Error.WriteLine($"[-] stale socket cleanup failed: {ex.Message}"); Environment.Exit(1); }
}

var endpoint = new UnixDomainSocketEndPoint(SocketPath);
var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
listener.Bind(endpoint);
listener.Listen(Backlog);
Console.WriteLine($"[ok]   bound. Waiting for AOR Scanner producers...");

var cts = new System.Threading.CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); listener.Close(); };

// FIX(R20): start MatrixProjector as background task — polls frida camera-matrix JSON
// and AOR scanner entities JSON, projects every entity through the view transform,
// writes /tmp/aor_screen_positions.json for the web panel. Independent of the UDS
// listener loop (matrix producer doesn't need to push via UDS — it shares the JSON
// file with the AOR_core scanner + frida).
_ = Task.Run(() => new MatrixProjector(cts.Token).Run());

int tickCount = 0;
while (!cts.IsCancellationRequested)
{
    Socket? producer = null;
    try
    {
        producer = listener.Accept();   // blocking; cts won't actually unblock — Ctrl-C exits via CancelKeyPress
    }
    catch (Exception ex) when (cts.IsCancellationRequested)
    {
        break;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[-] accept failed: {ex.Message}");
        continue;
    }

    _ = Task.Run(() => HandleProducer(producer, ++tickCount, cts.Token));
}

try { File.Delete(SocketPath); } catch { }
Console.WriteLine("[*] radar server stopped.");

static void HandleProducer(Socket producer, int connectionId, System.Threading.CancellationToken ct)
{
    Console.WriteLine($"[+]   connection #{connectionId} from {producer.RemoteEndPoint}");
    // Single accumulating buffer + read offset, no per-tick MemoryStream allocation.
    var buf       = new byte[64 * 1024];
    int head      = 0;
    int len       = 0;
    try
    {
        // Producer sends JSON lines and may close the connection between ticks.
        // We loop until the peer closes (Receive returns 0) or cancellation is requested.
        while (!ct.IsCancellationRequested)
        {
            int n;
            try { n = producer.Receive(buf, head + len, buf.Length - head - len, SocketFlags.None); }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[-] connection #{connectionId} receive failed: {ex.Message}");
                break;
            }
            if (n == 0)
            {
                Console.WriteLine($"[-]   connection #{connectionId} closed by peer");
                break;
            }
            len += n;

            // Drain complete '\n'-terminated lines from the front of [head..head+len).
            int nl;
            while ((nl = Array.IndexOf(buf, (byte)'\n', head, len)) >= 0)
            {
                int lineLen = nl - head;
                var line = Encoding.UTF8.GetString(buf, head, lineLen).TrimEnd('\r');
                head += lineLen + 1;
                len  -= lineLen + 1;
                if (line.Length > 0) Console.WriteLine($"[tick #{connectionId}] {line}");
            }

            // Compact: shift unread tail to start of buffer to free space.
            if (head > 0 && len > 0) { Buffer.BlockCopy(buf, head, buf, 0, len); head = 0; }
            else if (len == 0)       { head = 0; }
            if (head + len == buf.Length)
            {
                // Frame bigger than buffer — discard rather than spin.
                Console.Error.WriteLine($"[-] connection #{connectionId} line too long (>64K), discarding");
                head = 0; len = 0;
            }
        }
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[-] connection #{connectionId} error: {ex.Message}");
    }
    finally
    {
        try { producer.Shutdown(SocketShutdown.Both); } catch { }
        producer.Close();
    }
}
