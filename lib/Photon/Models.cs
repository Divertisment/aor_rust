using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Stas.AOR {
    public class EventData {
        public byte Code { get; set; }
        [JsonConverter(typeof(PhotonParameterTableConverter))]
        public Dictionary<byte, object> Parameters { get; set; }
    }

    public class OperationRequest {
        public byte OperationCode { get; set; }
        [JsonConverter(typeof(PhotonParameterTableConverter))]
        public Dictionary<byte, object> Parameters { get; set; }
    }

    public class OperationResponse {
        public byte OperationCode { get; set; }
        public short ReturnCode { get; set; }
        public string DebugMessage { get; set; }
        [JsonConverter(typeof(PhotonParameterTableConverter))]
        public Dictionary<byte, object> Parameters { get; set; }
    }

    public class HashtableJsonConverter : JsonConverter<Dictionary<object, object>> {
        public override Dictionary<object, object> Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o) => throw new NotImplementedException();
        public override void Write(Utf8JsonWriter writer, Dictionary<object, object> value, JsonSerializerOptions options) {
            writer.WriteStartObject();
            foreach (var kvp in value) {
                writer.WritePropertyName(kvp.Key?.ToString() ?? "null");
                JsonSerializer.Serialize(writer, kvp.Value, kvp.Value?.GetType() ?? typeof(object), options);
            }
            writer.WriteEndObject();
        }
    }

    public class ByteArrayJsonConverter : JsonConverter<byte[]> {
        public override byte[] Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o) => throw new NotImplementedException();
        public override void Write(Utf8JsonWriter writer, byte[] value, JsonSerializerOptions options) {
            if (value == null) { writer.WriteNullValue(); return; }
            writer.WriteStartObject();
            writer.WriteString("type", "Buffer");
            writer.WriteStartArray("data");
            foreach (byte b in value) writer.WriteNumberValue(b);
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
    }

    public class PhotonParameterTableConverter : JsonConverter<Dictionary<byte, object>> {
        public override Dictionary<byte, object> Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o) => throw new NotImplementedException();
        public override void Write(Utf8JsonWriter writer, Dictionary<byte, object> value, JsonSerializerOptions options) {
            writer.WriteStartObject();
            foreach (var kvp in value) {
                writer.WritePropertyName(kvp.Key.ToString());
                JsonSerializer.Serialize(writer, kvp.Value, kvp.Value?.GetType() ?? typeof(object), options);
            }
            writer.WriteEndObject();
        }
    }
}
