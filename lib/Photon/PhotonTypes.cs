namespace Stas.AOR {
    public static class PhotonTypes {
        public const byte typeUnknown = 0;
        public const byte typeBoolean = 2;
        public const byte typeByte = 3;
        public const byte typeShort = 4;
        public const byte typeFloat = 5;
        public const byte typeDouble = 6;
        public const byte typeString = 7;
        public const byte typeNull = 8;
        public const byte typeCompressedInt = 9;
        public const byte typeCompressedLong = 10;
        public const byte typeInt1 = 11;
        public const byte typeInt1Neg = 12;
        public const byte typeInt2 = 13;
        public const byte typeInt2Neg = 14;
        public const byte typeLong1 = 15;
        public const byte typeLong1Neg = 16;
        public const byte typeLong2 = 17;
        public const byte typeLong2Neg = 18;
        public const byte typeCustom = 19;
        public const byte typeDictionary = 20;
        public const byte typeHashtable = 21;
        public const byte typeObjectArray = 23;
        public const byte typeOperationRequest = 24;
        public const byte typeOperationResp = 25;
        public const byte typeEventData = 26;
        public const byte typeBoolFalse = 27;
        public const byte typeBoolTrue = 28;
        public const byte typeShortZero = 29;
        public const byte typeIntZero = 30;
        public const byte typeLongZero = 31;
        public const byte typeFloatZero = 32;
        public const byte typeDoubleZero = 33;
        public const byte typeByteZero = 34;
        public const byte typeArray = 0x40;
        public const byte customTypeSlimBase = 0x80;
        public const int maxArraySize = 65536;
    }

    public enum EventCodes : byte {
        Move = 3
    }
}
