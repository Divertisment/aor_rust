using System.Collections.Concurrent;
using AorLib.Decrypt;
using AorLib.Output;
using Stas.AOR;

namespace AorLib.Hook;

/// <summary>
/// Subscribes to <see cref="PhotonParser"/> events and produces <see cref="TickDto"/>s:
/// <list type="bullet">
///   <item>KeySync (code 598) — store 8-byte salt in <see cref="SaltTable"/> keyed by <c>from</c>.</item>
///   <item>Move (code 3) — pull decrypted X/Y from <c>param[4..5]</c> (set by EventProcessor),
///   time-based dedup by player_id, emit to <see cref="RadarEmitter"/>.</item>
/// </list>
/// </summary>
public sealed class PhotonHooks {
    private const int KeySyncCode = 598;
    private const int MoveCode = 3;
    private const int DedupWindowMs = 200;

    private readonly RadarEmitter _emitter;
    private readonly ConcurrentDictionary<int, long> _lastSeen = new();

    private long _saltsSeen;
    private long _movesSeen;
    private long _emitted;
    private long _deduped;
    private long _nextStatsLog;

    public PhotonHooks(RadarEmitter emitter) {
        _emitter = emitter ?? throw new ArgumentNullException(nameof(emitter));
    }

    public void OnEvent(EventData ev, string from) {
        if (ev.Code == KeySyncCode) {
            // KeySync salt extraction already happens inside EventProcessor.PostProcessEvent;
            // we just count it here for stats.
            if (ev.Parameters != null && ev.Parameters.TryGetValue(1, out var rawObj) && rawObj is byte[] raw && raw.Length == 8) {
                _saltsSeen++;
            }
            return;
        }

        if (ev.Code != MoveCode) return;
        if (ev.Parameters == null) return;

        if (!ev.Parameters.TryGetValue(0, out var idObj)) return;
        if (!ev.Parameters.TryGetValue(4, out var xObj) || xObj is not float) return;
        if (!ev.Parameters.TryGetValue(5, out var yObj) || yObj is not float) return;

        int playerId = Convert.ToInt32(idObj);
        float x = (float)xObj;
        float y = (float)yObj;

        _movesSeen++;

        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long last = _lastSeen.GetValueOrDefault(playerId, 0);
        if (nowMs - last < DedupWindowMs) {
            _deduped++;
            return;
        }
        _lastSeen[playerId] = nowMs;

        var dto = new TickDto {
            ts = nowMs / 1000.0,
            bot = from ?? "",
            cluster = null,
            player_id = (ulong)(uint)playerId,
            x = x,
            y = y,
            type = "Player",
        };
        _emitter.Emit(dto);
        _emitted++;

        if (_emitted >= _nextStatsLog) {
            _nextStatsLog = _emitted + 100;
            Console.WriteLine($"[stats] salts={_saltsSeen} moves={_movesSeen} emitted={_emitted} deduped={_deduped} flows={SaltTable.Count}");
        }
    }

    public void OnParseError(string msg, int len) {
        Console.Error.WriteLine($"[photon] parse error: {msg} (len={len})");
    }

    public void OnEncryptedPacket(int len) {
        // Counts increase, but no actionable log line per packet (would flood)
    }
}
