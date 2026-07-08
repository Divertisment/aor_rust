using System.IO;
using System.Net.Sockets;
using System.Text;

namespace AorScanner;

class Program
{
    static int _playerId;
    static ulong _nameStrAddr;
    static Config _cfg = null!;

    static async Task Main(string[] args)
    {
        // Disable Console buffering so SIGKILL never loses already-written
        // lines that were sitting in the .NET StreamWriter (default 4 KB
        // when stdout is redirected to a file).
        try { Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true }); } catch { }

        Console.WriteLine("=== AOR Scanner (C#) - Heap Scan ===");
        _cfg = Config.Load();
        HeapScanner.Debug = _cfg.Scanner.Debug;
        _playerId = EnvInt("AOR_MY_ID") ?? 0;

        Console.WriteLine($"[CFG] Process: {_cfg.Game.ProcessName}");
        Console.WriteLine($"[CFG] Poll interval: {_cfg.Game.PollIntervalSecs}s");
        Console.WriteLine();

        if (_playerId == 0)
        {
            var gameName = Environment.GetEnvironmentVariable("AOR_PLAYER_NAME") ?? "KpAcuBa";
            Console.WriteLine($"[*] Will search for player name: \"{gameName}\"");
        }

        var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        try
        {
            await MainLoop(cts.Token);
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine("\n[*] Shutting down.");
        }
    }

    static async Task MainLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var pid = GameFinder.FindPid(_cfg.Game.ProcessName);
                if (pid == 0)
                {
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Game not found, waiting...");
                    await Task.Delay(_cfg.Game.PollIntervalSecs * 1000, ct);
                    continue;
                }

                // Find player name string once
                if (_nameStrAddr == 0)
                {
                    var gameName = Environment.GetEnvironmentVariable("AOR_PLAYER_NAME") ?? "KpAcuBa";
                    _nameStrAddr = PlayerNameFinder.FindPlayerNameString(pid, gameName);
                }

                // GOM-based scanner (replaces HeapScanner.ScanEntities) — direct walk via
                // UnityPlayer.so + 0x20EAAC0 → s_Instance → *(s_Instance)+0x18 → head node → node+0x00 next → node-0x68 GameObject.
                var entities = EntityFinderGom.Find(pid).ToList();
                Console.WriteLine($"[stats] tick #{_tickNum++} pid={pid} gom_walker={entities.Count}");

                // Try to find player by name string pointer (HeapScanner helper — works on any List<Entity>)
                if (_playerId == 0 && _nameStrAddr != 0)
                {
                    _playerId = HeapScanner.FindPlayerByName(entities, pid, _nameStrAddr);
                }

                HeapScanner.FilterAndClassify(entities, _playerId);

                PrintTable(entities, pid);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[-] Error: {ex.Message}");
            }

            await Task.Delay(_cfg.Game.PollIntervalSecs * 1000, ct);
        }
    }

    static void PrintTable(List<Entity> entities, int pid)
    {
        if (entities.Count == 0)
        {
            Console.WriteLine($"  [{DateTime.Now:HH:mm:ss}] No entities found.");
            return;
        }

        // Filter to only Player-class entities (per user request).
        var players = entities.Where(e => e.IsPlayer).ToList();

        var player = players.FirstOrDefault();
        Entity? firstAny = entities.FirstOrDefault();
        var px = player?.X ?? firstAny?.X ?? 0f;
        var py = player?.Y ?? firstAny?.Y ?? 0f;

        const string rl = "│";
        var cols = new[] { 4, 10, 12, 12, 12, 8, 7, 10 };
        var hdr = new[] { "#", "Type", "ID", "X", "Y", "Z", "Angle", "Dist" };

        string Row(string[] vals)
        {
            var s = rl;
            for (int i = 0; i < vals.Length; i++)
                s += vals[i].PadLeft(cols[i]) + rl;
            return s;
        }

        string Sep(char left, char mid, char right, char col)
        {
            var s = left.ToString();
            for (int i = 0; i < cols.Length; i++)
            {
                if (i > 0) s += col;
                s += new string('─', cols[i]);
            }
            return s + right;
        }

        Console.WriteLine();
        Console.WriteLine($"  [{DateTime.Now:HH:mm:ss}] PID={pid}  players={players.Count}/{entities.Count}");
        if (players.Count == 0)
        {
            Console.WriteLine("  (no Player rows in this tick — current classifier flags only the local player as Player)");
            return;
        }
        Console.WriteLine($"  {Sep('┌', '┬', '┐', '┬')}");
        Console.WriteLine($"  {Row(hdr)}");
        Console.WriteLine($"  {Sep('├', '┼', '┤', '┼')}");

        for (int i = 0; i < players.Count; i++)
        {
            var e = players[i];
            var dist = e.DistanceTo(px, py);
            var vals = new[]
            {
                (i + 1).ToString(),
                e.Type,
                e.Id.ToString(),
                e.X.ToString("F1"),
                e.Y.ToString("F1"),
                e.Z.ToString("F3"),
                e.Angle.ToString("F1"),
                dist.ToString("F1")
            };
            Console.WriteLine($"  {Row(vals)}");
        }

        Console.WriteLine($"  {Sep('└', '┴', '┘', '┴')}");

        try
        {
            var sb = new System.Text.StringBuilder();
            sb.Append('[');
            for (int i = 0; i < players.Count; i++)
            {
                if (i > 0) sb.Append(',');
                var e = players[i];
                var dist = e.DistanceTo(px, py);
                sb.Append($$"""{"id":{{e.Id}},"x":{{e.X:F1}},"y":{{e.Y:F1}},"z":{{e.Z:F3}},"angle":{{e.Angle:F1}},"dist":{{dist:F1}},"type":"{{e.Type}}"}""");
            }
            sb.Append(']');
            var jsonPath = "/tmp/aor_entities.json";
            File.WriteAllText(jsonPath, sb.ToString());

            // Bonus: push to C# radar via Unix Domain Socket (best-effort)
            EmitToRadarSocket(jsonPath);
        }
        catch { }
    }

    static int _tickNum = 1;
    static int? EnvInt(string key) =>
        int.TryParse(Environment.GetEnvironmentVariable(key), out var v) ? v : null;

    // ─── Radar Mode (Bonus): Unix Domain Socket client ────────────────────
    // Connects to /tmp/aor_radar.sock (a C# radar server) and pushes per-tick
    // JSON. Non-blocking: if the socket doesn't exist, the call returns silently
    // and the scanner keeps going. Best-effort, no retries, no reconnect logic.
    const string RadarSocketPath = "/tmp/aor_radar.sock";
    static void EmitToRadarSocket(string jsonPath)
    {
        try
        {
            if (!File.Exists(RadarSocketPath)) return;   // radar not listening
            if (!File.Exists(jsonPath)) return;

            var json = File.ReadAllText(jsonPath);
            var bytes = Encoding.UTF8.GetBytes(json + "\n");

            var endpoint = new UnixDomainSocketEndPoint(RadarSocketPath);
            using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            socket.Connect(endpoint);
            socket.Send(bytes);
        }
        catch (Exception ex)
        {
            // Don't crash the scanner if radar is down — log only
            Console.Error.WriteLine($"[-] UDS emit failed: {ex.Message}");
        }
    }
}
