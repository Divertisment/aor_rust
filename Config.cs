namespace AorScanner;

public class Config
{
    public GameConfig Game { get; set; } = new();
    public ServerConfig Server { get; set; } = new();
    public KernelConfig Kernel { get; set; } = new();
    public ScannerConfig Scanner { get; set; } = new();

    public class GameConfig
    {
        public string ProcessName { get; set; } = "Albion-Online";
        public int PollIntervalSecs { get; set; } = 5;
    }

    public class ServerConfig
    {
        public int RelayPort { get; set; } = 4445;
        public int StatusPort { get; set; } = 4447;
        public int CommandPort { get; set; } = 4446;
        public int SyncPort { get; set; } = 4444;
        public int GameUdpPort { get; set; } = 5056;
    }

    public class KernelConfig
    {
        /// <summary>Path to the aor_mem.ko module on disk. Informational only;
        /// the C# code talks to the loaded module via <see cref="DriverPath"/>.</summary>
        public string ModulePath { get; set; } = "/home/stas/AOR_core/aor_mem.ko";

        /// <summary>When true, prefer the /proc/aor_mem driver over process_vm_readv.</summary>
        public bool UseDriver { get; set; } = true;

        /// <summary>Path to the driver proc file. Default: <c>/proc/aor_mem</c>.</summary>
        public string DriverPath { get; set; } = "/proc/aor_mem";
    }

    public class ScannerConfig
    {
        public int MaxEntities { get; set; } = 200;
        public bool Debug { get; set; } = false;
    }

    public static Config Load()
    {
        var cfg = new Config();
        var paths = new[] { "config.toml", "/etc/aor_core/config.toml" };

        foreach (var path in paths)
        {
            if (!File.Exists(path)) continue;
            try
            {
                var lines = File.ReadAllLines(path);
                string section = "";
                foreach (var raw in lines)
                {
                    var line = raw.Trim();
                    if (line.StartsWith('[') && line.EndsWith(']'))
                    {
                        section = line[1..^1].Trim().ToLowerInvariant();
                        continue;
                    }
                    if (line == "" || line.StartsWith('#') || !line.Contains('=')) continue;

                    var eq = line.IndexOf('=');
                    if (eq < 0) continue;
                    var key = line[..eq].Trim();
                    var val = line[(eq + 1)..].Trim().Trim('"');

                    switch (section)
                    {
                        case "game":
                            if (key == "process_name") cfg.Game.ProcessName = val;
                            if (key == "poll_interval_secs" && int.TryParse(val, out var pi)) cfg.Game.PollIntervalSecs = pi;
                            break;
                        case "server":
                            if (key == "relay_port" && int.TryParse(val, out var rp)) cfg.Server.RelayPort = rp;
                            if (key == "status_port" && int.TryParse(val, out var sp)) cfg.Server.StatusPort = sp;
                            if (key == "command_port" && int.TryParse(val, out var cp)) cfg.Server.CommandPort = cp;
                            if (key == "sync_port" && int.TryParse(val, out var sy)) cfg.Server.SyncPort = sy;
                            if (key == "game_udp_port" && int.TryParse(val, out var gu)) cfg.Server.GameUdpPort = gu;
                            break;
                        case "kernel":
                            if (key == "module_path") cfg.Kernel.ModulePath = val;
                            if (key == "use_driver" && bool.TryParse(val, out var kud)) cfg.Kernel.UseDriver = kud;
                            if (key == "driver_path") cfg.Kernel.DriverPath = val;
                            break;
                        case "scanner":
                            if (key == "max_entities" && int.TryParse(val, out var me)) cfg.Scanner.MaxEntities = me;
                            if (key == "debug" && bool.TryParse(val, out var db)) cfg.Scanner.Debug = db;
                            break;
                    }
                }
                return cfg;
            }
            catch { }
        }

        // env overrides
        if (Env("AOR_PROC_NAME") is { } epn) cfg.Game.ProcessName = epn;
        if (EnvInt("AOR_POLL_INTERVAL") is { } epi) cfg.Game.PollIntervalSecs = epi;
        if (EnvInt("AOR_RELAY_PORT") is { } erp) cfg.Server.RelayPort = erp;
        if (EnvInt("AOR_STATUS_PORT") is { } esp) cfg.Server.StatusPort = esp;
        if (EnvInt("AOR_CMD_PORT") is { } ecp) cfg.Server.CommandPort = ecp;
        if (EnvInt("AOR_SYNC_PORT") is { } esy) cfg.Server.SyncPort = esy;
        if (EnvInt("AOR_GAME_UDP_PORT") is { } egp) cfg.Server.GameUdpPort = egp;
        if (Env("AOR_KMOD_PATH") is { } ekp) cfg.Kernel.ModulePath = ekp;
        if (Env("AOR_USE_DRIVER") is { } eud && bool.TryParse(eud, out var eudv)) cfg.Kernel.UseDriver = eudv;
        if (Env("AOR_DRIVER_PATH") is { } edp) cfg.Kernel.DriverPath = edp;
        if (EnvInt("AOR_MAX_ENTITIES") is { } eme) cfg.Scanner.MaxEntities = eme;
        if (Env("AOR_DEBUG") is { }) cfg.Scanner.Debug = true;

        return cfg;
    }

    static string? Env(string key) => Environment.GetEnvironmentVariable(key);
    static int? EnvInt(string key) => int.TryParse(Env(key), out var v) ? v : null;
}
