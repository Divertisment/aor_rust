using System.Net;
using PacketDotNet;
using SharpPcap;
using SharpPcap.LibPcap;
using Stas.AOR;

namespace AorLib.Capture;

/// <summary>
/// Owns one or more libpcap devices and pumps UDP/5056 payloads into a
/// <see cref="PhotonParser"/>. The IPv4 destination address is passed through
/// as <c>from</c> so downstream layers can key state per bot.
/// </summary>
public sealed class UdpListener : IDisposable {
    private readonly PhotonParser _parser;
    private readonly List<ILiveDevice> _devices = new();
    private bool _disposed;

    public UdpListener(PhotonParser parser) {
        _parser = parser ?? throw new ArgumentNullException(nameof(parser));
    }

    public void Start() {
        var devices = CaptureDeviceList.Instance;
        Console.WriteLine($"[capture] found {devices.Count} device(s)");
        foreach (var dev in devices) {
            // Skip loopback-only "devices" that can't see real traffic
            if (!HasMacOrIsLoopback(dev)) continue;
            try {
                dev.Open(DeviceModes.Promiscuous, 1000);
                dev.Filter = "udp and port 5056";
                dev.OnPacketArrival += OnPacketArrival;
                dev.StartCapture();
                _devices.Add(dev);
                Console.WriteLine($"[capture] active: {dev.Description ?? dev.Name}");
            } catch (Exception ex) {
                Console.Error.WriteLine($"[!] open {dev.Name} failed: {ex.Message}");
            }
        }
        if (_devices.Count == 0) {
            Console.Error.WriteLine("[-] no devices opened — check WinPcap/Npcap/libpcap installation & permissions");
        }
    }

    private static bool HasMacOrIsLoopback(ILiveDevice dev) {
        if (dev.MacAddress != null) return true;
        if (dev is LibPcapLiveDevice lpc) {
            return lpc.Addresses?.Any(a => a.Addr?.ipAddress?.Equals(IPAddress.Loopback) ?? false) ?? false;
        }
        return false;
    }

    private void OnPacketArrival(object sender, PacketCapture e) {
        try {
            var dev = (ILiveDevice)sender;
            var raw = e.GetPacket();
            var parsed = Packet.ParsePacket(raw.LinkLayerType, raw.Data);
            var ip4 = parsed.Extract<IPv4Packet>();
            string da = ip4?.DestinationAddress.ToString() ?? "";
            var udp = parsed.Extract<UdpPacket>();
            if (udp?.PayloadData != null && udp.PayloadData.Length > 0) {
                _parser.ReceivePacket(udp.PayloadData, da);
            }
        } catch {
            // ignore parse errors — common at startup / when bot isn't connected
        }
    }

    public void Dispose() {
        if (_disposed) return;
        _disposed = true;
        foreach (var d in _devices) {
            try { d.StopCapture(); } catch { /* ignore */ }
            try { d.Close(); } catch { /* ignore */ }
        }
        _devices.Clear();
    }
}
