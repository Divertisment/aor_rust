using System;
using System.Text;

namespace Stas.AOR;

public class Protocol18Reader {
    readonly byte[] _buf;
    int _pos;

    public Protocol18Reader(byte[] buf) {
        _buf = buf;
        _pos = 0;
    }

    public int Position => _pos;
    public int Length => _buf.Length;
    public bool CanRead => _pos < _buf.Length;

    public byte ReadByte() {
        if (_pos >= _buf.Length) return 0;
        return _buf[_pos++];
    }

    public int ReadInt16LE() {
        if (_pos + 2 > _buf.Length) return 0;
        int v = _buf[_pos] | (_buf[_pos + 1] << 8);
        _pos += 2;
        return (short)v;
    }

    public int ReadInt32LE() {
        if (_pos + 4 > _buf.Length) return 0;
        int v = _buf[_pos] | (_buf[_pos + 1] << 8) | (_buf[_pos + 2] << 16) | (_buf[_pos + 3] << 24);
        _pos += 4;
        return v;
    }

    public long ReadInt64LE() {
        if (_pos + 8 > _buf.Length) return 0;
        long v = (long)_buf[_pos] | ((long)_buf[_pos + 1] << 8) | ((long)_buf[_pos + 2] << 16) | ((long)_buf[_pos + 3] << 24)
                | ((long)_buf[_pos + 4] << 32) | ((long)_buf[_pos + 5] << 40) | ((long)_buf[_pos + 6] << 48) | ((long)_buf[_pos + 7] << 56);
        _pos += 8;
        return v;
    }

    public float ReadFloatLE() {
        if (_pos + 4 > _buf.Length) return 0f;
        float v = BitConverter.ToSingle(_buf, _pos);
        _pos += 4;
        return v;
    }

    public double ReadDoubleLE() {
        if (_pos + 8 > _buf.Length) return 0d;
        double v = BitConverter.ToDouble(_buf, _pos);
        _pos += 8;
        return v;
    }

    public uint ReadVarintUInt32() {
        uint value = 0;
        int shift = 0;
        while (true) {
            byte b = ReadByte();
            value |= (uint)(b & 0x7F) << shift;
            if ((b & 0x80) == 0) return value;
            shift += 7;
            if (shift >= 35) return 0;
        }
    }

    public int ReadVarintInt32() {
        uint v = ReadVarintUInt32();
        return (int)((v >> 1) ^ (uint)(-(int)(v & 1)));
    }

    public long ReadVarintInt64() {
        ulong v = 0;
        int shift = 0;
        while (true) {
            byte b = ReadByte();
            v |= (ulong)(b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
            if (shift >= 70) return 0;
        }
        return (long)((v >> 1) ^ (ulong)(-(long)(v & 1)));
    }

    public byte[] ReadBytes(int count) {
        if (count <= 0 || _pos + count > _buf.Length) return [];
        var result = new byte[count];
        Buffer.BlockCopy(_buf, _pos, result, 0, count);
        _pos += count;
        return result;
    }

    public string ReadString() {
        int len = (int)ReadVarintUInt32();
        if (len <= 0 || _pos + len > _buf.Length) return "";
        string s = Encoding.UTF8.GetString(_buf, _pos, len);
        _pos += len;
        return s;
    }
}
