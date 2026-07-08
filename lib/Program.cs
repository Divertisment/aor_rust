using AorLib.Capture;
using AorLib.Hook;
using AorLib.Output;
using Stas.AOR;

namespace AorLib;

internal static class Program {
    private static int Main(string[] args) {
        try { Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true }); } catch { /* ignore */ }

        Console.WriteLine("=== AOR Lib (Linux NativeAOT) ===");
        Console.WriteLine("[cfg] Photon parser + SharpPcap (udp+5056) + UDS → /tmp/aor_radar.sock");

        using var emitter = new RadarEmitter();
        var hooks = new PhotonHooks(emitter);

        var parser = new PhotonParser(
            onEvent: (ev, from) => hooks.OnEvent(ev, from),
            onRequest: null,
            onResponse: null
        );
        parser.OnParseError += hooks.OnParseError;
        parser.OnEncryptedPacket += hooks.OnEncryptedPacket;

        using var listener = new UdpListener(parser);
        listener.Start();

        Console.WriteLine("[ok] capturing. Ctrl+C to stop.");

        var exitEvent = new ManualResetEventSlim(false);
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; exitEvent.Set(); };
        AppDomain.CurrentDomain.ProcessExit += (_, _) => exitEvent.Set();

        exitEvent.Wait();

        Console.WriteLine("[*] shutting down");
        return 0;
    }
}
