use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use once_cell::sync::Lazy;

use crate::memory::find_all_collision_grids;
use crate::photon::serialize_params_from_body;

const AOR_INPUT_KO: &str = "/home/stas/AO_mem_reader/aor_input.ko";
const ANTI_AFK_PY: &str = "/home/stas/anti_afk.py";
const PYTHON: &str = "/usr/bin/python3";

pub static RELAY_CLIENTS: Lazy<Mutex<Vec<std::net::TcpStream>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

static KEY_SYNC: Mutex<Option<[u8; 8]>> = Mutex::new(None);
static AFK_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
pub static PLAYER_ENTITY_ID: Mutex<i32> = Mutex::new(0);
pub static PLAYER_NAME: Mutex<String> = Mutex::new(String::new());
pub static SLAVE_NAME: Mutex<String> = Mutex::new(String::new());
pub static SLAVE_ID: Mutex<i32> = Mutex::new(0);
pub static SLAVE_POS: Mutex<(f32, f32)> = Mutex::new((0.0, 0.0));
pub static MAIN_POS: Mutex<(f32, f32)> = Mutex::new((0.0, 0.0));
pub static PACKET_CAPTURED: AtomicU64 = AtomicU64::new(0);
pub static PACKET_RELAYED: AtomicU64 = AtomicU64::new(0);

pub static CHAT_IN: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));
pub static CHAT_OUT: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));
pub static LAST_POS: Mutex<(f32, f32)> = Mutex::new((0.0, 0.0));

pub fn relay_client_count() -> usize {
    RELAY_CLIENTS.lock().map(|c| c.len()).unwrap_or(0)
}

pub fn set_keysync(key: [u8; 8]) {
    if let Ok(mut k) = KEY_SYNC.lock() {
        *k = Some(key);
    }
}

pub fn get_keysync() -> Option<[u8; 8]> {
    KEY_SYNC.lock().ok().and_then(|k| *k)
}

// ---- Оригинальный сервер коллизий (порт 4444) ----
pub fn start_sync_server(pid: i32) {
    let listener = TcpListener::bind("0.0.0.0:4444").unwrap();
    println!("[+] Сетевое ядро запущено на порту 4444. Ожидаю подключение оверлея Windows...");

    for stream in listener.incoming() {
        if let Ok(mut stream) = stream {
            println!("[+] Оверлей Windows подключен!");

            loop {
                let grids = find_all_collision_grids(pid);

                if !grids.is_empty() {
                    let count = grids.len() as u32;
                    if stream.write_all(&count.to_le_bytes()).is_err() { break; }

                    for grid in &grids {
                        let mut header = Vec::with_capacity(16);
                        header.extend_from_slice(&grid.width.to_le_bytes());
                        header.extend_from_slice(&grid.height.to_le_bytes());
                        header.extend_from_slice(&grid.world_pos_x.to_le_bytes());
                        header.extend_from_slice(&grid.world_pos_y.to_le_bytes());
                        if stream.write_all(&header).is_err() { break; }
                        let sz = grid.raw_matrix.len() as u32;
                        if stream.write_all(&sz.to_le_bytes()).is_err() { break; }
                        if stream.write_all(&grid.raw_matrix).is_err() { break; }
                    }
                    println!("[+] Коллизионная сетка отправлена");
                }
                thread::sleep(Duration::from_secs(5));
            }
        }
    }
}

// ---- Сервер ретрансляции пакетов (порт 4445) ----
pub fn start_relay_server(running: Arc<std::sync::atomic::AtomicBool>, game_pid: i32) {
    let listener = std::net::TcpListener::bind("0.0.0.0:4445").unwrap();
    listener.set_nonblocking(true).ok();
    println!("[+] Релей сервер на порту 4445. Сюда подключается Windows AOR для получения пакетов.");

    thread::spawn(move || {
        while running.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    println!("[+] Windows AOR подключен к релею: {}", addr);
                    let mut read_stream = match stream.try_clone() {
                        Ok(s) => s,
                        Err(_) => { continue; }
                    };
                    stream.set_nodelay(true).ok();

                    let pid = game_pid;
                    thread::spawn(move || {
                        let mut coord_buf = [0u8; 12];
                        loop {
                            let mut read = 0;
                            while read < 12 {
                                match read_stream.read(&mut coord_buf[read..]) {
                                    Ok(0) => return,
                                    Ok(n) => read += n,
                                    Err(_) => return,
                                }
                            }
                            let x = f32::from_le_bytes([coord_buf[0], coord_buf[1], coord_buf[2], coord_buf[3]]);
                            let y = f32::from_le_bytes([coord_buf[4], coord_buf[5], coord_buf[6], coord_buf[7]]);
                            let z = f32::from_le_bytes([coord_buf[8], coord_buf[9], coord_buf[10], coord_buf[11]]);
                            if let Ok(mut pos) = LAST_POS.lock() { *pos = (x, y); }
                            if let Ok(mut p) = MAIN_POS.lock() { *p = (x, y); }
                            println!("[REL] Получены координаты: ({:.2}, {:.2}, {:.2})", x, y, z);
                            crate::memory::find_float_coords(pid, x, y, z);
                            // Шлём type=5 (Custom) всем relay клиентам
                            let mut out5 = Vec::with_capacity(12);
                            out5.extend_from_slice(&[0, 0, 0, 0]); // src_ip
                            out5.push(5); out5.push(0);            // type=5, code=0
                            out5.extend_from_slice(&12u16.to_le_bytes()); // len=12
                            out5.extend_from_slice(&coord_buf);    // x,y,z
                            // Шлём позицию слейва если известна (type=5, code=1)
                            let slave_pkt = {
                                let sid = *SLAVE_ID.lock().unwrap();
                                if sid != 0 {
                                    let (sx, sy) = *SLAVE_POS.lock().unwrap();
                                    if sx != 0.0 || sy != 0.0 {
                                        let mut p = Vec::with_capacity(16);
                                        p.extend_from_slice(&[0, 0, 0, 0]); // src_ip
                                        p.push(5); p.push(1);                // type=5, code=1
                                        p.extend_from_slice(&12u16.to_le_bytes()); // len=12
                                        p.extend_from_slice(&sid.to_le_bytes());
                                        p.extend_from_slice(&sx.to_le_bytes());
                                        p.extend_from_slice(&sy.to_le_bytes());
                                        Some(p)
                                    } else { None }
                                } else { None }
                            };
                            if let Ok(mut clients) = RELAY_CLIENTS.lock() {
                                let mut i = 0;
                                while i < clients.len() {
                                    match clients[i].write(&out5) {
                                        Ok(n) if n == out5.len() => i += 1,
                                        Ok(_) => i += 1,
                                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => i += 1,
                                        Err(_) => { clients.remove(i); }
                                    }
                                }
                                if let Some(ref sp) = slave_pkt {
                                    let mut i = 0;
                                    while i < clients.len() {
                                        match clients[i].write(sp) {
                                            Ok(n) if n == sp.len() => i += 1,
                                            Ok(_) => i += 1,
                                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => i += 1,
                                            Err(_) => { clients.remove(i); }
                                        }
                                    }
                                }
                            }
                        }
                    });

                    if let Ok(mut c) = RELAY_CLIENTS.lock() {
                        c.push(stream);
                    }
                    request_player_id();
                    // повторный запрос через 3 сек — на случай если C# ещё не получил Join
                    let running_clone = running.clone();
                    thread::spawn(move || {
                        thread::sleep(Duration::from_secs(3));
                        if running_clone.load(Ordering::Relaxed) {
                            request_player_id();
                        }
                    });
                }
                Err(_) => {}
            }
            thread::sleep(Duration::from_millis(200));
        }
    });
}

// ---- AF_PACKET сниффер ----
pub fn start_packet_capture(running: Arc<std::sync::atomic::AtomicBool>, game_pid: i32) {
    let fd = unsafe { libc::socket(libc::AF_PACKET, libc::SOCK_RAW, libc::htons(libc::ETH_P_ALL as u16) as i32) };
    if fd < 0 {
        println!("[-] AF_PACKET socket: root required (errno={})", -fd);
        return;
    }
    println!("[+] AF_PACKET сниффер запущен. Захват порта 5056...");

    // Получаем clients из start_relay_server
    // Используем глобальный список
    let mut buf = [0u8; 65536];
    let mut pkt_count: u64 = 0;
    let mut last_report = std::time::Instant::now();
    while running.load(Ordering::Relaxed) {
        let n = unsafe { libc::recv(fd, buf.as_mut_ptr() as *mut _, buf.len(), 0) };
        if n <= 0 { continue; }
        let n = n as usize;

        // Парсим Ethernet/IP/UDP
        if n < 42 { continue; }
        if u16::from_be_bytes([buf[12], buf[13]]) != 0x0800 { continue; } // IPv4
        let ip_ihl = (buf[14] & 0x0f) as usize * 4;
        if n < 14 + ip_ihl + 8 { continue; }
        if buf[14 + 9] != 17 { continue; } // UDP
        let sport = u16::from_be_bytes([buf[14 + ip_ihl + 0], buf[14 + ip_ihl + 1]]);
        let dport = u16::from_be_bytes([buf[14 + ip_ihl + 2], buf[14 + ip_ihl + 3]]);
        if sport != 5056 && dport != 5056 { continue; } // в обе стороны

        pkt_count += 1;
        PACKET_CAPTURED.store(pkt_count, Ordering::Relaxed);
        if pkt_count % 100 == 0 {
            println!("[CAP] {} Photon пакетов захвачено", pkt_count);
        }

        let udp_len = u16::from_be_bytes([buf[14 + ip_ihl + 4], buf[14 + ip_ihl + 5]]) as usize;
        if udp_len < 8 { continue; }
        let payload_offset = 14 + ip_ihl + 8;
        let payload_len = udp_len - 8;
        if payload_offset + payload_len > n { continue; }

        let raw = &buf[payload_offset..payload_offset + payload_len];

        if pkt_count <= 10 {
            let hex = raw.iter().take(40).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
            println!("[CAP] raw: {} (len={})", hex, raw.len());
        }

        // IP-адрес источника (4 байта, network order)
        let src_ip = &buf[14 + 12..14 + 16];

        // Парсим Photon: извлекаем тела сообщений (msg_type, code, param_bytes)
        let messages = extract_photon_messages(raw, pkt_count <= 20);

        if pkt_count <= 30 {
            for (i, (mt, mc, _)) in messages.iter().enumerate() {
                println!("[CAP] msg#{} type={} code={}", i, mt, mc);
            }
        }
        for (msg_type, code, param_bytes) in &messages {
            if param_bytes.len() <= 1 && (param_bytes.is_empty() || param_bytes[0] == 0) {
                if pkt_count <= 100 { println!("[CAP] skip empty/bad params type={} code={}", msg_type, code); }
                continue; // мусор от кастомного протокола
            }
            PACKET_RELAYED.fetch_add(1, Ordering::Relaxed);
            let dlen = param_bytes.len() as u16;

            if pkt_count <= 100 || *code != 1 {
                let hex = param_bytes.iter().take(20).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                println!("[CAP] X type={} code={} params_len={} hex={}",
                         msg_type, code, dlen, hex);
            }

            // ChangeCluster (code=35) — запрашиваем новый ID
            if *msg_type == 3 && *code == 35 {
                println!("[CAP] *** ChangeCluster обнаружен! Запрашиваю новый ID...");
                request_player_id();
            }

            // KeySync event (param[252] == 595) — сохраняем ключ расшифровки позиций
            if *msg_type == 4 && *code != 3 {
                let keysync_code = crate::photon::read_param_252(param_bytes);
                if keysync_code == Some(595) {
                    if let Some(key) = crate::photon::read_keysync_params(param_bytes) {
                        if let Ok(mut k) = KEY_SYNC.lock() {
                            println!("[KS] KeySync ключ: {:02x?}", key);
                            *k = Some(key);
                        }
                    }
                }
            }

            // AttackStart (request) — позиция и точка клика (обновляется на месте)
            if *msg_type == 2 {
                let op_code = crate::photon::read_param(param_bytes, 253);
                if op_code == Some(22) {
                    let mut mypos = (0.0, 0.0);
                    if let Some((mx, my)) = crate::photon::extract_attackstart_pos(param_bytes) {
                        if let Ok(mut p) = MAIN_POS.lock() { *p = (mx, my); }
                        mypos = (mx, my);
                    }
                    let trg = crate::photon::extract_param3_pos(param_bytes);
                    if let Some((tx, ty)) = trg {
                        print!("\r[CAP] AttackStart my=({:.1},{:.1}) trg=({:.1},{:.1})  ", mypos.0, mypos.1, tx, ty);
                    } else {
                        print!("\r[CAP] AttackStart my=({:.1},{:.1})  ", mypos.0, mypos.1);
                    }
                    use std::io::Write;
                    let _ = std::io::stdout().flush();
                }
            }

            // Move event — обновление позиций других игроков
            if *msg_type == 4 && *code == 3 {
                let ks_key = get_keysync();
                if let Some((eid, mx, my)) = crate::photon::read_move_params(param_bytes, ks_key) {
                    let hex = param_bytes.iter().take(40).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                    println!("[CAP] MOVE id={} pos=({:.1},{:.1}) params_hex={}", eid, mx, my, hex);
                    let main_id = *PLAYER_ENTITY_ID.lock().unwrap();
                    if eid == main_id {
                        if let Ok(mut p) = MAIN_POS.lock() { *p = (mx, my); }
                        broadcast_player_id();
                    } else {
                        let mut slave = SLAVE_ID.lock().unwrap();
                        if *slave == 0 {
                            *slave = eid;
                            println!("[CAP] *** SLAVE ID={} (x={:.1},y={:.1})", eid, mx, my);
                        }
                        if *slave == eid {
                            if let Ok(mut p) = SLAVE_POS.lock() { *p = (mx, my); }
                            drop(slave);
                            println!("[CAP] SLAVE MOVE id={} pos=({:.1},{:.1})", eid, mx, my);
                            broadcast_slave_position();
                        }
                    }
                }
            }

            // Формат: [src_ip:4][type:1][code:1][data_len:2 LE][param_bytes]
            let mut out = Vec::with_capacity(8 + param_bytes.len());
            out.extend_from_slice(src_ip);
            out.push(*msg_type);  // 2=request, 3=response, 4=event
            out.push(*code);
            out.extend_from_slice(&dlen.to_le_bytes());
            out.extend_from_slice(param_bytes);

            use std::io::Write;
            if let Ok(mut clients) = RELAY_CLIENTS.lock() {
                let mut i = 0;
                while i < clients.len() {
                    match clients[i].write(&out) {
                        Ok(n) if n == out.len() => i += 1,
                        Ok(_) => { i += 1; } // partial write, skip
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => i += 1,
                        Err(_) => { clients.remove(i); }
                    }
                }
            }
        }

        if last_report.elapsed() >= std::time::Duration::from_secs(10) {
            let nclients = RELAY_CLIENTS.lock().map(|c| c.len()).unwrap_or(0);
            println!("[CAP] отчёт: {} захвачено, {} отправлено, {} клиентов",
                     pkt_count, PACKET_RELAYED.load(Ordering::Relaxed), nclients);
            last_report = std::time::Instant::now();
        }
    }

    unsafe { libc::close(fd); }
}

// ---- Photon: извлекаем тела сообщений из raw (полный UDP payload) ----
fn extract_photon_messages(raw: &[u8], debug: bool) -> Vec<(u8, u8, Vec<u8>)> {
    let mut result = vec![];
    if raw.len() < 12 { return result; }

    let flags = raw[2];
    if flags & 0x01 != 0 { return result; } // encrypted

    let cmd_count = raw[3] as usize;
    let mut offset = 12; // skip peerId(2) + flags(1) + cmdCount(1) + timestamp(4) + challenge(4)

    for _ in 0..cmd_count {
        if offset + 12 > raw.len() { break; }
        let cmd_type = raw[offset];
        let cmd_len = u32::from_be_bytes([raw[offset+4], raw[offset+5], raw[offset+6], raw[offset+7]]) as usize;
        let payload_start = offset + 12; // cmdType(1)+channelId(1)+cmdFlags(1)+reserved(1)+cmdLen(4)+seqNum(4)
        let payload_len = cmd_len.saturating_sub(12);

        if debug {
            println!("[CAP] cmd: type=0x{:02x} len={} payload_len={}", cmd_type, cmd_len, payload_len);
        }

        if payload_start + payload_len > raw.len() { break; }

        match cmd_type {
            6 | 7 | 0x0b => { // cmdSendReliable, cmdSendUnreliable, custom Albion
                let mut body_off = payload_start;
                let mut body_len = payload_len;

                if cmd_type == 7 || cmd_type == 0x0b { // unreliable: 4 extra bytes
                    if body_len < 4 { continue; }
                    body_off += 4;
                    body_len -= 4;
                }
                if body_len < 2 { continue; }
                body_off += 1; // skip signalByte
                let msg_type = raw[body_off];
                body_off += 1;
                body_len -= 2;

                if msg_type == 131 { continue; } // encrypted
                if msg_type != 2 && msg_type != 3 && msg_type != 4 && msg_type != 7 {
                    {
                        let hex = raw[body_off-2..body_off-2 + body_len.min(32.min(raw.len() - body_off + 2))]
                            .iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                        println!("[CAP] skip cmd_type={} msg_type={} sig={:02x} payload_hex={}", cmd_type, msg_type, raw[body_off-2], hex);
                    }
                    continue;
                }
                let mtype = if msg_type == 7 { 3 } else { msg_type };

                let body = raw[body_off..body_off + body_len.min(raw.len() - body_off)].to_vec();
                if body.is_empty() { continue; }
                let params = serialize_params_from_body(mtype, &body);
                let code = body[0];
                if code == 23 && debug {
                    let full_hex = body.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                    println!("[CAP] *** ATTACKSTART *** msg_type={} full_hex={}", mtype, full_hex);
                }
                if debug {
                    let hex = body.iter().take(16).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                    println!("[CAP] extracted msg_type={} code={} body_hex={} params_len={}", mtype, code, hex, params.len());
                }
                result.push((mtype, code, params));
            }
            0x01 => {
                // "simple" protocol — payload may be raw Photon message without standard framing
                // Format: [msgType:1][body...] (no signalByte)
                if debug {
                    let hex = raw[payload_start..payload_start + payload_len.min(32.min(raw.len() - payload_start))]
                        .iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                    println!("[CAP] cmd0x01 payload_len={} hex={}", payload_len, hex);
                }
                if payload_len < 2 { continue; }
                let msg_type = raw[payload_start];
                if msg_type == 131 { continue; } // encrypted
                if msg_type != 2 && msg_type != 3 && msg_type != 4 && msg_type != 7 { continue; }
                let mtype = if msg_type == 7 { 3 } else { msg_type };
                let body_start = payload_start + 1;
                let body = raw[body_start..body_start + (payload_len - 1).min(raw.len() - body_start)].to_vec();
                if body.is_empty() { continue; }
                let params = serialize_params_from_body(mtype, &body);
                let code = body[0];
                if debug {
                    let hex = body.iter().take(32).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                    println!("[CAP] cmd0x01 MATCH msg_type={} code={} body_hex={} params_len={}", mtype, code, hex, params.len());
                }
                result.push((mtype, code, params));
            }
            _ => {
                if debug {
                    let hex = raw[payload_start..payload_start + payload_len.min(32.min(raw.len() - payload_start))]
                        .iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                    println!("[CAP] cmd 0x{:02x} unknown (skip) payload_hex={}", cmd_type, hex);
                }
            }
        }
        offset = payload_start + payload_len;
    }
    result
}

pub fn broadcast_player_id() {
    let id = *PLAYER_ENTITY_ID.lock().unwrap();
    if id <= 0 { return; }
    let mut out = Vec::with_capacity(12);
    out.extend_from_slice(&[0, 0, 0, 0]); // src_ip = 0 (маркер системы)
    out.push(255); // type=255 = identity
    out.push(0);   // code=0
    out.extend_from_slice(&4u16.to_le_bytes()); // len=4
    out.extend_from_slice(&id.to_le_bytes());   // id
    use std::io::Write;
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        for client in clients.iter_mut() {
            let _ = client.write_all(&out);
        }
    }
    println!("[PLAYER] ID {} разослан клиентам", id);
}

/// Шлёт relay-клиентам запрос SETID (type=254). Windows AOR получает и отвечает SETID <id> на порт 4446.
pub fn request_player_id() {
    let mut out = Vec::with_capacity(8);
    out.extend_from_slice(&[0, 0, 0, 0]); // src_ip = 0
    out.push(254); // type=254 = request_id
    out.push(0);   // code=0
    out.extend_from_slice(&0u16.to_le_bytes()); // len=0
    use std::io::Write;
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        for client in clients.iter_mut() {
            let _ = client.write_all(&out);
        }
    }
    println!("[PLAYER] Запрос ID отправлен клиентам");
}

/// Шлёт relay-клиентам позицию мейна (type=5, code=0).
pub fn broadcast_main_position() {
    let eid = *PLAYER_ENTITY_ID.lock().unwrap();
    if eid <= 0 { return; }
    let (mx, my) = {
        let p = *MAIN_POS.lock().unwrap();
        if p == (0.0, 0.0) { *LAST_POS.lock().unwrap() } else { p }
    };
    let mut out = Vec::with_capacity(16);
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.push(5); out.push(0);
    out.extend_from_slice(&12u16.to_le_bytes());
    out.extend_from_slice(&mx.to_le_bytes());
    out.extend_from_slice(&my.to_le_bytes());
    out.extend_from_slice(&0f32.to_le_bytes()); // z=0
    use std::io::Write;
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        for client in clients.iter_mut() {
            let _ = client.write_all(&out);
        }
    }
}

/// Шлёт relay-клиентам позицию слейва (type=5, code=1).
pub fn broadcast_slave_position() {
    let sid = *SLAVE_ID.lock().unwrap();
    if sid <= 0 { return; }
    let (sx, sy) = *SLAVE_POS.lock().unwrap();
    let mut out = Vec::with_capacity(16);
    out.extend_from_slice(&[0, 0, 0, 0]); // src_ip
    out.push(5); out.push(1);              // type=5, code=1
    out.extend_from_slice(&12u16.to_le_bytes()); // len=12
    out.extend_from_slice(&sid.to_le_bytes());
    out.extend_from_slice(&sx.to_le_bytes());
    out.extend_from_slice(&sy.to_le_bytes());
    use std::io::Write;
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        for client in clients.iter_mut() {
            let _ = client.write_all(&out);
        }
    }
}

pub fn afk_start() {
    let mut proc = AFK_PROCESS.lock().unwrap();
    if proc.is_some() {
        println!("[AFK] уже запущен");
        return;
    }
    // Загружаем модуль aor_input если нужно
    if std::fs::metadata("/proc/aor_input").is_err() {
        let _ = Command::new("sudo")
            .args(["insmod", AOR_INPUT_KO])
            .output();
    }
    match Command::new(PYTHON)
        .arg(ANTI_AFK_PY)
        .env("DISPLAY", ":0")
        .env("XAUTHORITY", "/home/stas/.Xauthority")
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            println!("[AFK] запущен PID={}", pid);
            *proc = Some(child);
        }
        Err(e) => println!("[AFK] ошибка запуска: {}", e),
    }
}

pub fn afk_stop() {
    let mut proc = AFK_PROCESS.lock().unwrap();
    if let Some(mut child) = proc.take() {
        let pid = child.id();
        let _ = child.kill();
        let _ = child.wait();
        println!("[AFK] остановлен PID={}", pid);
    } else {
        println!("[AFK] не запущен");
    }
}

/// Выполняет команду и возвращает ответ. Вызывается из CMD-демона и из веб-панели.
pub fn execute_cmd(cmd: &str, pid: i32) -> String {
    let cmd = cmd.trim();
    if cmd.starts_with("SETID ") {
        let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
        if parts.len() == 2 {
            if let Ok(id) = parts[1].trim().parse::<i32>() {
                let mut current = PLAYER_ENTITY_ID.lock().unwrap();
                if id != 0 || *current == 0 {
                    *current = id;
                    println!("[CMD] ID игрока установлен: {}", id);
                    broadcast_player_id();
                    format!("OK ID={}", id)
                } else {
                    println!("[CMD] Игнорирую SETID 0 (уже есть ID={})", *current);
                    format!("OK IGNORE zero (current={})", *current)
                }
            } else {
                "ERR invalid id".to_string()
            }
        } else {
            "ERR need id".to_string()
        }
    } else if cmd == "SCANALL" {
        let result = crate::memory::find_player_entity_id(pid);
        if let Some((id, x, y, z, addr)) = result {
            *PLAYER_ENTITY_ID.lock().unwrap() = id;
            println!("[CMD] Авто-ID: {} pos=({:.1},{:.1},{:.1}) @ 0x{:x}", id, x, y, z, addr);
            broadcast_player_id();
            format!("OK ID={} POS=({:.1},{:.1},{:.1})", id, x, y, z)
        } else {
            "ERR not found".to_string()
        }
    } else if cmd.starts_with("SCANID ") {
        let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
        if parts.len() == 2 {
            if let Ok(id) = parts[1].trim().parse::<i32>() {
                crate::memory::scan_id_addrs(pid, id);
                format!("OK SCANID={}", id)
            } else {
                "ERR invalid id".to_string()
            }
        } else {
            "ERR need id".to_string()
        }
    } else if cmd.starts_with("SCANGASM ") {
        let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
        if parts.len() == 2 {
            if let Ok(id) = parts[1].trim().parse::<i32>() {
                let result = crate::memory::scan_module_for_id(pid, id, "GameAssembly.so");
                format!("OK SCANGASM={} found={}", id, result)
            } else {
                "ERR invalid id".to_string()
            }
        } else {
            "ERR need id".to_string()
        }
    } else if cmd.starts_with("FINDID ") {
        let parts: Vec<&str> = cmd.splitn(3, ' ').collect();
        if parts.len() == 3 {
            if let (Ok(old_id), Ok(new_id)) =
                (parts[1].trim().parse::<i32>(), parts[2].trim().parse::<i32>())
            {
                crate::memory::find_id_changed(pid, old_id, new_id);
                format!("OK FINDID {}→{}", old_id, new_id)
            } else {
                "ERR invalid ids".to_string()
            }
        } else {
            "ERR need: FINDID <old> <new>".to_string()
        }
    } else if cmd.starts_with("SETKEY ") {
        let keystr = cmd[7..].trim().replace(" ", "").replace("-", "");
        if keystr.len() == 16 {
            let mut key = [0u8; 8];
            let mut ok = true;
            for i in 0..8 {
                if let Ok(v) = u8::from_str_radix(&keystr[i*2..i*2+2], 16) {
                    key[i] = v;
                } else { ok = false; break; }
            }
            if ok {
                set_keysync(key);
                println!("[CMD] KeySync key set: {:02x?}", key);
                format!("OK KEY={}", keystr.to_uppercase())
            } else {
                "ERR invalid hex".to_string()
            }
        } else {
            "ERR key must be 16 hex chars".to_string()
        }
    } else if cmd.starts_with("SETNAME ") {
        let name = cmd[8..].trim().to_string();
        if !name.is_empty() {
            *PLAYER_NAME.lock().unwrap() = name.clone();
            println!("[CMD] Name set: {}", name);
            format!("OK NAME={}", name)
        } else {
            "ERR empty name".to_string()
        }
    } else if cmd == "STATUS" {
        let afk = AFK_PROCESS.lock().unwrap().is_some();
        format!("AFK={} RELAY=ON", if afk { "ON" } else { "OFF" })
    } else if cmd == "STATUS_JSON" {
        let clients = RELAY_CLIENTS.lock().map(|c| c.len()).unwrap_or(0);
        let eid = *PLAYER_ENTITY_ID.lock().unwrap();
        let sid = *SLAVE_ID.lock().unwrap();
        let captured = PACKET_CAPTURED.load(Ordering::Relaxed);
        let relayed = PACKET_RELAYED.load(Ordering::Relaxed);
        let afk = AFK_PROCESS.lock().unwrap().is_some();
        let ename = PLAYER_NAME.lock().unwrap().clone();
        let sname = SLAVE_NAME.lock().unwrap().clone();
        let (px, py) = LAST_POS.lock().map(|p| *p).unwrap_or((0.0, 0.0));
        let (sx, sy) = SLAVE_POS.lock().map(|p| *p).unwrap_or((0.0, 0.0));
        format!(r#"{{"running":true,"version":"v1.1","clients":{},"entity_id":{},"entity_name":"{}","slave":"{}","slave_id":{},"pos_x":{:.2},"pos_y":{:.2},"slave_x":{:.2},"slave_y":{:.2},"packets_captured":{},"packets_relayed":{},"afk":{}}}"#,
                clients, eid, ename.replace('"', "\\\""), sname.replace('"', "\\\""), sid, px, py, sx, sy, captured, relayed, if afk { "true" } else { "false" })
    } else if cmd == "AFK ON" {
        afk_start();
        "OK AFK ON".to_string()
    } else if cmd == "AFK OFF" {
        afk_stop();
        "OK AFK OFF".to_string()
    } else if cmd == "REQUESTID" {
        request_player_id();
        "OK REQUESTID".to_string()
    } else if cmd == "SHUTDOWN" {
        "OK SHUTDOWN".to_string()
    } else {
        format!("ERR unknown command: {}", cmd)
    }
}

pub fn start_command_daemon(running: Arc<std::sync::atomic::AtomicBool>, pid: i32) {
    let listener = TcpListener::bind("0.0.0.0:4446").unwrap();
    println!("[CMD] Демон команд на порту 4446");
    listener.set_nonblocking(true).ok();

    while running.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, addr)) => {
                println!("[CMD] Подключен AOR: {}", addr);
                let r = running.clone();
                thread::spawn(move || {
                    let mut reader = BufReader::new(&stream);
                    let mut writer = &stream;
                    loop {
                        let mut line = String::new();
                        match reader.read_line(&mut line) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }
                        let cmd = line.trim();
                        println!("[CMD] Получено: '{}'", cmd);
                        if cmd == "SHUTDOWN" {
                            let _ = writeln!(writer, "OK SHUTDOWN");
                            r.store(false, Ordering::Relaxed);
                            break;
                        }
                        let resp = execute_cmd(cmd, pid);
                        let _ = writeln!(writer, "{}", resp);
                    }
                    println!("[CMD] AOR отключен: {}", addr);
                });
            }
            Err(_) => {}
        }
        thread::sleep(Duration::from_millis(200));
    }
    println!("[CMD] Демон команд остановлен");
}


