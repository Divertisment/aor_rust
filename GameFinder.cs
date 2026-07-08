namespace AorScanner;

public static class GameFinder
{
    public static int FindPid(string processName)
    {
        foreach (var proc in Directory.EnumerateDirectories("/proc"))
        {
            var pidStr = Path.GetFileName(proc);
            if (!pidStr.All(char.IsDigit)) continue;

            var commPath = Path.Combine(proc, "comm");
            if (!File.Exists(commPath)) continue;

            try
            {
                var comm = File.ReadAllText(commPath).Trim();
                if (!comm.Contains(processName)) continue;
            }
            catch { continue; }

            var statusPath = Path.Combine(proc, "status");
            if (File.Exists(statusPath))
            {
                try
                {
                    var status = File.ReadAllText(statusPath);
                    if (status.Contains("State:") && status.Contains("Z")) continue;
                }
                catch { }
            }

            if (int.TryParse(pidStr, out var pid))
                return pid;
        }
        return 0;
    }
}
