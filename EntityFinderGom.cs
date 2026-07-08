using System;
using System.Collections.Generic;

namespace AorScanner;

/// <summary>
/// GameObjectManager-based entity scanner. Reads game memory through
/// <see cref="MemoryReader"/> (process_vm_readv on Linux).
///
/// Pointer geometry (Unity 6 / IL2CPP, intrusive doubly-linked list):
///
///     UnityPlayer.so + 0x20EAAC0  s_Instance        (BSS pointer; dereference once)
///       │
///       ▼  *(s_Instance)
///     GameObjectManager
///       │+0x18 ──► startNode                        (POINTER to head node — dereference!)
///       │
///     Node                                          (intrusive member inside GameObject)
///       │+0x00 next | +0x08 prev
///       │−0x68 ──► GameObject                       (Node stored at GameObject +0x68)
///       │
///       +0x10  int    m_InstanceID
///       +0xF0  float  X
///       +0xF4  float  Y
///       +0xF8  float  Z
///
/// Returns an <see cref="Entity"/>[] ready to drop into Program.cs. The class is
/// allocation-free in the hot loop: one stack buffer, one List, one ToArray.
/// </summary>
public static class EntityFinderGom
{
    // Offsets verified against IDA .bss symbol
    //   s_Instance : _ZN17GameObjectManager10s_InstanceE @ UnityPlayer.so + 0x20EAAC0
    const string ModuleName   = "UnityPlayer.so";
    const ulong  SInstanceOff = 0x20EAAC0;
    const int    StartNodeOff  = 0x18;        // GOM + 0x18 is a POINTER to head node

    const int    NodeNextOff   = 0x00;        // Cheat Engine: next at +0x00
    const int    NodePrevOff   = 0x08;        //               prev at +0x08
    const int    NodeToGoOff   = 0x68;        // GameObject = node - 0x68

    const int    GoIdOff       = 0x10;
    const int    GoXOff        = 0xF0;
    const int    GoYOff        = 0xF4;
    const int    GoZOff        = 0xF8;

    const int    MaxEntities   = 1024;
    const int    MaxNodes      = 1 << 16;     // 65 536 iteration cap (anti-runaway)

    const float  CoordAbsMin   = 3f;          // uninitialized-float ghost guard
    const float  CoordAbsMax   = 500f;        // world boundary ceiling

    /// <summary>Snapshot of all GameObjects currently registered in the GOM
    /// intrusive list that pass the world-coordinate sanity check.</summary>
    public static Entity[] Find(int pid)
    {
        ulong baseAddr = MemoryReader.GetModuleBase(pid, ModuleName);
        if (baseAddr == 0) return Array.Empty<Entity>();

        // s_Instance is itself a pointer; dereference once to reach the GOM instance.
        ulong gom = MemoryReader.ReadU64(pid, baseAddr + SInstanceOff);
        if (gom == 0) return Array.Empty<Entity>();

        // GOM + 0x18 is a POINTER to the head node, not the head node itself.
        ulong startNode = MemoryReader.ReadU64(pid, gom + (ulong)StartNodeOff);
        if (startNode == 0) return Array.Empty<Entity>();

        var list = new List<Entity>(MaxEntities);

        // ONE stackalloc outside the loop (AOT / .NET 10 friendly: no CA2014,
        // no per-iteration stack-frame growth). Reused for every entity read:
        //   id(4) + X(4) + Y(4) + Z(4) — 16 bytes total.
        Span<byte> buf = stackalloc byte[16];

        ulong node = startNode;

        for (int i = 0; i < MaxNodes; i++)
        {
            // Halt when we have looped back to the head node (circular list end).
            if (i > 0 && node == startNode) break;
            // Halt on self-loop or null term.
            if (node == 0) break;

            // Reject addresses that would underflow when subtracting 0x68, or
            // that point outside user-mapped memory.
            if (node >= (ulong)NodeToGoOff + 0x10000)
            {
                ulong go = node - (ulong)NodeToGoOff;

                // Batch read id + XYZ as a single 16-byte syscall. On failure
                // we SKIP the entity (no zero-fill, no (0,0,0) false positive).
                if (MemoryReader.Read(pid, go + (ulong)GoIdOff, buf))
                {
                    int   id = BitConverter.ToInt32(buf.Slice(0, 4));
                    float x  = BitConverter.ToSingle(buf.Slice(4, 4));
                    float y  = BitConverter.ToSingle(buf.Slice(8, 4));
                    float z  = BitConverter.ToSingle(buf.Slice(12, 4));

                    // NaN check guards against partially-mapped pages leaking
                    // through as (0,0,0) entities.
                    if (!float.IsNaN(x) && !float.IsNaN(y) && IsWorldCoord(x, y))
                    {
                        list.Add(new Entity { Id = id, X = x, Y = y, Z = z });
                        if (list.Count >= MaxEntities) break;
                    }
                }
            }

            // Advance to next node; if the list is a closed cycle we will
            // return to startNode and the loop-start guard above will exit.
            ulong next = MemoryReader.ReadU64(pid, node + (ulong)NodeNextOff);
            if (next == 0 || next == node) break;
            node = next;
        }
        return list.ToArray();
    }

    static bool IsWorldCoord(float x, float y)
    {
        float ax = MathF.Abs(x);
        float ay = MathF.Abs(y);
        return ax >= CoordAbsMin && ax <= CoordAbsMax
            && ay >= CoordAbsMin && ay <= CoordAbsMax;
    }
}
