# KeySync (EventCode 598) — Photon Salt Extraction

**Date:** 2026-07-07
**Status:** Hook written, syntax-checked, ready to run in live client
**Project:** `D:\AOR_core` (this repo) + `D:\AOR ubu\` (Albion IL2CPP dump)
**Hook file:** `Frida/hook_dispatch_photon.js`

---

## TL;DR (60 seconds)

- **KeySync (EventCode 598)** is a Photon event sent by the server that carries an **8-byte salt**.
- That salt, combined with the **session key** (from the connect handshake), is the input to a KDF that produces the **AES key** used to encrypt subsequent packets.
- Encrypted payloads include: **player movement coordinates**, **dungeon map layouts**, and other selected game state.
- This hook captures the dispatcher call for KeySync and dumps the 8-byte salt from `cwt.Parameters`.
- Next step (not yet implemented): hook the handshake to capture the **session key**, then implement the KDF + AES decrypt to read movement/dungeon payloads in clear.

---

## Architecture (what we mapped in this session)

### 1. Photon packet pipeline (from raw UDP to handler)

```
[UDP bytes]                                  (Photon.PeerBase, C++ side)
   ↓
[IPhotonPeerListener.OnEvent(gyz data)]      (Unity IL2CPP bridge layer)
   ↓
[<Listener>.af(EventCodes code, cwt data)]   ← RVA 0x36BCBF0, SLOT 16, KEY DISPATCHER
   ↓ aem[code]?.Invoke(data)                  aem = Dictionary<EventCodes, cwt> @ offset 0x158
[handler(cwt data)]                          (specific event handler, e.g. MoveHandler)
```

### 2. PhotonRegistry class — `ce1` (TypeDefIndex 16970)

Static class with the type→code maps (populated at startup):

```csharp
public class ce1  // all [ThreadStatic] static fields
{
    private static Dictionary<OperationCodes, Type>      a;  // 0x80000000
    private static Dictionary<OperationCodes, List<Type>> b;  // 0x80000008
    private static Dictionary<EventCodes,      Type>      c;  // 0x80000010  ← events, single type
    private static Dictionary<EventCodes,      List<Type>> d;  // 0x80000018  ← events, list of types
    private static Dictionary<Type, short>               e;  // 0x80000020  (Type → OpCode, reverse)
    private static Dictionary<Type, short>               f;  // 0x80000028  (Type → EventCode, reverse)
    private static MethodInfo g, h;                            // 0x80000030, 0x80000038
    public  static List<string> i;                             // 0x80000040
}
```

`ce1.c[598]` / `ce1.d[598]` → the C# class that handles KeySync packets.

### 3. Photon event code obfuscation map

From `Stas.OpenRadar/EventCode.cs` and AOdump.cs:

| Token (dump) | Real type | Notes |
|---|---|---|
| `gyx` | `OperationResponse` | obfuscated Photon class |
| `gyz` | `PhotonEvent` (EventData wrapper) | obfuscated Photon class |
| `goa` | `EventData` | another obfuscated alias |
| `EventCodes` | `EventCodes` (enum) | used by the new dispatcher at RVA 0x36BCBF0 |
| `cwt` | `EventData` (the new class) | parameter type of the new dispatcher |
| `cev` | interface | abstract Photon listener |
| `cf4.ail` | FactionFortress-specific dispatcher | old, RVA 0x361F1F0, slot 16 |
| `ce1.c / d` | PhotonRegistry | static, type→code maps |

### 4. Key event codes (from `Stas.OpenRadar/EventCode.cs`)

```csharp
public enum Events : short {
    Unknown = 0,
    Leave = 1,
    JoinFinished = 2,
    Move = 3,             // player movement (encrypted)
    Teleport = 4,
    ChangeEquipment = 5,
    // ... ~595 more ...
    BotCommand = 595,
    JournalAchievementProgressUpdate = 596,
    JournalClaimableRewardUpdate = 597,
    KeySync = 598,        // ← THE FOCUS
    LocalQuestAreaGone = 599,
    // ... continues to 683
    NotifyPlatformAccountConfirmed,
}
```

**KeySync = 598** (not 595 as in older Photon docs — Albion uses 598 in this build).

---

## The hook (`Frida/hook_dispatch_photon.js`)

### What it does

1. **At startup** (via `dumpCe1Registry()`):
   - Finds `ce1` class in Assembly-CSharp
   - Reads static fields `a/b/c/d` (the 4 forward maps)
   - For each, walks `_entries[0.._count)` (3 fallback strategies if bridge API differs)
   - **FOCUS MODE**: only prints the entry for `code === 598`:
     ```
     [*] ce1.c (Dictionary<EventCodes,Type>): N entries (FOCUS: only KeySync=598)
        >>> KeySync handler  code=598  →  <handler class name>
     ```
2. **At every dispatcher call** (`af(EventCodes, cwt)` at RVA `0x36BCBF0`):
   - Reads `args[1].toInt32()` → the event code
   - If `code === 598` (KeySync): logs `[KeySync #N]` and calls `extractKeySyncSalt(args[2])`
   - Other codes are counted in `totalDispatcherHits` but logged silently
3. **In `extractKeySyncSalt(evObj)`**:
   - Walks `evObj.class.field('Parameters')` → Dictionary
   - Iterates `_entries[0.._count)`
   - For each entry:
     - If `Byte[]` length 8 → logs `[SALT] key=K bytes=3a8f12bc45de6701` (THIS IS THE SALT)
     - If `String` / `Int` / `Boolean` → logs `[SALT-DBG] key=K Type=...` (debug aid)
4. **After 180 s watchdog**:
   - Dumps correlation table (only relevant for general event codes, not KeySync-specific)
   - Prints summary: dispatcher calls, KeySync calls, handler calls

### Critical RVA + signature

```js
// af(EventCodes A_0, cwt A_1)  ← RVA: 0x36BCBF0
// args[0] = this, args[1] = EventCodes (event code), args[2] = cwt (event data)
const DISPATCHER_RVA  = 0x36BCBF0;
const KEYSYNC_CODE    = 598;
```

### How to run

```bash
echo 31271 | sudo -S frida -p 4416 --runtime=v8 \
  -l /usr/local/lib/node_modules/frida-il2cpp-bridge/dist/index.js \
  -l /mnt/hgfs/D/AOR_core/Frida/hook_dispatch_photon.js
```

### Expected output (after 5-10 min of gameplay, entering a cluster)

```
[*] GameAssembly.so base = 0x...
[*] === HOOK_DISPATCH_PHOTON (FOCUS: only KeySync=598) ===

[*] ce1 found (TypeDefIndex=16970, instanceSize=?)
[*] ce1.c (Dictionary<EventCodes,Type>): 412 entries (FOCUS: only KeySync=598)
   >>> KeySync handler  code=598  →  <some class name>
[*] ce1.d (Dictionary<EventCodes,List<Type>>): 12 entries (FOCUS: only KeySync=598)
   (no entry for code=598 in this dict)
[*] ce1.a (Dictionary<OperationCodes,Type>): 287 entries (FOCUS: only KeySync=598)
   (no entry for code=598 in this dict)            ← KeySync is Event, not Operation
[*] ce1.b (Dictionary<OperationCodes,List<Type>>): 5 entries (FOCUS: only KeySync=598)
   (no entry for code=598 in this dict)

[KeySync #1]  af(EventCodes, cwt)  code=598   totalDispatcher=147
   [SALT] key=252  len=8  bytes=3a8f12bc45de6701

[KeySync #2]  af(EventCodes, cwt)  code=598   totalDispatcher=152
   [SALT] key=252  len=8  bytes=9d2c47ee01ab5688
...

Summary:
  total dispatcher calls   : 153
  total KeySync (598) calls: 2
  total handler calls      : 0
  unique codes correlated  : 0
```

If `[SALT]` doesn't appear but `[SALT-DBG]` does, send me the `[SALT-DBG]` output — I'll reconfigure the key/length heuristics.

---

## What's NOT done yet (next steps, in priority order)

### Step 2: Hook encrypted packets (PhotonParser flags==1)

The `OnEncryptedPacket` callback in `PhotonParser.cs` fires for `flags==1` payloads. Need to:
- Hook the same dispatcher at RVA 0x36BCBF0 (or a wrapper) to also dump `flags==1` payloads
- Decrypt using final AES key (from step 3) + IV (typically the first 16 bytes of payload)
- Parse decrypted content as Photon EventData/OperationResponse
- Extract movement coordinates, dungeon layouts

### Step 5: Live radar / web panel

Once movement is decrypted, plug into the existing `radar_server/` (C#) or build a new pipeline:
- Real-time player positions on map
- Dungeon layout visualizer
- Probably needs rewrite of `aor_web/` or a new module

---

## Key files in this session

| Path | Purpose |
|---|---|
| `Frida/hook_dispatch_photon.js` | **Main hook** (this file) — dispatcher + salt extraction |
| `Stas.OpenRadar/EventCode.cs` | EventCodes enum (KeySync = 598) |
| `Stas.OpenRadar/Operations.cs` | OperationCodes enum (Login = 5, etc.) |
| `Stas.OpenRadar/EventProcessor.cs` | PostProcessEvent/Request/Response pipeline |
| `Stas.OpenRadar/PhotonParser.cs` | PhotonParser class — deserializes bytes → EventData/Request/Response |
| `Stas.OpenRadar/Photon/PhotonParser.cs` | Same PhotonParser in `Photon/` subfolder (used by sniffer) |
| `Stas.OpenRadar/Photon/EventProcessor.cs` | Same, with ExtractMovePositions for Move event (code 3) |
| `/mnt/hgfs/D/AOR ubu/AOdump.cs` | IL2CPP dump (39 MB) — source of RVA + class info |
| `/mnt/hgfs/D/AOR ubu/JS/IDA_FindPlayerIdByGOM.js` | Reference frida script (player ID by GOM) |
| `/mnt/hgfs/D/AOR ubu/JS/IDA_FridaFindPlayerNameAndId.js` | Reference frida script (player name+ID by memory scan) |

## Key RVAs (for the current build)

| RVA | Class::Method | Notes |
|---|---|---|
| `0x36BCBF0` | `<Listener>.af(EventCodes, cwt)` | **Central Photon dispatcher** (current) |
| `0x361F1F0` | `cf4.ail(gyz, short)` | Old FactionFortress dispatcher (slot 16) — superseded |
| `0x27C55E4` | LoginClient.OnEvent | Stale RVA from older build — DO NOT USE |
| `0x3A50194..0x3A54A14` | cr0.ael#1/2, cr0.v#1/2, cr0.u#1/2, cr0.ahx#1/2 | Old handler RVAs — likely also stale |

## Bridge API note (frida-il2cpp-bridge)

The hook uses 3 fallback strategies to enumerate `Dictionary<TKey, TValue>`:
1. `dict.entries()` iterator (newer bridge)
2. `_entries[0.._count)` walk using bridge field access
3. `_buckets + _entries` next-chain walk (low-level hash map traversal)

If one of them throws, the next is tried. This makes the hook robust across bridge versions.

---

## Open questions for next session

1. What's the actual handler class name for KeySync (output of `ce1.c[598]`)? Need to run hook once.
2. What's the exact key (number) in `cwt.Parameters` for the salt? Usually 252 (per Photon protocol) but Albion may differ.
3. What's the KDF? Need to find the AES key derivation in GameAssembly.so.
4. What's the AES mode and IV? Photon typically uses AES-256-CTR with IV = first 16 bytes of payload.
5. **Where exactly does `IPhotonPeerListener.OnOperationResponse` get called in this build (RVA)?** → **RESOLVED 2026-07-08 R23:** it is `cr0.ahx` (RVA 0x19E9228 / alt 0x03A54994), args = (this, gyx OperationResponse, short opCode). See **`STATUS_R23.md`** for full OperationResponse capture + ReadClusterData/GetDange pipeline + collision-map architecture.

---

## History

- 2026-07-07: First session — mapped full Photon architecture (ce1, af, aem, cf4.ail), wrote initial hook with FOCUS on KeySync=598, added salt extraction. Hook syntax-checked OK, ready to run.

---

## Decryption algorithm — CRITICAL (from user's source code)

**The "encryption" is NOT AES, NOT KDF — it's just byte-level XOR with the 8-byte salt from KeySync.** No session key involved.

### Source (user-pasted, from Stas.AOR project)

```csharp
void Decode() {
    var epba = Decrypt(pos_ba);                    // pos_ba = 8 bytes: X[4] + Y[4]
    pos = new V2(epba[0], epba[1]);
    var enpba = Decrypt(new_pos_ba);
    new_pos = new V2(enpba[0], enpba[1]);
}

internal static float[] Decrypt(byte[] coordinates, int offset = 0) {
    if (ui.pos_code == null) {
        // Pre-KeySync: no encryption, raw little-endian floats
        return new[] { BitConverter.ToSingle(coordinates, offset), 
                       BitConverter.ToSingle(coordinates, offset + 4) };
    }

    var x = coordinates.Skip(offset).Take(4).ToArray();
    var y = coordinates.Skip(offset + 4).Take(4).ToArray();

    Decrypt(x, ui.pos_code, 0);   // X: XOR with salt[0..3]
    Decrypt(y, ui.pos_code, 4);   // Y: XOR with salt[4..7]

    return new[] { BitConverter.ToSingle(x, 0), BitConverter.ToSingle(y, 0) };
}

static void Decrypt(byte[] bytes4, byte[] saltBytes8, int saltPos) {
    for (var i = 0; i < bytes4.Length; i++) {
        var saltIndex = i % (saltBytes8.Length - saltPos) + saltPos;
        bytes4[i] ^= saltBytes8[saltIndex];
    }
}
```

### Algorithm in plain terms

For position packet (8 bytes = X[4] + Y[4]):

| bytes | XOR with | formula |
|---|---|---|
| `pos[0..3]` (X) | `salt[0..3]` | `pos[i] ^= salt[i]` for i=0..3 |
| `pos[4..7]` (Y) | `salt[4..7]` | `pos[i] ^= salt[i]` for i=4..7 |

After XOR, interpret each 4-byte block as a **little-endian IEEE 754 float** to get world coordinates.

`ui.pos_code` = the 8-byte salt from the latest KeySync event (598), stored in the UI singleton.

**Before first KeySync** (`pos_code == null`): no encryption, positions are raw little-endian floats.

### Implications

1. **NO session key, NO KDF, NO AES** — pure XOR
2. **Per-cluster salt** — `pos_code` is set on every KeySync event (every ~10 sec)
3. **Pure offline decryption is trivial** — just XOR, no need for frida inject
4. **See `tools/decrypt_positions.py`** for a working implementation

### Where position bytes live in the Move event (code 3)

From `Stas.OpenRadar/EventProcessor.cs`:

```csharp
private static void ExtractMovePositions(Dictionary<byte, object> paramsTable) {
    if (!paramsTable.TryGetValue(1, out var rawObj) || !(rawObj is byte[] raw) || raw.Length < 17)
        return;
    float x = BitConverter.ToSingle(raw, 9);   // X at offset 9, 4 bytes, little-endian
    float y = BitConverter.ToSingle(raw, 13);  // Y at offset 13, 4 bytes, little-endian
    ...
}
```

So in the Move event payload, **parameter key 1 is a byte[] (length >= 17)**, and the encrypted position bytes are at **offsets 9-12 (X) and 13-16 (Y)**.
