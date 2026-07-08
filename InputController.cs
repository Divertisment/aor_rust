using System.IO;

namespace AorScanner;

public static class InputController
{
    public static string DriverPath { get; set; } = "/proc/aor_input";

    public static void ZoomIn(int steps = 1)
    {
        Zoom(steps);
    }

    public static void ZoomOut(int steps = 1)
    {
        Zoom(-steps);
    }

    public static void Zoom(int steps)
    {
        if (steps == 0) return;
        steps = Math.Clamp(steps, -100, 100);
        File.WriteAllText(DriverPath, $"W {steps}\n");
    }

    public static void PressKey(int keyCode, int durationMs = 50)
    {
        durationMs = Math.Clamp(durationMs, 1, 10000);
        File.WriteAllText(DriverPath, $"K {keyCode} {durationMs}\n");
    }

    public static void TapKey(int keyCode)
    {
        PressKey(keyCode, 50);
    }

    public static void HoldKey(int keyCode)
    {
        PressKey(keyCode, 5000);
    }
}
