namespace Stas.AOR;

public static class Protocol18Deserializer {
    public static object Deserialize(Protocol18Reader r) {
        if (!r.CanRead) return null;
        byte tc = r.ReadByte();
        return Deserialize(r, tc);
    }

    public static object Deserialize(Protocol18Reader r, byte typeCode) {
        switch ((Protocol18Type)typeCode) {
            case Protocol18Type.Unknown:
            case Protocol18Type.Null:
                return null;

            case Protocol18Type.Boolean:
                return r.ReadByte() != 0;

            case Protocol18Type.Byte:
                return r.ReadByte();

            case Protocol18Type.Short:
                return (short)r.ReadInt16LE();

            case Protocol18Type.Float:
                return r.ReadFloatLE();

            case Protocol18Type.Double:
                return r.ReadDoubleLE();

            case Protocol18Type.String:
                return r.ReadString();

            case Protocol18Type.CompressedInt:
                return r.ReadVarintInt32();

            case Protocol18Type.CompressedLong:
                return r.ReadVarintInt64();

            case Protocol18Type.BytePositive:
                return (int)r.ReadByte();

            case Protocol18Type.ByteNegative:
                return -(int)r.ReadByte();

            case Protocol18Type.ShortPositive:
                return (int)(r.ReadByte() | (r.ReadByte() << 8));

            case Protocol18Type.ShortNegative:
                return -(int)(r.ReadByte() | (r.ReadByte() << 8));

            case Protocol18Type.LongBytePositive:
                return (long)r.ReadByte();

            case Protocol18Type.LongByteNegative:
                return -(long)r.ReadByte();

            case Protocol18Type.LongShortPositive:
                return (long)(r.ReadByte() | (r.ReadByte() << 8));

            case Protocol18Type.LongShortNegative:
                return -(long)(r.ReadByte() | (r.ReadByte() << 8));

            case Protocol18Type.BooleanFalse:
                return false;

            case Protocol18Type.BooleanTrue:
                return true;

            case Protocol18Type.ShortZero:
                return (short)0;

            case Protocol18Type.IntZero:
                return 0;

            case Protocol18Type.LongZero:
                return (long)0;

            case Protocol18Type.FloatZero:
                return 0f;

            case Protocol18Type.DoubleZero:
                return 0d;

            case Protocol18Type.ByteZero:
                return (byte)0;

            case Protocol18Type.Custom:
                if (!r.CanRead) return null;
                r.ReadByte();
                return DeserializeCustomSlim(r);

            case Protocol18Type.CustomSlim:
                return DeserializeCustomSlim(r);

            case Protocol18Type.Dictionary:
            case Protocol18Type.Hashtable:
                return DeserializeHashtable(r);

            case Protocol18Type.ObjectArray:
                return DeserializeObjectArray(r);

            case Protocol18Type.OperationRequest:
                return DeserializeOperationRequest(r);

            case Protocol18Type.OperationResponse:
                return DeserializeOperationResponse(r);

            case Protocol18Type.EventData:
                return DeserializeEventData(r);

            case Protocol18Type.Array:
                return DeserializeArray(r);

            case Protocol18Type.BooleanArray:
                return DeserializeBooleanArray(r);

            case Protocol18Type.ByteArray:
                return DeserializeByteArray(r);

            case Protocol18Type.ShortArray:
                return DeserializeShortArray(r);

            case Protocol18Type.FloatArray:
                return DeserializeFloatArray(r);

            case Protocol18Type.DoubleArray:
                return DeserializeDoubleArray(r);

            case Protocol18Type.StringArray:
                return DeserializeStringArray(r);

            case Protocol18Type.CompressedIntArray:
                return DeserializeCompressedIntArray(r);

            case Protocol18Type.CompressedLongArray:
                return DeserializeCompressedLongArray(r);

            case Protocol18Type.CustomArray:
                return DeserializeCustomArray(r);

            case Protocol18Type.DictionaryArray:
                return DeserializeDictionaryArray(r);

            case Protocol18Type.HashtableArray:
                return DeserializeHashtableArray(r);

            default:
                if ((typeCode & 0x40) == 0x40)
                    return DeserializeTypedArray(r, (byte)(typeCode & ~0x40));
                return null;
        }
    }

    static byte[] DeserializeCustomSlim(Protocol18Reader r) {
        if (!r.CanRead) return null;
        int size = (int)r.ReadVarintUInt32();
        if (size < 0 || size > r.Length - r.Position || size > PhotonTypes.maxArraySize) return null;
        return r.ReadBytes(size);
    }

    static Dictionary<object, object> DeserializeHashtable(Protocol18Reader r) {
        if (!r.CanRead) return null;
        byte keyTC = r.ReadByte();
        if (!r.CanRead) return null;
        byte valTC = r.ReadByte();
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;

        var result = new Dictionary<object, object>(count);
        for (int i = 0; i < count && r.CanRead; i++) {
            byte kt = keyTC == 0 ? r.ReadByte() : keyTC;
            byte vt = valTC == 0 ? r.ReadByte() : valTC;

            object key = Deserialize(r, kt);
            object val = Deserialize(r, vt);

            if (key != null && (key.GetType().IsPrimitive || key is string))
                result[key] = val;
            else
                result[$"key_{i}_{key?.GetType().Name}"] = val;
        }
        return result;
    }

    static object[] DeserializeObjectArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        var result = new object[count];
        for (int i = 0; i < count && r.CanRead; i++)
            result[i] = Deserialize(r);
        return result;
    }

    static Array DeserializeArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        object[] result = new object[count];
        for (int i = 0; i < count && r.CanRead; i++) {
            byte tc = r.ReadByte();
            result[i] = Deserialize(r, tc);
        }
        return result;
    }

    static bool[] DeserializeBooleanArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        int packedBytes = (count + 7) / 8;
        byte[] packed = r.ReadBytes(packedBytes);
        if (packed.Length == 0 && count > 0) return null;
        bool[] result = new bool[count];
        for (int i = 0; i < count; i++)
            result[i] = (packed[i / 8] & (1 << (i % 8))) != 0;
        return result;
    }

    static byte[] DeserializeByteArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        return count > PhotonTypes.maxArraySize ? [] : r.ReadBytes(count);
    }

    static short[] DeserializeShortArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        short[] result = new short[count];
        for (int i = 0; i < count; i++)
            result[i] = (short)r.ReadInt16LE();
        return result;
    }

    static float[] DeserializeFloatArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        float[] result = new float[count];
        for (int i = 0; i < count; i++)
            result[i] = r.ReadFloatLE();
        return result;
    }

    static double[] DeserializeDoubleArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        double[] result = new double[count];
        for (int i = 0; i < count; i++)
            result[i] = r.ReadDoubleLE();
        return result;
    }

    static string[] DeserializeStringArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        string[] result = new string[count];
        for (int i = 0; i < count; i++)
            result[i] = r.ReadString();
        return result;
    }

    static int[] DeserializeCompressedIntArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        int[] result = new int[count];
        for (int i = 0; i < count; i++)
            result[i] = r.ReadVarintInt32();
        return result;
    }

    static long[] DeserializeCompressedLongArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        long[] result = new long[count];
        for (int i = 0; i < count; i++)
            result[i] = r.ReadVarintInt64();
        return result;
    }

    static object[] DeserializeTypedArray(Protocol18Reader r, byte elemType) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        object[] result = new object[count];
        for (int i = 0; i < count; i++)
            result[i] = Deserialize(r, elemType);
        return result;
    }

    static byte[][] DeserializeCustomArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        if (!r.CanRead) return null;
        r.ReadByte();
        var result = new byte[count][];
        for (int i = 0; i < count; i++) {
            if (!r.CanRead) break;
            int size = (int)r.ReadVarintUInt32();
            if (size < 0 || size > r.Length - r.Position || size > PhotonTypes.maxArraySize) break;
            result[i] = r.ReadBytes(size);
        }
        return result;
    }

    static Dictionary<object, object>[] DeserializeDictionaryArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        var result = new Dictionary<object, object>[count];
        for (int i = 0; i < count; i++)
            result[i] = DeserializeHashtable(r);
        return result;
    }

    static Dictionary<object, object>[] DeserializeHashtableArray(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return null;
        var result = new Dictionary<object, object>[count];
        for (int i = 0; i < count; i++)
            result[i] = DeserializeHashtable(r);
        return result;
    }

    public static EventData DeserializeEventData(Protocol18Reader r) {
        byte code = r.ReadByte();
        var parameters = ReadParameterTable(r);
        return new EventData { Code = code, Parameters = parameters };
    }

    public static OperationRequest DeserializeOperationRequest(Protocol18Reader r) {
        byte opCode = r.ReadByte();
        var parameters = ReadParameterTable(r);
        return new OperationRequest { OperationCode = opCode, Parameters = parameters };
    }

    public static OperationResponse DeserializeOperationResponse(Protocol18Reader r) {
        byte opCode = r.ReadByte();
        short returnCode = (short)r.ReadInt16LE();
        string debugMsg = null;
        if (r.CanRead) {
            byte debugTC = r.ReadByte();
            debugMsg = Deserialize(r, debugTC) as string;
        }
        var parameters = ReadParameterTable(r);
        return new OperationResponse { OperationCode = opCode, ReturnCode = returnCode, DebugMessage = debugMsg, Parameters = parameters };
    }

    static Dictionary<byte, object> ReadParameterTable(Protocol18Reader r) {
        int count = (int)r.ReadVarintUInt32();
        if (count > PhotonTypes.maxArraySize) return [];
        var result = new Dictionary<byte, object>(count);
        for (int i = 0; i < count; i++) {
            if (!r.CanRead) break;
            byte key = r.ReadByte();
            byte tc = r.ReadByte();
            result[key] = Deserialize(r, tc);
        }
        return result;
    }
}
