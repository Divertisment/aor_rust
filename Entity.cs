namespace AorScanner;

public class Entity
{
    public int Id { get; set; }
    public float X { get; set; }
    public float Y { get; set; }
    public float Z { get; set; }
    public float Angle { get; set; }
    public int ComponentsCount { get; set; }
    public ulong GameObjectAddr { get; set; }
    public ulong Klass { get; set; }

    /// <summary>
    /// Filled by EntityListFinder. Empty when entity is considered real, otherwise
    /// a short tag describing why the entity was demoted (default-pos, small-id, NaN, …).
    /// </summary>
    public string GhostReason { get; set; } = "";

    /// <summary>True iff <see cref="GhostReason"/> is non-empty.</summary>
    public bool IsGhost => !string.IsNullOrEmpty(GhostReason);

    public string Type
    {
        get
        {
            if (IsPlayer) return "Player";
            if (IsEnemy) return "Enemy";
            if (IsNpc) return "NPC";
            return "Mob";
        }
    }

    public bool IsPlayer { get; set; }
    public bool IsEnemy { get; set; }
    public bool IsNpc { get; set; }

    public float DistanceTo(float px, float py) =>
        MathF.Sqrt((X - px) * (X - px) + (Y - py) * (Y - py));
}
