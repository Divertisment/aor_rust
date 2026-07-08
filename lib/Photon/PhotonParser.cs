using System;
using System.Buffers.Binary;
using System.Collections.Generic;

namespace Stas.AOR {
    public class SegmentedPackage {
        public int TotalLength { get; set; }
        public int BytesWritten { get; set; }
        public byte[] Payload { get; set; }
        public DateTime CreatedAt { get; set; }
        public HashSet<int> SeenOffsets { get; set; } = new HashSet<int>();
    }

    public class PhotonParser {
        private const int photonHeaderLength = 12;
        private const int commandHeaderLength = 12;
        private const int fragmentHeaderLength = 20;
        private const int maxPendingSegments = 64;

        private const byte cmdDisconnect = 4;
        private const byte cmdSendReliable = 6;
        private const byte cmdSendUnreliable = 7;
        private const byte cmdSendFragment = 8;

        private const byte msgRequest = 2;
        private const byte msgResponse = 3;
        private const byte msgEvent = 4;
        private const byte msgResponseAlt = 7;
        private const byte msgEncrypted = 131;

        private readonly Dictionary<uint, SegmentedPackage> _pendingSegments;

        // OnEvent now carries the source address ("from") so the hook layer can
        // key per-bot state (e.g. salt table) by destination IP.
        public Action<EventData, string> OnEvent { get; set; }
        public Action<OperationRequest> OnRequest { get; set; }
        public Action<OperationResponse> OnResponse { get; set; }
        public Action<int> OnEncryptedPacket { get; set; }
        public Action<int, byte[]> OnEncryptedMessage { get; set; }
        public Action<int, byte[]> OnEncryptedCommand { get; set; }
        public Action<string, int> OnParseError { get; set; }
        public Action<string, byte[]> OnRawMessage { get; set; }
        public Action<byte, byte, byte, int, uint> OnCommandParsed { get; set; }

        public PhotonParser(Action<EventData, string> onEvent = null,
                            Action<OperationRequest> onRequest = null,
                            Action<OperationResponse> onResponse = null) {
            _pendingSegments = new Dictionary<uint, SegmentedPackage>();
            OnEvent = onEvent;
            OnRequest = onRequest;
            OnResponse = onResponse;
        }

        public bool ReceivePacket(byte[] payload, string from) {
            if (payload == null || payload.Length < photonHeaderLength) {
                OnParseError?.Invoke("payload shorter than photon header", payload?.Length ?? 0);
                return false;
            }

            int offset = 2; // skip peerId
            byte flags = payload[offset];
            offset++;
            int commandCount = payload[offset];
            offset++;
            offset += 8; // skip timestamp + challenge

            if (flags == 1) {
                OnEncryptedPacket?.Invoke(payload.Length);
            }

            if (commandCount == 0 && flags != 1) {
                return false;
            }

            // AorLib: pass `from` as parameter through the call chain (NOT a shared
            // field) so 8 SharpPcap device threads can't race and tag bot-A's event
            // with bot-B's dest IP.
            for (int i = 0; i < commandCount; i++) {
                bool ok;
                (offset, ok) = HandleCommand(payload, offset, from);
                if (!ok) {
                    OnParseError?.Invoke("handleCommand failed", payload.Length);
                    return false;
                }
            }
            return true;
        }

        private (int nextOffset, bool success) HandleCommand(byte[] src, int offset, string from) {
            if (!Available(src, offset, commandHeaderLength)) return (offset, false);

            byte cmdType = src[offset];
            byte channelId = src[offset + 1];
            byte commandFlags = src[offset + 2];
            offset += 4;

            int cmdLen = (int)BinaryPrimitives.ReadUInt32BigEndian(src.AsSpan(offset));
            offset += 4;
            uint relSeq = BinaryPrimitives.ReadUInt32BigEndian(src.AsSpan(offset));
            offset += 4;

            cmdLen -= commandHeaderLength;
            if (cmdLen < 0 || !Available(src, offset, cmdLen)) return (offset, false);

            OnCommandParsed?.Invoke(cmdType, channelId, commandFlags, cmdLen, relSeq);

            switch (cmdType) {
                case cmdDisconnect:
                    return (offset + cmdLen, true);
                case cmdSendUnreliable:
                    if (cmdLen < 4) return (offset + cmdLen, false);
                    offset += 4;
                    cmdLen -= 4;
                    return (HandleSendReliable(src, offset, cmdLen, from), true);
                case cmdSendReliable:
                    return (HandleSendReliable(src, offset, cmdLen, from), true);
                case cmdSendFragment:
                    return (HandleSendFragment(src, offset, cmdLen, from), true);
                default:
                    return (offset + cmdLen, true);
            }
        }

        private int HandleSendReliable(byte[] src, int offset, int cmdLen, string from) {
            if (cmdLen < 2 || !Available(src, offset, cmdLen)) return offset + cmdLen;

            offset++;
            byte msgType = src[offset];
            offset++;
            cmdLen -= 2;

            if (!Available(src, offset, cmdLen)) return offset + cmdLen;

            byte[] data = new byte[cmdLen];
            Buffer.BlockCopy(src, offset, data, 0, cmdLen);
            offset += cmdLen;

            OnRawMessage?.Invoke($"msgType={msgType} len={cmdLen}", data);

            try {
                var reader = new Protocol18Reader(data);
                switch (msgType) {
                    case msgRequest:
                        var req = Protocol18Deserializer.DeserializeOperationRequest(reader);
                        if (req != null) {
                            EventProcessor.PostProcessRequest(req);
                            OnRequest?.Invoke(req);
                        }
                        break;
                    case msgResponse:
                    case msgResponseAlt:
                        var resp = Protocol18Deserializer.DeserializeOperationResponse(reader);
                        if (resp != null) {
                            EventProcessor.PostProcessResponse(resp);
                            OnResponse?.Invoke(resp);
                        }
                        break;
                    case msgEvent:
                        var ev = Protocol18Deserializer.DeserializeEventData(reader);
                        if (ev != null) {
                            // `from` is the per-invocation parameter, race-free.
                            EventProcessor.PostProcessEvent(ev, from);
                            OnEvent?.Invoke(ev, from);
                        }
                        break;
                    case msgEncrypted:
                        OnEncryptedMessage?.Invoke(msgType, data);
                        break;
                }
            }
            catch (Exception ex) {
                OnParseError?.Invoke($"HandleSendReliable msgType={msgType}: {ex.Message}\n{ex.StackTrace}", cmdLen);
            }
            return offset;
        }

        private int HandleSendFragment(byte[] src, int offset, int cmdLen, string from) {
            if (cmdLen < fragmentHeaderLength || !Available(src, offset, fragmentHeaderLength)) return offset + cmdLen;

            uint startSeq = BinaryPrimitives.ReadUInt32BigEndian(src.AsSpan(offset));
            offset += 4;
            cmdLen -= 4;
            offset += 4;
            cmdLen -= 4;
            offset += 4;
            cmdLen -= 4;
            int totalLen = (int)BinaryPrimitives.ReadUInt32BigEndian(src.AsSpan(offset));
            offset += 4;
            cmdLen -= 4;
            int fragOffset = (int)BinaryPrimitives.ReadUInt32BigEndian(src.AsSpan(offset));
            offset += 4;
            cmdLen -= 4;

            int fragLen = cmdLen;
            if (fragLen < 0 || !Available(src, offset, fragLen) || totalLen < 0 || totalLen > PhotonTypes.maxArraySize * 16) {
                return offset + fragLen;
            }

            if (!_pendingSegments.TryGetValue(startSeq, out var seg)) {
                EvictIfFull();
                seg = new SegmentedPackage {
                    TotalLength = totalLen,
                    Payload = new byte[totalLen],
                    CreatedAt = DateTime.UtcNow,
                    SeenOffsets = new HashSet<int>()
                };
                _pendingSegments[startSeq] = seg;
            }

            int end = fragOffset + fragLen;
            if (!seg.SeenOffsets.Contains(fragOffset) && fragOffset >= 0 && end <= seg.Payload.Length) {
                Buffer.BlockCopy(src, offset, seg.Payload, fragOffset, fragLen);
                seg.BytesWritten += fragLen;
                seg.SeenOffsets.Add(fragOffset);
            }
            offset += fragLen;

            if (seg.BytesWritten >= seg.TotalLength) {
                _pendingSegments.Remove(startSeq);
                HandleSendReliable(seg.Payload, 0, seg.Payload.Length, from);  // pass `from` through
            }
            return offset;
        }

        private void EvictIfFull() {
            if (_pendingSegments.Count < maxPendingSegments) return;
            uint oldestKey = 0;
            DateTime oldestTime = DateTime.MaxValue;
            bool first = true;

            foreach (var kvp in _pendingSegments) {
                if (first || kvp.Value.CreatedAt < oldestTime) {
                    oldestKey = kvp.Key;
                    oldestTime = kvp.Value.CreatedAt;
                    first = false;
                }
            }
            _pendingSegments.Remove(oldestKey);
        }

        private static bool Available(byte[] src, int offset, int count) =>
            count >= 0 && offset >= 0 && (src.Length - offset) >= count;
    }
}
