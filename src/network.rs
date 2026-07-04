use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use once_cell::sync::Lazy;

use crate::memory::{find_all_collision_grids, SCANNED_ENEMIES};
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
pub static ENTITY_MOVES: Lazy<Mutex<Vec<(i32, f32, f32)>>> = Lazy::new(|| Mutex::new(Vec::new()));
pub static SCAN_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn relay_client_count() -> usize {
    RELAY_CLIENTS.lock().map(|c| c.len()).unwrap_or(0)
}

pub fn set_keysync(key: [u8; 8]) {
    if let Ok(mut k) = KEY_SYNC.lock() {
        *k = Some(key);
    } else {
        eprintln!("KEY_SYNC mutex poisoned in set_keysync");
    }
}

pub fn get_keysync() -> Option<[u8; 8]> {
    KEY_SYNC.lock().unwrap_or_else(|e| e.into_inner()).clone()
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
                            if let Ok(mut pos) = LAST_POS.lock() {
                                *pos = (x, y);
                            } else {
                                eprintln!("LAST_POS mutex poisoned in start_relay_server read loop");
                            }
                            if let Ok(mut p) = MAIN_POS.lock() {
                                *p = (x, y);
                            } else {
                                eprintln!("MAIN_POS mutex poisoned in start_relay_server read loop");
                            }
                            println!("[REL] Получены координаты: ({:.2}, {:.2}, {:.2})", x, y, z);
                            crate::memory::find_float_coords(pid, x, y, z);
                            // Шлём type=5 (Custom) всем relay клиентам
                            let mut out5 = Vec::with_capacity(12);
                            out5.extend_from_slice(&[0, 0, 0, 0]); // src_ip
                            out5.push(5);
                            out5.push(0); // type=5, code=0
                            out5.extend_from_slice(&12u16.to_le_bytes()); // len=12
                            out5.extend_from_slice(&coord_buf); // x,y,z
                            // Шлём позицию слейва если известна (type=5, code=1)
                            let slave_pkt = {
                                let sid = *SLAVE_ID.lock().unwrap_or_else(|e| e.into_inner());
                                if sid != 0 {
                                    let (sx, sy) = *SLAVE_POS.lock().unwrap_or_else(|e| e.into_inner());
                                    if sx != 0.0 || sy != 0.0 {
                                        let mut p = Vec::with_capacity(16);
                                        p.extend_from_slice(&[0, 0, 0, 0]); // src_ip
                                        p.push(5);
                                        p.push(1); // type=5, code=1
                                        p.extend_from_slice(&12u16.to_le_bytes()); // len=12
                                        p.extend_from_slice(&sid.to_le_bytes());
                                        p.extend_from_slice(&sx.to_le_bytes());
                                        p.extend_from_slice(&sy.to_le_bytes());
                                        Some(p)
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            };
                            if let Ok(mut clients) = RELAY_CLIENTS.lock() {
                                let mut i = 0;
                                while i < clients.len() {
                                    match clients[i].write_all(&out5) { // Changed to write_all
                                        Ok(()) => i += 1,
                                        Err(_) => {
                                            clients.remove(i);
                                        }
                                    }
                                }
                                if let Some(ref sp) = slave_pkt {
                                    let mut i = 0;
                                    while i < clients.len() {
                                        match clients[i].write_all(sp) { // Changed to write_all
                                            Ok(()) => i += 1,
                                            Err(_) => {
                                                clients.remove(i);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });

                    if let Ok(mut c) = RELAY_CLIENTS.lock() {
                        c.push(stream);
                    }
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
    // Таймаут 1с чтобы не виснуть на пустом трафике
    unsafe {
        let tv = libc::timeval { tv_sec: 1, tv_usec: 0 };
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_RCVTIMEO, &tv as *const _ as *const libc::c_void, std::mem::size_of::<libc::timeval>() as libc::socklen_t);
    }
    println!("[+] AF_PACKET сниффер запущен. Захват порта 5056...");

    let mut buf = [0u8; 65536];
    let mut err_count = 0u32;
    let mut pkt_count: u64 = 0;
    let mut last_report = std::time::Instant::now();
    while running.load(Ordering::Relaxed) {
        let n = unsafe { libc::recv(fd, buf.as_mut_ptr() as *mut _, buf.len(), 0) };
        if n <= 0 {
            err_count += 1;
            if err_count > 10 { thread::sleep(Duration::from_millis(50)); }
            continue;
        }
        err_count = 0;
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

            // C#-style logging — как в Program.cs
            {
                let params_str = crate::photon::format_params(param_bytes);
                match msg_type {
                    4 => { // event
                        let ev_name = if *code == 0x01 {
                            let game_code = crate::photon::read_param(param_bytes, 252).unwrap_or(0);
                            format!("{} (0x01)", crate::photon::event_name(game_code))
                        } else {
                            crate::photon::event_name(*code as i32).to_string()
                        };
                        if pkt_count <= 300 || *code == 3 || *code == 0x01 {
                            println!("[{:>5}] {}{}", pkt_count, ev_name, params_str);
                        }
                    }
                    2 => { // request
                        if pkt_count <= 200 || *code == 22 {
                            println!("[REQ {}] op=0x{:02x}{}", pkt_count, code, params_str);
                        }
                    }
                    3 => { // response
                        let ret = crate::photon::read_param(param_bytes, 253).unwrap_or(0);
                        if pkt_count <= 200 {
                            println!("[RES {}] op=0x{:02x} ret={}{}", pkt_count, code, ret, params_str);
                        }
                    }
                    _ => {
                        if pkt_count <= 100 {
                            println!("[CAP {}] type={} code={}{}", pkt_count, msg_type, code, params_str);
                        }
                    }
                }
            }

            // ChangeCluster (code=35)
            if *msg_type == 3 && *code == 35 {
                println!("[CAP] ChangeCluster обнаружен");
            }

            // KeySync — сохраняем ключ расшифровки позиций
            // post_process_event не вызывается для сырых байт, поэтому param[252] отсутствует.
            // Проверяем напрямую: KeySync приходит как event с param[0] = Bytes[8].
            if *msg_type == 4 && *code != 3 {
                if let Some(key) = crate::photon::read_keysync_params(param_bytes) {
                    if let Ok(mut k) = KEY_SYNC.lock() {
                        println!("[KS] KeySync ключ: {:02x?}", key);
                        *k = Some(key);
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
                        if let Ok(mut p) = LAST_POS.lock() { *p = (mx, my); }
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
                    // Фильтр: позиция в разумных пределах карты
                    if !mx.is_finite() || !my.is_finite() || mx.abs() > 50000.0 || my.abs() > 50000.0 {
                        continue;
                    }
                    let main_id = *PLAYER_ENTITY_ID.lock().unwrap();
                    if main_id == 0 {
                        // Авто-определение игрока: первый Move с реальными координатами
                        if let Ok(mut pid) = PLAYER_ENTITY_ID.lock() { *pid = eid; }
                        if let Ok(mut p) = MAIN_POS.lock() { *p = (mx, my); }
                        if let Ok(mut p) = LAST_POS.lock() { *p = (mx, my); }
                        println!("[CAP] *** AUTO-PLAYER ID={} pos=({:.1},{:.1})", eid, mx, my);
                        broadcast_main_position();
                    } else if eid == main_id {
                        if let Ok(mut p) = MAIN_POS.lock() { *p = (mx, my); }
                        if let Ok(mut p) = LAST_POS.lock() { *p = (mx, my); }
                        broadcast_main_position();
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
                        } else {
                            drop(slave);
                            if let Ok(mut em) = ENTITY_MOVES.lock() {
                                em.push((eid, mx, my));
                            }
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
                let mut params = serialize_params_from_body(mtype, &body);
                let code = body[0];
                // Post-process event params like C# EventProcessor.PostProcessEvent
                if mtype == 4 {
                    let pp = crate::photon::post_process_event_params(&params, code);
                    if pp != vec![0u8] { params = pp; }
                }
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
                let mut params = serialize_params_from_body(mtype, &body);
                let code = body[0];
                // Post-process event params like C# EventProcessor.PostProcessEvent
                if mtype == 4 {
                    let pp = crate::photon::post_process_event_params(&params, code);
                    if pp != vec![0u8] { params = pp; }
                }
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
    let id = *PLAYER_ENTITY_ID.lock().unwrap_or_else(|e| e.into_inner());
    if id <= 0 {
        return;
    }
    let mut out = Vec::with_capacity(12);
    out.extend_from_slice(&[0, 0, 0, 0]); // src_ip = 0 (маркер системы)
    out.push(255); // type=255 = identity
    out.push(0); // code=0
    out.extend_from_slice(&4u16.to_le_bytes()); // len=4
    out.extend_from_slice(&id.to_le_bytes()); // id
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        let mut i = 0;
        while i < clients.len() {
            match clients[i].write_all(&out) {
                Ok(()) => i += 1,
                Err(_) => {
                    clients.remove(i);
                }
            }
        }
    }
    println!("[PLAYER] ID {} разослан клиентам", id);
}

/// Шлёт relay-клиентам запрос SETID (type=254). Windows AOR получает и отвечает SETID <id> на порт 4446.
pub fn request_player_id() {
    let mut out = Vec::with_capacity(8);
    out.extend_from_slice(&[0, 0, 0, 0]); // src_ip = 0
    out.push(254); // type=254 = request_id
    out.push(0); // code=0
    out.extend_from_slice(&0u16.to_le_bytes()); // len=0
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        let mut i = 0;
        while i < clients.len() {
            match clients[i].write_all(&out) {
                Ok(()) => i += 1,
                Err(_) => {
                    clients.remove(i);
                }
            }
        }
    }
    println!("[PLAYER] Запрос ID отправлен клиентам");
}

/// Шлёт relay-клиентам позицию мейна (type=5, code=0).
pub fn broadcast_main_position() {
    let eid = *PLAYER_ENTITY_ID.lock().unwrap_or_else(|e| e.into_inner());
    if eid <= 0 {
        return;
    }
    let (mx, my) = {
        let main_pos_guard = MAIN_POS.lock().unwrap_or_else(|e| e.into_inner());
        if *main_pos_guard == (0.0, 0.0) {
            *LAST_POS.lock().unwrap_or_else(|e| e.into_inner())
        } else {
            *main_pos_guard
        }
    };
    let mut out = Vec::with_capacity(16);
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.push(5);
    out.push(0);
    out.extend_from_slice(&12u16.to_le_bytes());
    out.extend_from_slice(&mx.to_le_bytes());
    out.extend_from_slice(&my.to_le_bytes());
    out.extend_from_slice(&0f32.to_le_bytes()); // z=0
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        let mut i = 0;
        while i < clients.len() {
            match clients[i].write_all(&out) {
                Ok(()) => i += 1,
                Err(_) => {
                    clients.remove(i);
                }
            }
        }
    }
}

/// Шлёт relay-клиентам позицию слейва (type=5, code=1).
pub fn broadcast_slave_position() {
    let sid = *SLAVE_ID.lock().unwrap_or_else(|e| e.into_inner());
    if sid <= 0 {
        return;
    }
    let (sx, sy) = *SLAVE_POS.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::with_capacity(16);
    out.extend_from_slice(&[0, 0, 0, 0]); // src_ip
    out.push(5);
    out.push(1); // type=5, code=1
    out.extend_from_slice(&12u16.to_le_bytes()); // len=12
    out.extend_from_slice(&sid.to_le_bytes());
    out.extend_from_slice(&sx.to_le_bytes());
    out.extend_from_slice(&sy.to_le_bytes());
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        let mut i = 0;
        while i < clients.len() {
            match clients[i].write_all(&out) {
                Ok(()) => i += 1,
                Err(_) => {
                    clients.remove(i);
                }
            }
        }
    }
}

/// Шлёт relay-клиентам все ближайшие сущности (type=5, code=2)
pub fn broadcast_filtered_entities() {
    let em = ENTITY_MOVES.lock().unwrap_or_else(|e| e.into_inner());
    let entries: Vec<(i32, f32, f32)> = em.iter().copied().collect();
    drop(em);
    if entries.is_empty() {
        return;
    }
    let mut out = Vec::with_capacity(8 + entries.len() * 12);
    out.extend_from_slice(&[0, 0, 0, 0]); // src_ip
    out.push(5);
    out.push(2); // type=5, code=2
    let body_len = (entries.len() * 12) as u16;
    out.extend_from_slice(&body_len.to_le_bytes());
    for (id, x, y) in &entries {
        out.extend_from_slice(&id.to_le_bytes());
        out.extend_from_slice(&x.to_le_bytes());
        out.extend_from_slice(&y.to_le_bytes());
    }
    if let Ok(mut clients) = RELAY_CLIENTS.lock() {
        let mut i = 0;
        while i < clients.len() {
            match clients[i].write_all(&out) {
                Ok(()) => i += 1,
                Err(_) => {
                    clients.remove(i);
                }
            }
        }
    }
}

/// Фоновый цикл: 4 раза в секунду фильтрует кандидатов (≤20м от MAIN_POS) и шлёт на relay
pub fn auto_filter_loop(running: Arc<std::sync::atomic::AtomicBool>) {
    while running.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(250));
        if !SCAN_ACTIVE.load(Ordering::Relaxed) { continue; }
        let (mx, my) = {
            let main_pos_guard = MAIN_POS.lock().unwrap_or_else(|e| e.into_inner());
            if *main_pos_guard == (0.0, 0.0) {
                *LAST_POS.lock().unwrap_or_else(|e| e.into_inner())
            } else {
                *main_pos_guard
            }
        };
        if mx == 0.0 && my == 0.0 { continue; }
        let near = crate::memory::filter_nearby_positions(mx, my, 20.0);
        if near.is_empty() { continue; }
        if let Ok(mut em) = ENTITY_MOVES.lock() {
            em.clear();
            for (id, x, y) in &near {
                em.push((*id, *x, *y));
            }
        }
        broadcast_filtered_entities();
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
                if let Ok(mut current) = PLAYER_ENTITY_ID.lock() {
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
                    eprintln!("PLAYER_ENTITY_ID mutex poisoned in SETID command");
                    "ERR internal error".to_string()
                }
            } else {
                "ERR invalid id".to_string()
            }
        } else {
            "ERR need id".to_string()
        }
    } else if cmd == "SCANALL" {
        let candidates = crate::memory::find_candidate_positions(pid);
        let count = candidates.len();
        println!("[CMD] SCANALL: найдено {} кандидатов, сканирование активно", count);
        SCAN_ACTIVE.store(true, Ordering::Relaxed);
        format!("OK SCANALL {} candidates scan_active", count)
    } else if cmd.starts_with("SCANID ") {
        let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
        if parts.len() == 2 {
            if let Ok(id) = parts[1].trim().parse::<i32>() {
                let addrs = crate::memory::scan_id_addrs(pid, id);
                for a in addrs.iter().take(10) {
                    println!("[SCANID] ID={} found at 0x{:x}", id, a);
                }
                format!("OK SCANID={} found={}", id, addrs.len())
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
        let (px, py) = { let p = *MAIN_POS.lock().unwrap_or_else(|e| e.into_inner()); if p == (0.0,0.0) { *LAST_POS.lock().unwrap_or_else(|e| e.into_inner()) } else { p } };
        let (sx, sy) = SLAVE_POS.lock().map(|p| *p).unwrap_or((0.0, 0.0));
        let mut seen = std::collections::HashSet::new();
        let mut entities_json = String::new();
        // Сначала coord-сущности (Mtest стиль, фоновый скан)
        if let Ok(scanned) = SCANNED_ENEMIES.lock() {
            for &(id, x, y, go, kl) in scanned.iter() {
                if seen.insert(id) {
                    if !entities_json.is_empty() { entities_json.push(','); }
                    entities_json.push_str(&format!(r#"{{"id":{},"x":{:.2},"y":{:.2},"mc":"0x{:x}"}}"#, id, x, y, go));
                }
            }
        }
        // Потом MOVE сущности (перезаписывают heap, если есть коллизия)
        if let Ok(em) = ENTITY_MOVES.lock() {
            for (id, x, y) in em.iter() {
                if seen.insert(*id) {
                    if !entities_json.is_empty() { entities_json.push(','); }
                    entities_json.push_str(&format!(r#"{{"id":{},"x":{:.2},"y":{:.2},"mc":"-"}}"#, id, x, y));
                }
            }
        }
        let scanned = crate::memory::SCANNED_CANDIDATES.lock().map(|s| s.len()).unwrap_or(0);
        format!(r#"{{"running":true,"version":"v1.1","clients":{},"entity_id":{},"entity_name":"{}","slave":"{}","slave_id":{},"pos_x":{:.2},"pos_y":{:.2},"slave_x":{:.2},"slave_y":{:.2},"packets_captured":{},"packets_relayed":{},"afk":{},"scanned":{},"entities":[{}]}}"#,
                clients, eid, ename.replace('"', "\\\""), sname.replace('"', "\\\""), sid, px, py, sx, sy, captured, relayed, if afk { "true" } else { "false" }, scanned, entities_json)
    } else if cmd == "AFK ON" {
        afk_start();
        "OK AFK ON".to_string()
    } else if cmd == "AFK OFF" {
        afk_stop();
        "OK AFK OFF".to_string()
    } else if cmd == "REQUESTID" {
        request_player_id();
        "OK REQUESTID".to_string()
    } else if cmd == "SCANSTOP" {
        SCAN_ACTIVE.store(false, Ordering::Relaxed);
        if let Ok(mut em) = ENTITY_MOVES.lock() { em.clear(); }
        println!("[CMD] SCANSTOP: сканирование остановлено");
        "OK SCANSTOP".to_string()
    } else if cmd.starts_with("SETPOS ") {
        let args = cmd[7..].trim();
        let parts: Vec<&str> = args.split(|c| c == ' ' || c == ',').collect();
        if parts.len() >= 2 {
            if let (Ok(x), Ok(y)) = (parts[0].parse::<f32>(), parts[1].parse::<f32>()) {
                if let Ok(mut p) = MAIN_POS.lock() { *p = (x, y); }
                if let Ok(mut p) = LAST_POS.lock() { *p = (x, y); }
                println!("[CMD] SETPOS ({:.2},{:.2})", x, y);
                format!("OK SETPOS ({:.2},{:.2})", x, y)
            } else {
                "ERR bad coords".to_string()
            }
        } else {
            "ERR need x y".to_string()
        }
    } else if cmd == "SHUTDOWN" {
        "OK SHUTDOWN".to_string()
    } else {
        format!("ERR unknown command: {}", cmd)
    }
}

/// Статус сервер на порту 4447 (используется AOR_web для STATUS_JSON)
pub fn start_status_server(running: Arc<std::sync::atomic::AtomicBool>, pid: i32) {
    let listener = match TcpListener::bind("127.0.0.1:4447") {
        Ok(l) => l,
        Err(e) => { println!("[CMD] не удалось биндить 4447: {}", e); return; }
    };
    println!("[CMD] Статус сервер на порту 4447");
    listener.set_nonblocking(true).ok();
    while running.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, addr)) => {
                println!("[CMD] Подключен клиент к статусу: {}", addr);
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
                        if cmd.is_empty() { continue; }
                        let resp = execute_cmd(cmd, pid);
                        let _ = writeln!(writer, "{}", resp);
                    }
                });
            }
            Err(_) => {}
        }
        thread::sleep(Duration::from_millis(200));
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


