use std::collections::HashMap;

// ---- Type Constants ----
pub const TYPE_UNKNOWN: u8 = 0;
pub const TYPE_BOOLEAN: u8 = 2;
pub const TYPE_BYTE: u8 = 3;
pub const TYPE_SHORT: u8 = 4;
pub const TYPE_FLOAT: u8 = 5;
pub const TYPE_DOUBLE: u8 = 6;
pub const TYPE_STRING: u8 = 7;
pub const TYPE_NULL: u8 = 8;
pub const TYPE_COMPRESSED_INT: u8 = 9;
pub const TYPE_COMPRESSED_LONG: u8 = 10;
pub const TYPE_INT1: u8 = 11;
pub const TYPE_INT1_NEG: u8 = 12;
pub const TYPE_INT2: u8 = 13;
pub const TYPE_INT2_NEG: u8 = 14;
pub const TYPE_LONG1: u8 = 15;
pub const TYPE_LONG1_NEG: u8 = 16;
pub const TYPE_LONG2: u8 = 17;
pub const TYPE_LONG2_NEG: u8 = 18;
pub const TYPE_CUSTOM: u8 = 19;
pub const TYPE_DICTIONARY: u8 = 20;
pub const TYPE_HASHTABLE: u8 = 21;
pub const TYPE_OBJECT_ARRAY: u8 = 23;
pub const TYPE_OPERATION_REQUEST: u8 = 24;
pub const TYPE_OPERATION_RESP: u8 = 25;
pub const TYPE_EVENT_DATA: u8 = 26;
pub const TYPE_BOOL_FALSE: u8 = 27;
pub const TYPE_BOOL_TRUE: u8 = 28;
pub const TYPE_SHORT_ZERO: u8 = 29;
pub const TYPE_INT_ZERO: u8 = 30;
pub const TYPE_LONG_ZERO: u8 = 31;
pub const TYPE_FLOAT_ZERO: u8 = 32;
pub const TYPE_DOUBLE_ZERO: u8 = 33;
pub const TYPE_BYTE_ZERO: u8 = 34;
pub const TYPE_ARRAY: u8 = 0x40;
pub const CUSTOM_TYPE_SLIM_BASE: u8 = 0x80;
pub const MAX_ARRAY_SIZE: usize = 65536;

const PHOTON_HEADER_LEN: usize = 12;
const COMMAND_HEADER_LEN: usize = 12;
const FRAGMENT_HEADER_LEN: usize = 20;
const MAX_PENDING_SEGMENTS: usize = 64;

const CMD_DISCONNECT: u8 = 4;
const CMD_SEND_RELIABLE: u8 = 6;
const CMD_SEND_UNRELIABLE: u8 = 7;
const CMD_SEND_FRAGMENT: u8 = 8;

const MSG_REQUEST: u8 = 2;
const MSG_RESPONSE: u8 = 3;
const MSG_EVENT: u8 = 4;
const MSG_RESPONSE_ALT: u8 = 7;
const MSG_ENCRYPTED: u8 = 131;

// ---- Models ----
#[derive(Debug, Clone)]
pub struct EventData {
    pub code: u8,
    pub parameters: HashMap<u8, PhotonValue>,
}

#[derive(Debug, Clone)]
pub struct OperationRequest {
    pub operation_code: u8,
    pub parameters: HashMap<u8, PhotonValue>,
}

#[derive(Debug, Clone)]
pub struct OperationResponse {
    pub operation_code: u8,
    pub return_code: i16,
    pub debug_message: Option<String>,
    pub parameters: HashMap<u8, PhotonValue>,
}

#[derive(Debug, Clone)]
pub enum PhotonValue {
    Null,
    Boolean(bool),
    Byte(u8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(u32),
    Double(u64),
    String(String),
    Bytes(Vec<u8>),
    Array(Vec<PhotonValue>),
    BooleanArray(Vec<bool>),
    ShortArray(Vec<i16>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
    FloatArray(Vec<f32>),
    DoubleArray(Vec<f64>),
    StringArray(Vec<String>),
    Dictionary(HashMap<PhotonValue, PhotonValue>),
    ObjectArray(Vec<PhotonValue>),
}

impl PartialEq for PhotonValue {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (PhotonValue::Null, PhotonValue::Null) => true,
            (PhotonValue::Boolean(a), PhotonValue::Boolean(b)) => a == b,
            (PhotonValue::Byte(a), PhotonValue::Byte(b)) => a == b,
            (PhotonValue::Short(a), PhotonValue::Short(b)) => a == b,
            (PhotonValue::Int(a), PhotonValue::Int(b)) => a == b,
            (PhotonValue::Long(a), PhotonValue::Long(b)) => a == b,
            (PhotonValue::Float(a), PhotonValue::Float(b)) => a == b,
            (PhotonValue::Double(a), PhotonValue::Double(b)) => a == b,
            (PhotonValue::String(a), PhotonValue::String(b)) => a == b,
            (PhotonValue::Bytes(a), PhotonValue::Bytes(b)) => a == b,
            (PhotonValue::Array(a), PhotonValue::Array(b)) => a == b,
            (PhotonValue::BooleanArray(a), PhotonValue::BooleanArray(b)) => a == b,
            (PhotonValue::ShortArray(a), PhotonValue::ShortArray(b)) => a == b,
            (PhotonValue::IntArray(a), PhotonValue::IntArray(b)) => a == b,
            (PhotonValue::LongArray(a), PhotonValue::LongArray(b)) => a == b,
            (PhotonValue::FloatArray(a), PhotonValue::FloatArray(b)) => a == b,
            (PhotonValue::DoubleArray(a), PhotonValue::DoubleArray(b)) => a == b,
            (PhotonValue::StringArray(a), PhotonValue::StringArray(b)) => a == b,
            (PhotonValue::Dictionary(a), PhotonValue::Dictionary(b)) => a == b,
            (PhotonValue::ObjectArray(a), PhotonValue::ObjectArray(b)) => a == b,
            _ => false,
        }
    }
}

impl Eq for PhotonValue {}

impl std::hash::Hash for PhotonValue {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        std::mem::discriminant(self).hash(state);
        match self {
            PhotonValue::Null => {}
            PhotonValue::Boolean(v) => v.hash(state),
            PhotonValue::Byte(v) => v.hash(state),
            PhotonValue::Short(v) => v.hash(state),
            PhotonValue::Int(v) => v.hash(state),
            PhotonValue::Long(v) => v.hash(state),
            PhotonValue::Float(v) => v.hash(state),
            PhotonValue::Double(v) => v.hash(state),
            PhotonValue::String(v) => v.hash(state),
            PhotonValue::Bytes(v) => v.hash(state),
            PhotonValue::Array(v) => v.hash(state),
            PhotonValue::BooleanArray(v) => v.hash(state),
            PhotonValue::ShortArray(v) => v.hash(state),
            PhotonValue::IntArray(v) => v.hash(state),
            PhotonValue::LongArray(v) => v.hash(state),
            PhotonValue::FloatArray(v) => v.iter().for_each(|x| x.to_bits().hash(state)),
            PhotonValue::DoubleArray(v) => v.iter().for_each(|x| x.to_bits().hash(state)),
            PhotonValue::StringArray(v) => v.hash(state),
            PhotonValue::Dictionary(v) => {
                for (k, val) in v {
                    k.hash(state);
                    val.hash(state);
                }
            }
            PhotonValue::ObjectArray(v) => v.hash(state),
        }
    }
}

impl PhotonValue {
    pub fn as_f32(&self) -> Option<f32> {
        match self {
            PhotonValue::Float(v) => Some(f32::from_bits(*v)),
            PhotonValue::Int(v) => Some(*v as f32),
            PhotonValue::Short(v) => Some(*v as f32),
            PhotonValue::Byte(v) => Some(*v as f32),
            _ => None,
        }
    }
}

// ---- Fragment Reassembly ----
struct SegmentedPackage {
    total_length: usize,
    bytes_written: usize,
    payload: Vec<u8>,
    seen_offsets: std::collections::HashSet<usize>,
}

// ---- Photon Parser ----
pub struct PhotonParser {
    pending_segments: HashMap<u32, SegmentedPackage>,
    pub on_event: Option<Box<dyn FnMut(EventData)>>,
    pub on_request: Option<Box<dyn FnMut(OperationRequest)>>,
    pub on_response: Option<Box<dyn FnMut(OperationResponse)>>,
    pub on_encrypted: Option<Box<dyn FnMut()>>,
    pub on_parse_error: Option<Box<dyn FnMut(String, usize)>>,
}

impl PhotonParser {
    pub fn new() -> Self {
        PhotonParser {
            pending_segments: HashMap::new(),
            on_event: None,
            on_request: None,
            on_response: None,
            on_encrypted: None,
            on_parse_error: None,
        }
    }

    pub fn receive_packet(&mut self, payload: &[u8]) -> bool {
        if payload.len() < PHOTON_HEADER_LEN {
            self.fire_error("payload shorter than photon header".to_string(), payload.len());
            return false;
        }

        let mut offset = 2; // skip peerId
        let flags = payload[offset];
        offset += 1;
        let command_count = payload[offset] as usize;
        offset += 1;
        offset += 8; // skip timestamp + challenge

        if flags == 1 {
            self.fire_encrypted();
            return false;
        }

        for _ in 0..command_count {
            match self.handle_command(payload, offset) {
                Some((new_offset, true)) => offset = new_offset,
                Some((_, false)) => {
                    self.fire_error("handle_command failed".to_string(), payload.len());
                    return false;
                }
                None => return false,
            }
        }
        true
    }

    fn handle_command(&mut self, src: &[u8], offset: usize) -> Option<(usize, bool)> {
        if !available(src, offset, COMMAND_HEADER_LEN) {
            return Some((offset, false));
        }

        let cmd_type = src[offset];
        let offset = offset + 4; // skip cmdType, channelId, commandFlags, reserved

        if offset + 8 > src.len() {
            return Some((offset, false));
        }
        let cmd_len = u32::from_be_bytes([src[offset], src[offset + 1], src[offset + 2], src[offset + 3]]) as usize;
        let offset = offset + 8; // commandLength + reliableSequenceNumber

        let mut cmd_len = cmd_len.saturating_sub(COMMAND_HEADER_LEN);
        if !available(src, offset, cmd_len) {
            return Some((offset, false));
        }

        match cmd_type {
            CMD_DISCONNECT => Some((offset + cmd_len, true)),
            CMD_SEND_UNRELIABLE => {
                if cmd_len < 4 {
                    return Some((offset + cmd_len, false));
                }
                let skip = 4;
                cmd_len = cmd_len.saturating_sub(skip);
                let offset = offset + skip;
                Some((self.handle_send_reliable(src, offset, cmd_len), true))
            }
            CMD_SEND_RELIABLE => Some((self.handle_send_reliable(src, offset, cmd_len), true)),
            CMD_SEND_FRAGMENT => Some((self.handle_send_fragment(src, offset, cmd_len), true)),
            _ => Some((offset + cmd_len, true)),
        }
    }

    fn handle_send_reliable(&mut self, src: &[u8], offset: usize, cmd_len: usize) -> usize {
        if cmd_len < 2 || !available(src, offset, cmd_len) {
            return offset + cmd_len;
        }

        let offset = offset + 1; // skip signalByte
        let msg_type = src[offset];
        let offset = offset + 1;
        let cmd_len = cmd_len - 2;

        if !available(src, offset, cmd_len) {
            return offset + cmd_len;
        }

        if msg_type == MSG_ENCRYPTED {
            self.fire_encrypted();
            return offset + cmd_len;
        }

        let data = &src[offset..offset + cmd_len];
        let offset = offset + cmd_len;

        match msg_type {
            MSG_REQUEST => {
                if let Some(req) = deserialize_request(data) {
                    self.fire_request(req);
                }
            }
            MSG_RESPONSE | MSG_RESPONSE_ALT => {
                if let Some(resp) = deserialize_response(data) {
                    self.fire_response(resp);
                }
            }
            MSG_EVENT => {
                if let Some(ev) = deserialize_event(data) {
                    self.fire_event(ev);
                }
            }
            _ => {}
        }
        offset
    }

    fn handle_send_fragment(&mut self, src: &[u8], offset: usize, cmd_len: usize) -> usize {
        if cmd_len < FRAGMENT_HEADER_LEN || !available(src, offset, FRAGMENT_HEADER_LEN) {
            return offset + cmd_len;
        }

        let start_seq = u32::from_be_bytes([src[offset], src[offset + 1], src[offset + 2], src[offset + 3]]);
        let offset = offset + 4;
        let cmd_len = cmd_len - 4;
        let _fragment_count = u32::from_be_bytes([src[offset], src[offset + 1], src[offset + 2], src[offset + 3]]);
        let offset = offset + 4;
        let cmd_len = cmd_len - 4;
        let _fragment_number = u32::from_be_bytes([src[offset], src[offset + 1], src[offset + 2], src[offset + 3]]);
        let offset = offset + 4;
        let cmd_len = cmd_len - 4;
        let total_len = u32::from_be_bytes([src[offset], src[offset + 1], src[offset + 2], src[offset + 3]]) as usize;
        let offset = offset + 4;
        let cmd_len = cmd_len - 4;
        let frag_offset = u32::from_be_bytes([src[offset], src[offset + 1], src[offset + 2], src[offset + 3]]) as usize;
        let offset = offset + 4;
        let cmd_len = cmd_len - 4;

        let frag_len = cmd_len;
        if total_len > MAX_ARRAY_SIZE * 16 || !available(src, offset, frag_len) {
            return offset + frag_len;
        }

        if !self.pending_segments.contains_key(&start_seq) {
            if self.pending_segments.len() >= MAX_PENDING_SEGMENTS {
                let oldest_key = *self.pending_segments.keys().next().unwrap_or(&0);
                self.pending_segments.remove(&oldest_key);
            }
            self.pending_segments.insert(start_seq, SegmentedPackage {
                total_length: total_len,
                payload: vec![0u8; total_len],
                bytes_written: 0,
                seen_offsets: std::collections::HashSet::new(),
            });
        }

        if let Some(seg) = self.pending_segments.get_mut(&start_seq) {
            let end = frag_offset + frag_len;
            if !seg.seen_offsets.contains(&frag_offset) && end <= seg.payload.len() {
                seg.payload[frag_offset..end].copy_from_slice(&src[offset..offset + frag_len]);
                seg.bytes_written += frag_len;
                seg.seen_offsets.insert(frag_offset);
            }
        }

        let offset = offset + frag_len;

        if let Some(seg) = self.pending_segments.remove(&start_seq) {
            if seg.bytes_written >= seg.total_length {
                self.handle_send_reliable(&seg.payload, 0, seg.payload.len());
            }
        }

        offset
    }

    fn fire_event(&mut self, ev: EventData) {
        if let Some(ref mut cb) = self.on_event {
            cb(ev);
        }
    }

    fn fire_request(&mut self, req: OperationRequest) {
        if let Some(ref mut cb) = self.on_request {
            cb(req);
        }
    }

    fn fire_response(&mut self, resp: OperationResponse) {
        if let Some(ref mut cb) = self.on_response {
            cb(resp);
        }
    }

    fn fire_encrypted(&mut self) {
        if let Some(ref mut cb) = self.on_encrypted {
            cb();
        }
    }

    fn fire_error(&mut self, msg: String, len: usize) {
        if let Some(ref mut cb) = self.on_parse_error {
            cb(msg, len);
        }
    }
}

fn available(src: &[u8], offset: usize, count: usize) -> bool {
    offset <= src.len() && src.len().saturating_sub(offset) >= count
}

// ---- Deserializer (LittleEndian — .NET native byte order) ----

fn deserialize_event(data: &[u8]) -> Option<EventData> {
    if data.is_empty() { return None; }
    let code = data[0];
    let params = read_parameter_table(&data[1..]);
    Some(EventData { code, parameters: params })
}

fn deserialize_request(data: &[u8]) -> Option<OperationRequest> {
    if data.is_empty() { return None; }
    let op_code = data[0];
    let params = read_parameter_table(&data[1..]);
    Some(OperationRequest { operation_code: op_code, parameters: params })
}

fn deserialize_response(data: &[u8]) -> Option<OperationResponse> {
    if data.len() < 3 { return None; }
    let mut offset = 0;
    let op_code = data[offset]; offset += 1;
    let return_code = i16::from_le_bytes([data[offset], data[offset + 1]]); offset += 2;

    let mut debug_message: Option<String> = None;
    let mut market_orders: Option<Vec<String>> = None;

    if offset < data.len() {
        let tc = data[offset]; offset += 1;
        if offset < data.len() {
            let val = deserialize_value(&data[offset..], tc);
            if let Some((v, consumed)) = val {
                offset += consumed;
                match &v {
                    PhotonValue::String(s) => debug_message = Some(s.clone()),
                    PhotonValue::StringArray(sa) => market_orders = Some(sa.clone()),
                    _ => {}
                }
            }
        }
    }

    let params = read_parameter_table(&data[offset..]);
    let mut full_params = params;
    if let Some(orders) = market_orders {
        full_params.insert(0, PhotonValue::Int(orders.len() as i32));
    }

    Some(OperationResponse {
        operation_code: op_code,
        return_code,
        debug_message,
        parameters: full_params,
    })
}

fn read_parameter_table(data: &[u8]) -> HashMap<u8, PhotonValue> {
    let mut params = HashMap::new();
    if data.is_empty() { return params; }

    let (count, mut offset) = match read_compressed_u32(data, 0) {
        Some((c, o)) => (c as usize, o),
        None => return params,
    };

    if count == 0 || count > MAX_ARRAY_SIZE { return params; }

    for _ in 0..count {
        if offset >= data.len() { break; }
        let key = data[offset]; offset += 1;
        if offset >= data.len() { break; }
        let tc = data[offset]; offset += 1;
        if let Some((val, consumed)) = deserialize_value(&data[offset..], tc) {
            offset += consumed;
            params.insert(key, val);
        }
    }
    params
}

fn deserialize_value(data: &[u8], tc: u8) -> Option<(PhotonValue, usize)> {
    if data.is_empty() { return None; }

    if tc >= CUSTOM_TYPE_SLIM_BASE {
        return deserialize_custom(data, tc);
    }

    match tc {
        TYPE_UNKNOWN | TYPE_NULL => Some((PhotonValue::Null, 0)),
        TYPE_BOOLEAN => Some((PhotonValue::Boolean(data[0] != 0), 1)),
        TYPE_BYTE => Some((PhotonValue::Byte(data[0]), 1)),
        TYPE_SHORT => {
            if data.len() < 2 { return None; }
            let v = i16::from_le_bytes([data[0], data[1]]);
            Some((PhotonValue::Short(v), 2))
        }
        TYPE_FLOAT => {
            if data.len() < 4 { return None; }
            let v = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
            Some((PhotonValue::Float(v), 4))
        }
        TYPE_DOUBLE => {
            if data.len() < 8 { return None; }
            let v = u64::from_le_bytes(
                [data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]]);
            Some((PhotonValue::Double(v), 8))
        }
        TYPE_STRING => read_photon_string(data),
        TYPE_COMPRESSED_INT => {
            let (v, consumed) = read_compressed_i32(data, 0)?;
            Some((PhotonValue::Int(v), consumed))
        }
        TYPE_COMPRESSED_LONG => {
            let (v, consumed) = read_compressed_i64(data, 0)?;
            Some((PhotonValue::Long(v), consumed))
        }
        TYPE_INT1 => Some((PhotonValue::Int(data[0] as i32), 1)),
        TYPE_INT1_NEG => Some((PhotonValue::Int(-(data[0] as i32)), 1)),
        TYPE_INT2 => {
            if data.len() < 2 { return None; }
            let v = u16::from_le_bytes([data[0], data[1]]) as i32;
            Some((PhotonValue::Int(v), 2))
        }
        TYPE_INT2_NEG => {
            if data.len() < 2 { return None; }
            let v = -(u16::from_le_bytes([data[0], data[1]]) as i32);
            Some((PhotonValue::Int(v), 2))
        }
        TYPE_LONG1 => Some((PhotonValue::Long(data[0] as i64), 1)),
        TYPE_LONG1_NEG => Some((PhotonValue::Long(-(data[0] as i64)), 1)),
        TYPE_LONG2 => {
            if data.len() < 2 { return None; }
            let v = u16::from_le_bytes([data[0], data[1]]) as i64;
            Some((PhotonValue::Long(v), 2))
        }
        TYPE_LONG2_NEG => {
            if data.len() < 2 { return None; }
            let v = -(u16::from_le_bytes([data[0], data[1]]) as i64);
            Some((PhotonValue::Long(v), 2))
        }
        TYPE_CUSTOM => deserialize_custom(data, 0),
        TYPE_DICTIONARY | TYPE_HASHTABLE => deserialize_dictionary(data),
        TYPE_OBJECT_ARRAY => deserialize_object_array(data),
        TYPE_OPERATION_REQUEST => {
            let (_, consumed) = read_compressed_u32(data, 0)?;
            Some((PhotonValue::Null, consumed))
        }
        TYPE_OPERATION_RESP => Some((PhotonValue::Null, 0)),
        TYPE_EVENT_DATA => Some((PhotonValue::Null, 0)),
        TYPE_BOOL_FALSE => Some((PhotonValue::Boolean(false), 0)),
        TYPE_BOOL_TRUE => Some((PhotonValue::Boolean(true), 0)),
        TYPE_SHORT_ZERO => Some((PhotonValue::Short(0), 0)),
        TYPE_INT_ZERO => Some((PhotonValue::Int(0), 0)),
        TYPE_LONG_ZERO => Some((PhotonValue::Long(0), 0)),
        TYPE_FLOAT_ZERO => Some((PhotonValue::Float(0), 0)),
        TYPE_DOUBLE_ZERO => Some((PhotonValue::Double(0), 0)),
        TYPE_BYTE_ZERO => Some((PhotonValue::Byte(0), 0)),
        _ => {
            if (tc & TYPE_ARRAY) == TYPE_ARRAY {
                let elem_type = tc & !TYPE_ARRAY;
                deserialize_typed_array(data, elem_type)
            } else {
                None
            }
        }
    }
}

fn deserialize_custom(data: &[u8], gp_type: u8) -> Option<(PhotonValue, usize)> {
    let mut offset = 0;
    if gp_type < CUSTOM_TYPE_SLIM_BASE {
        if offset >= data.len() { return None; }
        offset += 1; // skip custom type byte
    }
    let (size, consumed) = read_compressed_u32(data, offset)?;
    offset += consumed;
    let size = size as usize;
    if size > MAX_ARRAY_SIZE || offset + size > data.len() {
        return None;
    }
    let bytes = data[offset..offset + size].to_vec();
    Some((PhotonValue::Bytes(bytes), offset + size))
}

fn deserialize_dictionary(data: &[u8]) -> Option<(PhotonValue, usize)> {
    if data.is_empty() { return None; }
    let mut offset = 0;

    let key_tc = data[offset]; offset += 1;
    if offset >= data.len() { return None; }
    let val_tc = data[offset]; offset += 1;

    let (count, consumed) = read_compressed_u32(data, offset)?;
    offset += consumed;
    let count = count as usize;
    if count > MAX_ARRAY_SIZE || count == 0 {
        return Some((PhotonValue::Dictionary(HashMap::new()), offset));
    }

    let mut dict = HashMap::new();
    for _ in 0..count {
        if offset >= data.len() { break; }

        let kt = if key_tc == 0 { data[offset] } else { key_tc };
        if key_tc == 0 { offset += 1; }

        let (key, kc) = deserialize_value(&data[offset..], kt)?;
        offset += kc;

        if offset >= data.len() { break; }
        let vt = if val_tc == 0 { data[offset] } else { val_tc };
        if val_tc == 0 { offset += 1; }

        let (val, vc) = deserialize_value(&data[offset..], vt)?;
        offset += vc;

        dict.insert(key, val);
    }

    Some((PhotonValue::Dictionary(dict), offset))
}

fn deserialize_object_array(data: &[u8]) -> Option<(PhotonValue, usize)> {
    let (count, mut offset) = read_compressed_u32(data, 0)?;
    let count = count as usize;
    if count > MAX_ARRAY_SIZE || count == 0 {
        return Some((PhotonValue::ObjectArray(Vec::new()), offset));
    }

    let mut result = Vec::with_capacity(count);
    for _ in 0..count {
        if offset >= data.len() { break; }
        let tc = data[offset]; offset += 1;
        if let Some((val, consumed)) = deserialize_value(&data[offset..], tc) {
            offset += consumed;
            result.push(val);
        }
    }
    Some((PhotonValue::ObjectArray(result), offset))
}

fn deserialize_typed_array(data: &[u8], elem_type: u8) -> Option<(PhotonValue, usize)> {
    let (count, mut offset) = read_compressed_u32(data, 0)?;
    let count = count as usize;
    if count > MAX_ARRAY_SIZE || count == 0 {
        return Some((PhotonValue::Array(Vec::new()), offset));
    }

    match elem_type {
        TYPE_BOOLEAN => {
            let packed_len = (count + 7) / 8;
            if offset + packed_len > data.len() { return None; }
            let mut result = Vec::with_capacity(count);
            for i in 0..count {
                result.push((data[offset + i / 8] >> (i % 8)) & 1 != 0);
            }
            Some((PhotonValue::BooleanArray(result), offset + packed_len))
        }
        TYPE_BYTE => {
            if offset + count > data.len() { return None; }
            Some((PhotonValue::Bytes(data[offset..offset + count].to_vec()), offset + count))
        }
        TYPE_SHORT => {
            if offset + count * 2 > data.len() { return None; }
            let mut result = Vec::with_capacity(count);
            for _ in 0..count {
                result.push(i16::from_le_bytes([data[offset], data[offset + 1]]));
                offset += 2;
            }
            Some((PhotonValue::ShortArray(result), offset))
        }
        TYPE_FLOAT => {
            if offset + count * 4 > data.len() { return None; }
            let mut result = Vec::with_capacity(count);
            for _ in 0..count {
                let bits = u32::from_le_bytes(
                    [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
                result.push(f32::from_bits(bits));
                offset += 4;
            }
            Some((PhotonValue::FloatArray(result), offset))
        }
        TYPE_DOUBLE => {
            if offset + count * 8 > data.len() { return None; }
            let mut result = Vec::with_capacity(count);
            for _ in 0..count {
                let bits = u64::from_le_bytes(
                    [data[offset], data[offset + 1], data[offset + 2], data[offset + 3],
                     data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]]);
                result.push(f64::from_bits(bits));
                offset += 8;
            }
            Some((PhotonValue::DoubleArray(result), offset))
        }
        TYPE_STRING => {
            let mut result = Vec::with_capacity(count);
            for _ in 0..count {
                let (s, consumed) = read_photon_string(&data[offset..])?;
                offset += consumed;
                match s {
                    PhotonValue::String(val) => result.push(val),
                    _ => return None,
                }
            }
            Some((PhotonValue::StringArray(result), offset))
        }
        TYPE_COMPRESSED_INT => {
            let mut result = Vec::with_capacity(count);
            for _ in 0..count {
                let (v, consumed) = read_compressed_i32(data, offset)?;
                offset += consumed;
                result.push(v);
            }
            Some((PhotonValue::IntArray(result), offset))
        }
        TYPE_COMPRESSED_LONG => {
            let mut result = Vec::with_capacity(count);
            for _ in 0..count {
                let (v, consumed) = read_compressed_i64(data, offset)?;
                offset += consumed;
                result.push(v);
            }
            Some((PhotonValue::LongArray(result), offset))
        }
        _ => Some((PhotonValue::Array(Vec::new()), offset)),
    }
}

fn read_photon_string(data: &[u8]) -> Option<(PhotonValue, usize)> {
    let (length, consumed) = read_compressed_u32(data, 0)?;
    let length = length as usize;
    if length == 0 || consumed + length > data.len() {
        return None;
    }
    let s = String::from_utf8(data[consumed..consumed + length].to_vec()).ok()?;
    Some((PhotonValue::String(s), consumed + length))
}

fn read_compressed_u32(data: &[u8], start: usize) -> Option<(u32, usize)> {
    let mut value: u32 = 0;
    let mut shift = 0;
    let mut offset = start;
    loop {
        if offset >= data.len() { return None; }
        let b = data[offset];
        offset += 1;
        value |= ((b & 0x7F) as u32) << shift;
        if (b & 0x80) == 0 {
            return Some((value, offset - start));
        }
        shift += 7;
        if shift >= 35 { return None; }
    }
}

fn read_compressed_i32(data: &[u8], start: usize) -> Option<(i32, usize)> {
    let (v, consumed) = read_compressed_u32(data, start)?;
    let result = ((v >> 1) as i32) ^ (-((v & 1) as i32));
    Some((result, consumed))
}

fn read_compressed_i64(data: &[u8], start: usize) -> Option<(i64, usize)> {
    let mut value: u64 = 0;
    let mut shift = 0;
    let mut offset = start;
    loop {
        if offset >= data.len() { return None; }
        let b = data[offset];
        offset += 1;
        value |= ((b & 0x7F) as u64) << shift;
        if (b & 0x80) == 0 {
            let result = ((value >> 1) as i64) ^ (-((value & 1) as i64));
            return Some((result, offset - start));
        }
        shift += 7;
        if shift >= 70 { return None; }
    }
}

// ---- Event post-processing (extract player positions from Move events) ----
pub fn post_process_event(event: &mut EventData) {
    if event.parameters.is_empty() {
        return;
    }
    if !event.parameters.contains_key(&252) {
        event.parameters.insert(252, PhotonValue::Byte(event.code));
    }
    if event.code == 3 {
        extract_move_positions(&mut event.parameters);
    }
}

pub fn post_process_request(req: &mut OperationRequest) {
    if !req.parameters.contains_key(&253) {
        req.parameters.insert(253, PhotonValue::Byte(req.operation_code));
    }
}

pub fn post_process_response(resp: &mut OperationResponse) {
    if !resp.parameters.contains_key(&253) {
        resp.parameters.insert(253, PhotonValue::Byte(resp.operation_code));
    }
}

fn extract_move_positions(params: &mut HashMap<u8, PhotonValue>) {
    let raw = match params.get(&1) {
        Some(PhotonValue::Bytes(b)) if b.len() >= 17 => b.clone(),
        _ => return,
    };
    let x = f32::from_le_bytes([raw[9], raw[10], raw[11], raw[12]]);
    let y = f32::from_le_bytes([raw[13], raw[14], raw[15], raw[16]]);
    if x.is_nan() || x.is_infinite() || y.is_nan() || y.is_infinite() {
        return;
    }
    params.insert(4, PhotonValue::Float(x.to_bits()));
    params.insert(5, PhotonValue::Float(y.to_bits()));
}

/// Post-processing для сырых байт параметров события (как C# EventProcessor.PostProcessEvent).
/// Добавляет param[252] = code для event code 0x01, извлекает позиции для Move (code=3).
/// Возвращает новые байты параметров с добавленными полями.
pub fn post_process_event_params(param_bytes: &[u8], code: u8) -> Vec<u8> {
    let mut params = read_parameter_table(param_bytes);
    if !params.contains_key(&252) {
        params.insert(252, PhotonValue::Byte(code));
    }
    if code == 3 {
        extract_move_positions(&mut params);
    }
    serialize_params(&params)
}

/// Парсит Move event и если позиция совпадает с player_x/player_y — возвращает entity_id
pub fn extract_move_entity_id(param_bytes: &[u8], player_x: f32, player_y: f32) -> Option<i32> {
    let params = read_parameter_table(param_bytes);
    let entity_id = extract_param_id(&params)?;
    let raw = match params.get(&1) {
        Some(PhotonValue::Bytes(b)) if b.len() >= 17 => b.as_slice(),
        _ => return None,
    };
    let x = f32::from_le_bytes([raw[9], raw[10], raw[11], raw[12]]);
    let y = f32::from_le_bytes([raw[13], raw[14], raw[15], raw[16]]);
    if !x.is_finite() || !y.is_finite() { return None; }
    let dx = (x - player_x).abs();
    let dy = (y - player_y).abs();
    if dx < 3.0 && dy < 3.0 {
        Some(entity_id)
    } else {
        None
    }
}

/// Только парсит Move event — возвращает (entity_id, x, y) без проверки позиции
pub fn read_move_params(param_bytes: &[u8], ks_key: Option<[u8; 8]>) -> Option<(i32, f32, f32)> {
    let params = read_parameter_table(param_bytes);
    let entity_id = extract_param_id(&params)?;
    // Новый формат: координаты как Float в param[4] и param[5]
    if let (Some(PhotonValue::Float(xb)), Some(PhotonValue::Float(yb))) = (params.get(&4), params.get(&5)) {
        let x = f32::from_bits(*xb);
        let y = f32::from_bits(*yb);
        if x.is_finite() && y.is_finite() && x.abs() <= 50000.0 && y.abs() <= 50000.0 {
            return Some((entity_id, x, y));
        }
    }
    // Новый формат: только X в param[4] (Y может быть в следующем пакете)
    if let Some(PhotonValue::Float(xb)) = params.get(&4) {
        let x = f32::from_bits(*xb);
        if x.is_finite() && x.abs() <= 50000.0 {
            if let Some(PhotonValue::Float(yb)) = params.get(&5) {
                let y = f32::from_bits(*yb);
                if y.is_finite() && y.abs() <= 50000.0 {
                    return Some((entity_id, x, y));
                }
            }
            // Y может быть в param[5] без Float тега — пробуем байты
            return None;
        }
    }
    // Новый формат: только Y в param[5]
    if let Some(PhotonValue::Float(yb)) = params.get(&5) {
        let y = f32::from_bits(*yb);
        if y.is_finite() && y.abs() <= 50000.0 {
            return None; // без X не используем
        }
    }
    // Старый формат: координаты в param[1] byte[>=17]
    let mut raw = match params.get(&1) {
        Some(PhotonValue::Bytes(b)) if b.len() >= 17 => b.clone(),
        _ => return None,
    };
    if let Some(key) = ks_key {
        for i in 0..4 {
            raw[9 + i] ^= key[i];
            raw[13 + i] ^= key[4 + i];
        }
    }
    let x = f32::from_le_bytes([raw[9], raw[10], raw[11], raw[12]]);
    let y = f32::from_le_bytes([raw[13], raw[14], raw[15], raw[16]]);
    if !x.is_finite() || !y.is_finite() { return None; }
    Some((entity_id, x, y))
}

/// Извлекает KeySync ключ (code=595) из param_bytes
pub fn read_keysync_params(param_bytes: &[u8]) -> Option<[u8; 8]> {
    let params = read_parameter_table(param_bytes);
    match params.get(&0) {
        Some(PhotonValue::Bytes(b)) if b.len() == 8 => {
            let mut key = [0u8; 8];
            key.copy_from_slice(b);
            Some(key)
        }
        _ => None,
    }
}

/// Извлекает ID атакующего из AttackStart (code=23)
/// param[0] = attacker_id
pub fn extract_attacker_id(param_bytes: &[u8]) -> Option<i32> {
    let params = read_parameter_table(param_bytes);
    extract_param_id(&params)
}

/// Имена событий как в C# Events enum: Leave=1, JoinFinished=2, Move=3, Teleport=4 ...
pub fn event_name(code: i32) -> &'static str {
    match code {
        0 => "None",
        1 => "Leave",
        2 => "JoinFinished",
        3 => "Move",
        4 => "Teleport",
        5 => "ChangeEquipment",
        6 => "HealthUpdate",
        7 => "HealthUpdates",
        8 => "EnergyUpdate",
        9 => "DamageShieldUpdate",
        10 => "CraftingFocusUpdate",
        11 => "ResetCooldowns",
        12 => "Attack",
        13 => "CastStart",
        14 => "ChannelingUpdate",
        15 => "CastCancel",
        16 => "CastTimeUpdate",
        17 => "CastFinished",
        18 => "CastSpell",
        19 => "CastSpells",
        20 => "CastHit",
        21 => "CastHits",
        22 => "StoredTargetsUpdate",
        23 => "ChannelingEnded",
        24 => "AttackBuilding",
        // game-level codes (from param[252] for event 0x01):
        595 => "KeySync",
        _ => "Unknown",
    }
}

/// Форматирует параметры как C# PrintParams: params={count} [key]=value [key]=value ...
pub fn format_params(param_bytes: &[u8]) -> String {
    let params = read_parameter_table(param_bytes);
    if params.is_empty() {
        return " (no params)".to_string();
    }
    let mut out = format!(" params={}", params.len());
    let mut keys: Vec<&u8> = params.keys().collect();
    keys.sort();
    for k in keys {
        let v = &params[k];
        let s = match v {
            PhotonValue::Null => "null".to_string(),
            PhotonValue::Boolean(b) => b.to_string(),
            PhotonValue::Byte(b) => format!("{}", b),
            PhotonValue::Short(n) => format!("{}", n),
            PhotonValue::Int(n) => format!("{}", n),
            PhotonValue::Long(n) => format!("{}", n),
            PhotonValue::Float(f) => format!("{}", f32::from_bits(*f)),
            PhotonValue::Double(d) => format!("{}", f64::from_bits(*d)),
            PhotonValue::String(s) => format!("\"{}\"", s),
            PhotonValue::Bytes(b) => format!("byte[{}]", b.len()),
            PhotonValue::Array(a) => format!("array[{}]", a.len()),
            PhotonValue::BooleanArray(a) => format!("bool[{}]", a.len()),
            PhotonValue::ShortArray(a) => format!("short[{}]", a.len()),
            PhotonValue::IntArray(a) => format!("int[{}]", a.len()),
            PhotonValue::LongArray(a) => format!("long[{}]", a.len()),
            PhotonValue::FloatArray(a) => format!("float[{}]", a.len()),
            PhotonValue::DoubleArray(a) => format!("double[{}]", a.len()),
            PhotonValue::StringArray(a) => format!("string[{}]", a.len()),
            PhotonValue::Dictionary(d) => format!("dict[{}]", d.len()),
            PhotonValue::ObjectArray(a) => format!("obj[{}]", a.len()),
        };
        let s = if s.len() > 80 { format!("{}...", &s[..77]) } else { s };
        out.push_str(&format!(" [{}]={}", k, s));
    }
    out
}

/// Извлекает float-позицию из параметра key
pub fn extract_float_pos(param_bytes: &[u8], key: u8) -> Option<(f32, f32)> {
    let params = read_parameter_table(param_bytes);
    match params.get(&key) {
        Some(PhotonValue::FloatArray(a)) if a.len() >= 2 => {
            Some((a[0], a[1]))
        }
        _ => None,
    }
}

/// Извлекает позицию атакующего из AttackStart (param[1])
pub fn extract_attackstart_pos(param_bytes: &[u8]) -> Option<(f32, f32)> {
    extract_float_pos(param_bytes, 1)
}

/// Извлекает точку клика из AttackStart (param[3])
pub fn extract_param3_pos(param_bytes: &[u8]) -> Option<(f32, f32)> {
    extract_float_pos(param_bytes, 3)
}

/// Извлекает param[key] как int
pub fn read_param(param_bytes: &[u8], key: u8) -> Option<i32> {
    let params = read_parameter_table(param_bytes);
    match params.get(&key) {
        Some(PhotonValue::Int(v)) => Some(*v),
        Some(PhotonValue::Short(v)) => Some(*v as i32),
        Some(PhotonValue::Byte(v)) => Some(*v as i32),
        _ => None,
    }
}

/// Извлекает param[252] как int (game-level event code)
pub fn read_param_252(param_bytes: &[u8]) -> Option<i32> {
    read_param(param_bytes, 252)
}

/// Извлекает i32 из параметра 0 (поддерживает Int, Long, Short, Byte)
fn extract_param_id(params: &HashMap<u8, PhotonValue>) -> Option<i32> {
    match params.get(&0) {
        Some(PhotonValue::Int(v)) => Some(*v),
        Some(PhotonValue::Long(v)) => Some(*v as i32),
        Some(PhotonValue::Short(v)) => Some(*v as i32),
        Some(PhotonValue::Byte(v)) => Some(*v as i32),
        _ => None,
    }
}

// ---- Photon Serializer ----
pub fn serialize_params(params: &HashMap<u8, PhotonValue>) -> Vec<u8> {
    let mut out = Vec::new();
    write_compressed_u32(&mut out, params.len() as u32);
    for (&key, val) in params {
        out.push(key);
        write_value(&mut out, val);
    }
    out
}

// ---- Parameters-only (without code byte) from message body ----
pub fn serialize_params_from_body(msg_type: u8, body: &[u8]) -> Vec<u8> {
    match msg_type {
        2 | 4 => { // request or event: [code:1][params]
            if body.len() <= 1 { return vec![0u8]; }
            // уже сериализованные Photon params — отправляем как есть
            body[1..].to_vec()
        }
        3 => { // response: [opcode:1][return_code:2 LE][debug?][params]
            if let Some(resp) = deserialize_response(body) {
                serialize_params(&resp.parameters)
            } else {
                vec![0u8]
            }
        }
        _ => vec![0u8],
    }
}

fn write_compressed_u32(out: &mut Vec<u8>, mut val: u32) {
    loop {
        if val < 0x80 {
            out.push(val as u8);
            return;
        }
        out.push((val as u8) | 0x80);
        val >>= 7;
    }
}

fn write_value(out: &mut Vec<u8>, val: &PhotonValue) {
    match val {
        PhotonValue::Null => { out.push(TYPE_NULL); }
        PhotonValue::Boolean(v) => {
            out.push(if *v { TYPE_BOOL_TRUE } else { TYPE_BOOL_FALSE });
        }
        PhotonValue::Byte(v) => { out.push(TYPE_BYTE); out.push(*v); }
        PhotonValue::Short(v) => {
            if *v == 0 { out.push(TYPE_SHORT_ZERO); }
            else { out.push(TYPE_SHORT); out.extend_from_slice(&v.to_le_bytes()); }
        }
        PhotonValue::Int(v) => {
            if *v == 0 { out.push(TYPE_INT_ZERO); }
            else if *v >= 0 && *v <= 255 { out.push(TYPE_INT1); out.push(*v as u8); }
            else if *v < 0 && *v >= -255 { out.push(TYPE_INT1_NEG); out.push(-*v as u8); }
            else if *v >= 0 && *v <= 65535 { out.push(TYPE_INT2); out.extend_from_slice(&(*v as u16).to_le_bytes()); }
            else if *v < 0 && *v >= -65535 { out.push(TYPE_INT2_NEG); out.extend_from_slice(&(-*v as u16).to_le_bytes()); }
            else {
                out.push(TYPE_COMPRESSED_INT);
                write_compressed_i32(out, *v);
            }
        }
        PhotonValue::Long(v) => {
            if *v == 0 { out.push(TYPE_LONG_ZERO); }
            else if *v >= 0 && *v <= 255 { out.push(TYPE_LONG1); out.push(*v as u8); }
            else if *v < 0 && *v >= -255 { out.push(TYPE_LONG1_NEG); out.push(-*v as u8); }
            else if *v >= 0 && *v <= 65535 { out.push(TYPE_LONG2); out.extend_from_slice(&(*v as u16).to_le_bytes()); }
            else if *v < 0 && *v >= -65535 { out.push(TYPE_LONG2_NEG); out.extend_from_slice(&(-*v as u16).to_le_bytes()); }
            else {
                out.push(TYPE_COMPRESSED_LONG);
                write_compressed_i64(out, *v);
            }
        }
        PhotonValue::Float(v) => {
            if *v == 0 { out.push(TYPE_FLOAT_ZERO); }
            else { out.push(TYPE_FLOAT); out.extend_from_slice(&v.to_le_bytes()); }
        }
        PhotonValue::Double(v) => {
            if *v == 0 { out.push(TYPE_DOUBLE_ZERO); }
            else { out.push(TYPE_DOUBLE); out.extend_from_slice(&v.to_le_bytes()); }
        }
        PhotonValue::String(s) => {
            out.push(TYPE_STRING);
            let bytes = s.as_bytes();
            write_compressed_u32(out, bytes.len() as u32);
            out.extend_from_slice(bytes);
        }
        PhotonValue::Bytes(b) => {
            out.push(TYPE_CUSTOM);
            write_compressed_u32(out, b.len() as u32);
            out.extend_from_slice(b);
        }
        PhotonValue::IntArray(v) => {
            out.push(TYPE_ARRAY | TYPE_COMPRESSED_INT);
            write_compressed_u32(out, v.len() as u32);
            for &n in v { write_compressed_i32(out, n); }
        }
        PhotonValue::ShortArray(v) => {
            out.push(TYPE_ARRAY | TYPE_SHORT);
            write_compressed_u32(out, v.len() as u32);
            for &n in v { out.extend_from_slice(&n.to_le_bytes()); }
        }
        PhotonValue::FloatArray(v) => {
            out.push(TYPE_ARRAY | TYPE_FLOAT);
            write_compressed_u32(out, v.len() as u32);
            for &n in v { out.extend_from_slice(&n.to_le_bytes()); }
        }
        PhotonValue::StringArray(v) => {
            out.push(TYPE_ARRAY | TYPE_STRING);
            write_compressed_u32(out, v.len() as u32);
            for s in v {
                let bytes = s.as_bytes();
                write_compressed_u32(out, bytes.len() as u32);
                out.extend_from_slice(bytes);
            }
        }
        PhotonValue::BooleanArray(v) => {
            out.push(TYPE_ARRAY | TYPE_BOOLEAN);
            write_compressed_u32(out, v.len() as u32);
            let packed_len = (v.len() + 7) / 8;
            let packed_start = out.len();
            out.resize(out.len() + packed_len, 0);
            for (i, &b) in v.iter().enumerate() {
                if b { out[packed_start + i / 8] |= 1 << (i % 8); }
            }
        }
        _ => out.push(TYPE_NULL),
    }
}

fn write_compressed_i32(out: &mut Vec<u8>, val: i32) {
    let zigzag = ((val >> 31) as u32) ^ ((val as u32) << 1);
    write_compressed_u32(out, zigzag);
}

fn write_compressed_i64(out: &mut Vec<u8>, val: i64) {
    let zigzag = ((val >> 63) as u64) ^ ((val as u64) << 1);
    let mut v = zigzag;
    loop {
        if v < 0x80 {
            out.push(v as u8);
            return;
        }
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
}
