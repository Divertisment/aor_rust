use std::collections::HashMap;
use std::fs::{read_to_string, File};
use std::io::{BufRead, BufReader, Read, Write, stdout};
use std::path::Path;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static ENTITY_ADDRS: Mutex<Vec<u64>> = Mutex::new(Vec::new());
static COORD_TRACKER: Lazy<Mutex<HashMap<u64, (f32, f32, bool)>>> = Lazy::new(|| Mutex::new(HashMap::new()));
pub static SCANNED_ENEMIES: Lazy<Mutex<Vec<(i32, f32, f32, u64, u64)>>> = Lazy::new(|| Mutex::new(Vec::new()));
static GOM_ADDR: Mutex<u64> = Mutex::new(0);
pub static SCANNED_CANDIDATES: Lazy<Mutex<Vec<(f32, f32, f32, u64)>>> = Lazy::new(|| Mutex::new(Vec::new()));

fn find_gom_address(pid: i32) -> Option<u64> {
    let maps = std::fs::read_to_string(format!("/proc/{}/maps", pid)).ok()?;
    let mut unity_base = 0u64;
    let mut unity_size = 0u64;
    for line in maps.lines() {
        if line.contains("UnityPlayer.so") && line.contains("r-xp") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let range: Vec<&str> = parts[0].split('-').collect();
            unity_base = u64::from_str_radix(range[0], 16).ok()?;
            unity_size = u64::from_str_radix(range[1], 16).ok()? - unity_base;
            break;
        }
    }
    if unity_base == 0 { return None; }
    const FIND_OBJECTS_TYPE_IMPL_OFFSET: u64 = 0x9EAB80;
    let fn_addr = unity_base + FIND_OBJECTS_TYPE_IMPL_OFFSET;
    let mut code = [0u8; 0x200];
    if !read_process_memory(pid, fn_addr, &mut code) { return None; }
    for i in 0..code.len().saturating_sub(7) {
        if code[i] == 0x48 && (code[i+1] == 0x8D || code[i+1] == 0x8B) && code[i+2] == 0x05 {
            let disp = i32::from_le_bytes(code[i+3..i+7].try_into().unwrap()) as i64;
            let rip = (fn_addr + i as u64 + 7) as i64;
            let target = (rip + disp) as u64;
            if target > 0x10000 && target < 0x800000000000 {
                return Some(target);
            }
        }
    }
    None
}

fn walk_gom_entities(pid: i32, gom: u64) -> Vec<(i32, f32, f32, u64, u64)> {
    let mut entities = Vec::new();
    let mut sb = [0u8; 16];
    if !read_process_memory(pid, gom + 0x18, &mut sb) { return entities; }
    let sentinel_next = u64::from_le_bytes(sb[8..16].try_into().unwrap());
    if sentinel_next == gom + 0x18 { return entities; }
    let mut node = sentinel_next;
    let mut count = 0;
    while node != gom + 0x18 && count < 500 && entities.len() < 200 {
        count += 1;
        let game_obj = node - 0x68;
        let mut gob = [0u8; 0x80];
        if !read_process_memory(pid, game_obj, &mut gob) { break; }
        let klass = u64::from_le_bytes(gob[0x00..0x08].try_into().unwrap());
        let transform_ptr = u64::from_le_bytes(gob[0x10..0x18].try_into().unwrap());
        let mut entity_id = 0i32;
        let mut pos_x = 0.0f32;
        let mut pos_y = 0.0f32;
        let mut have_pos = false;
        if transform_ptr >= 0x700000000000 && transform_ptr <= 0x800000000000 {
            let mut tb = [0u8; 0xA0];
            if read_process_memory(pid, transform_ptr, &mut tb) {
                for off in (0x38..0x98).step_by(4) {
                    if off + 8 > tb.len() { break; }
                    let x = f32::from_le_bytes(tb[off..off+4].try_into().unwrap());
                    let y = f32::from_le_bytes(tb[off+4..off+8].try_into().unwrap());
                    if x.is_finite() && y.is_finite() && x.abs() > 0.5 && x.abs() < 20000.0 && y.abs() > 0.5 && y.abs() < 20000.0 {
                        pos_x = x; pos_y = y; have_pos = true; break;
                    }
                }
            }
        }
        if have_pos {
            for off in (0x20..0x70).step_by(4) {
                if off + 4 > gob.len() { break; }
                let val = i32::from_le_bytes(gob[off..off+4].try_into().unwrap());
                if val > 100_000 && val < 50_000_000 { entity_id = val; break; }
            }
            if entity_id == 0 {
                let scan_addr = game_obj.saturating_sub(128);
                let mut sd = [0u8; 256];
                if read_process_memory(pid, scan_addr, &mut sd) {
                    let rel_off = (game_obj - scan_addr) as usize;
                    for i in (0..=rel_off).step_by(4) {
                        if i + 4 > sd.len() { break; }
                        let val = i32::from_le_bytes(sd[i..i+4].try_into().unwrap());
                        if val > 100_000 && val < 50_000_000 { entity_id = val; break; }
                    }
                }
            }
            if entity_id != 0 { entities.push((entity_id, pos_x, pos_y, game_obj, klass)); }
        }
        let ln_next = u64::from_le_bytes(gob[0x70..0x78].try_into().unwrap());
        if ln_next == node { break; }
        node = ln_next;
    }
    entities
}

pub fn start_enemy_scanner(pid: i32) {
    std::thread::spawn(move || {
        loop {
            if *GOM_ADDR.lock().unwrap() == 0 {
                if let Some(gom) = find_gom_address(pid) {
                    *GOM_ADDR.lock().unwrap() = gom;
                    println!("[SCAN] GOM found at 0x{:x}", gom);
                } else {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    continue;
                }
            }
            let gom = *GOM_ADDR.lock().unwrap();
            if let Ok(mut e) = SCANNED_ENEMIES.lock() {
                *e = walk_gom_entities(pid, gom);
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    });
}

#[derive(Debug, Clone)]
pub struct CollisionGrid {
    pub chunk_x: i32,
    pub chunk_z: i32,
    pub world_pos_x: f32,
    pub world_pos_y: f32,
    pub width: i32,
    pub height: i32,
    pub raw_matrix: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct MemoryRange {
    pub start: u64,
    pub end: u64,
}

const KMOD_PATH: &str = "/proc/aor_mem";

pub fn read_process_memory(pid: i32, addr: u64, buf: &mut [u8]) -> bool {
    // 1) kernel module /proc/aor_mem
    if let Ok(mut f) = File::options().write(true).read(true).open(KMOD_PATH) {
        let req = format!("{} {:x} {}\n", pid, addr, buf.len());
        if f.write_all(req.as_bytes()).is_ok() {
            let mut total = 0;
            while total < buf.len() {
                match f.read(&mut buf[total..]) {
                    Ok(0) => break,
                    Ok(n) => total += n,
                    Err(_) => break,
                }
            }
            if total == buf.len() { return true; }
        }
    }
    // 2) process_vm_readv fallback
    unsafe {
        let local = libc::iovec {
            iov_base: buf.as_mut_ptr() as *mut _,
            iov_len: buf.len(),
        };
        let remote = libc::iovec {
            iov_base: addr as *mut libc::c_void,
            iov_len: buf.len(),
        };
        let ret = libc::process_vm_readv(
            pid as libc::pid_t,
            &local as *const libc::iovec,
            1,
            &remote as *const libc::iovec,
            1,
            0,
        );
        if ret < 0 {
            false
        } else {
            ret as usize == buf.len()
        }
    }
}

pub fn kmod_read_memory(pid: i32, addr: u64, buf: &mut [u8]) -> bool {
    let mut file = match File::options().write(true).read(true).open(KMOD_PATH) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let req = format!("{} {:x} {}\n", pid, addr, buf.len());
    if file.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut total_read = 0;
    while total_read < buf.len() {
        match file.read(&mut buf[total_read..]) {
            Ok(0) => break,
            Ok(n) => total_read += n,
            Err(_) => return false,
        }
    }
    total_read == buf.len()
}

pub fn find_float_coords(pid: i32, x: f32, y: f32, z: f32) {
    let xb = x.to_le_bytes();
    let yb = y.to_le_bytes();
    let zb = z.to_le_bytes();
    let pattern: Vec<u8> = xb.iter().chain(yb.iter()).chain(zb.iter()).copied().collect();

    println!("[MEM] Ищем координаты ({:.1}, {:.1}, {:.1}) в памяти PID={}", x, y, z, pid);
    let ranges = get_anonymous_rw_ranges(pid);
    let mut found = 0;

    for range in &ranges {
        let size = (range.end - range.start) as usize;
        if size < 12 || size > 256 * 1024 * 1024 { continue; }
        if size > 10 * 1024 * 1024 {
            let mut addr = range.start;
            while addr < range.end {
                let remaining = (range.end - addr) as usize;
                let chunk = if remaining > 1024 * 1024 { 1024 * 1024 } else { remaining };
                let mut buf = vec![0u8; chunk];
                if read_process_memory(pid, addr, &mut buf) {
                    for &off in &memmem(&buf, &pattern) {
                        let coord_addr = addr + off as u64;
                        // читаем i32 перед координатами (на смещениях -4, -8, -12)
                        check_id_before_coords(pid, coord_addr, x, y);
                        found += 1;
                    }
                }
                addr += (chunk as u64).saturating_sub(12);
                if found >= 20 { break; }
            }
        } else {
            let mut buf = vec![0u8; size];
            if read_process_memory(pid, range.start, &mut buf) {
                for &off in &memmem(&buf, &pattern) {
                    let coord_addr = range.start + off as u64;
                    check_id_before_coords(pid, coord_addr, x, y);
                    found += 1;
                    if found >= 20 { break; }
                }
            }
        }
        if found >= 20 { break; }
    }
    if found == 0 {
        println!("[MEM] Координаты не найдены (возможно, другой кластер)");
    }
}

fn check_id_before_coords(pid: i32, coord_addr: u64, x: f32, y: f32) {
    for delta in [4, 8, 12, 16] {
        if coord_addr < delta as u64 { continue; }
        let id_addr = coord_addr - delta;
        let mut id_buf = [0u8; 4];
        if !read_process_memory(pid, id_addr, &mut id_buf) { continue; }
        let id = i32::from_le_bytes(id_buf);
        if id > 0 && id < 99999 {
            let mut ctx = [0u8; 128];
            let ctx_addr = if id_addr >= 64 { id_addr - 64 } else { 0 };
            if ctx_addr > 0 && read_process_memory(pid, ctx_addr, &mut ctx) {
                let off = (id_addr - ctx_addr) as usize;
                let ctx_hex: Vec<String> = ctx.iter().map(|b| format!("{:02x}", b)).collect();
                println!("[MEM] Коорды @ 0x{:x} ID={} delta=-{} ctx[0x{:x}]: {}", coord_addr, id, delta, ctx_addr, ctx_hex.join(" "));
                // Ищем ID=533 во всём контексте
                let target = 533i32.to_le_bytes();
                for j in 0..ctx.len().saturating_sub(4) {
                    let v = i32::from_le_bytes(ctx[j..j+4].try_into().unwrap());
                    if v == 533 {
                        println!("[MEM]   >>> ID 533 НАЙДЕН в ctx на смещении {}!", j);
                    }
                }
                dump_entity_context(pid, id_addr, id);
            } else {
                println!("[MEM] Коорды @ 0x{:x} ID={} delta=-{}", coord_addr, id, delta);
            }
        }
    }
}

/// После нахождения координат и ID — устанавливаем ID игрока
pub fn set_id_from_coords(pid: i32, target_id: i32) {
    println!("[MEM] Устанавливаю ID={} (найден по координатам)", target_id);
    *crate::network::PLAYER_ENTITY_ID.lock().unwrap() = target_id;
    crate::network::broadcast_player_id();
}

pub fn find_albion_pid() -> Option<i32> {
    let proc_dir = Path::new("/proc");
    if let Ok(entries) = proc_dir.read_dir() {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(pid_str) = path.file_name().and_then(|s| s.to_str()) {
                    if pid_str.chars().all(|c| c.is_numeric()) {
                        if let Ok(comm) = read_to_string(path.join("comm")) {
                            let name = comm.trim();
                            if name.contains("Albion") || name.contains("Client") {
                                if let Ok(pid) = pid_str.parse::<i32>() {
                                    if let Ok(status) = read_to_string(path.join("status")) {
                                        if status.lines().any(|l| l.starts_with("State:") && l.contains("Z")) {
                                            println!("[MEM] skip zombie PID={}", pid);
                                            continue;
                                        }
                                    }
                                    return Some(pid);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn get_module_base_address(pid: i32, module_name: &str) -> Option<u64> {
    let maps_path = format!("/proc/{}/maps", pid);
    let file = File::open(maps_path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().flatten() {
        if line.contains(module_name) {
            if let Some(first_part) = line.split_whitespace().next() {
                if let Some(addr_str) = first_part.split('-').next() {
                    if let Ok(base_addr) = u64::from_str_radix(addr_str, 16) {
                        return Some(base_addr);
                    }
                }
            }
        }
    }
    None
}

/// Ищет в куче managed-объекты с entity_id и позицией.
/// Сканирует анонимные rw-p регионы на предмет сущностей Albion.
pub fn scan_heap_entities(pid: i32) -> Vec<(i32, f32, f32)> {
    let ranges = get_anonymous_rw_ranges(pid);
    let mut entities = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for range in &ranges {
        let size = (range.end - range.start) as usize;
        if size < 0x30 || size > 100 * 1024 * 1024 { continue; }
        if range.start < 0x720000000000 { continue; }
        if range.start > 0x730000000000 { continue; }

        let max_read = size.min(10 * 1024 * 1024);
        let mut addr = range.start;
        while addr < range.start + max_read as u64 {
            let remaining = (range.start + max_read as u64 - addr) as usize;
            let chunk_size = remaining.min(1024 * 1024);
            let mut buf = vec![0u8; chunk_size];
            if !read_process_memory(pid, addr, &mut buf) {
                addr += chunk_size as u64;
                continue;
            }

            // Ищем паттерн: [vtable/klass в GameAssembly][monitor=0][entity_id][pos_x][pos_y]
            for off in (0..chunk_size.saturating_sub(32)).step_by(4) {
                let klass_or_vt = u64::from_le_bytes(buf[off..off+8].try_into().unwrap());
                // klass/vtable должен быть в GameAssembly rw-p (0x72bc4040xxxx) или metadata (0x2d...)
                let is_gameassembly_ptr = (0x72bc40400000..0x72bc40600000).contains(&klass_or_vt);
                let is_metadata_ptr = (0x2d0000000000..0x300000000000).contains(&klass_or_vt);
                if !is_gameassembly_ptr && !is_metadata_ptr { continue; }

                let monitor = u64::from_le_bytes(buf[off+8..off+16].try_into().unwrap());
                if monitor != 0 { continue; }

                // Пробуем entity_id как i64 на смещении +0x10
                let entity_id = i64::from_le_bytes(buf[off+16..off+24].try_into().unwrap()) as i32;
                if entity_id < 100_000 || entity_id > 20_000_000 { continue; }
                if seen_ids.contains(&entity_id) { continue; }

                // Ищем позицию в диапазоне +0x18..+0x30 от объекта
                for pos_off in [0x18usize, 0x20, 0x28] {
                    if off + pos_off + 8 > chunk_size { continue; }
                    let x = f32::from_le_bytes(buf[off+pos_off..off+pos_off+4].try_into().unwrap());
                    let y = f32::from_le_bytes(buf[off+pos_off+4..off+pos_off+8].try_into().unwrap());
                    if x.is_finite() && y.is_finite() && x.abs() < 50000.0 && y.abs() < 50000.0
                        && (x.abs() > 0.1 || y.abs() > 0.1)
                    {
                        entities.push((entity_id, x, y));
                        seen_ids.insert(entity_id);
                        break;
                    }
                }
                if entities.len() >= 200 { break; }
            }
            addr += chunk_size as u64;
            if entities.len() >= 200 { break; }
        }
        if entities.len() >= 200 { break; }
    }
    entities
}

pub fn get_anonymous_rw_ranges(pid: i32) -> Vec<MemoryRange> {
    let maps_path = format!("/proc/{}/maps", pid);
    let file = match File::open(&maps_path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);
    let mut ranges = Vec::new();
    for line in reader.lines().flatten() {
        if !line.contains("rw-p") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        let range_str = parts[0];
        if let Some((start_str, end_str)) = range_str.split_once('-') {
            if let (Ok(start), Ok(end)) =
                (u64::from_str_radix(start_str, 16), u64::from_str_radix(end_str, 16))
            {
                ranges.push(MemoryRange { start, end });
            }
        }
    }
    ranges
}

pub fn get_module_rw_range(pid: i32, module_name: &str) -> Option<MemoryRange> {
    let maps_path = format!("/proc/{}/maps", pid);
    let file = File::open(maps_path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().flatten() {
        if !line.contains(module_name) || !line.contains("rw-p") { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(range_str) = parts.get(0) {
            if let (Some(start_str), Some(end_str)) = (range_str.split('-').nth(0), range_str.split('-').nth(1)) {
                if let (Ok(start), Ok(end)) = (u64::from_str_radix(start_str, 16), u64::from_str_radix(end_str, 16)) {
                    return Some(MemoryRange { start, end });
                }
            }
        }
    }
    None
}

/// Сканирует rw-p сегмент модуля (обычно .data/.bss) на наличие entity_id.
/// Возвращает количество найденных вхождений.
pub fn scan_module_for_id(pid: i32, target_id: i32, module_name: &str) -> usize {
    let Some(range) = get_module_rw_range(pid, module_name) else {
        println!("[MEM] Сегмент rw-p для '{}' не найден", module_name);
        return 0;
    };
    let base = get_module_base_address(pid, module_name).unwrap_or(0);
    let size = (range.end - range.start) as usize;
    if size < 4 || size > 50 * 1024 * 1024 {
        println!("[MEM] Сегмент rw-p {} размер {} — пропускаю", module_name, size);
        return 0;
    }
    println!("[MEM] Сканирую {} rw-p: 0x{:x}-0x{:x} ({} MB)...", module_name, range.start, range.end, size / 1024 / 1024);
    let pattern = target_id.to_le_bytes();
    let mut buf = vec![0u8; size];
    if !read_process_memory(pid, range.start, &mut buf) {
        println!("[MEM] Не могу прочитать {} rw-p", module_name);
        return 0;
    }
    let mut count = 0;
    for &off in &memmem(&buf, &pattern) {
        let addr = range.start + off as u64;
        let offset_from_base = addr - base;
        println!("[MEM] ID {} НАЙДЕН в {} по адресу 0x{:x} ({} + 0x{:x})",
                 target_id, module_name, addr, module_name, offset_from_base);
        dump_entity_context(pid, addr, target_id);
        count += 1;
    }
    if count == 0 {
        println!("[MEM] ID {} не найден в {} rw-p", target_id, module_name);
    }
    count
}

fn memmem(data: &[u8], needle: &[u8]) -> Vec<usize> {
    let mut positions = Vec::new();
    if needle.is_empty() || needle.len() > data.len() {
        return positions;
    }
    for i in 0..=data.len() - needle.len() {
        if &data[i..i + needle.len()] == needle {
            positions.push(i);
        }
    }
    positions
}

pub unsafe fn scan_for_string(pid: i32, range: &MemoryRange, target: &str) -> Vec<u64> {
    let target_utf16: Vec<u16> = target.encode_utf16().collect();
    let target_bytes: Vec<u8> = target_utf16
        .iter()
        .flat_map(|&c| c.to_le_bytes().to_vec())
        .collect();

    let mut results = Vec::new();
    let chunk_size: usize = 245760;
    let scan_start = range.start;
    let scan_end = range.end;

    let mut addr = scan_start;
    while addr < scan_end {
        let remaining = (scan_end - addr) as usize;
        let buf_size = if remaining < chunk_size { remaining } else { chunk_size };
        let mut buf = vec![0u8; buf_size];
        if !kmod_read_memory(pid, addr, &mut buf) {
            addr += 0x10000;
            continue;
        }

        let buf_len = buf.len();
        if buf_len < 24 {
            addr += buf_size as u64;
            continue;
        }

        let matches = memmem(&buf, &target_bytes);
        for &pos in &matches {
            if pos < 4 || pos + target_bytes.len() > buf_len {
                continue;
            }
            let length_offset = pos - 4;
            if length_offset < 16 {
                continue;
            }
            let length_bytes = &buf[length_offset..length_offset + 4];
            let str_len = u32::from_le_bytes(length_bytes.try_into().unwrap());
            if str_len as usize != target_utf16.len() {
                continue;
            }
            let klass_start = length_offset - 16;
            let klass_bytes = &buf[klass_start..klass_start + 8];
            let klass_addr = u64::from_le_bytes(klass_bytes.try_into().unwrap());
            if klass_addr > 0x100000 && klass_addr < 0x800000000000 {
                let string_addr = addr + klass_start as u64;
                results.push(string_addr);
            }
        }

        if buf_size > 32 {
            addr += (buf_size - 32) as u64;
        } else {
            addr += buf_size as u64;
        }
    }
    results
}

pub fn read_managed_string(pid: i32, addr: u64) -> Option<String> {
    let mut header = [0u8; 24];
    if !kmod_read_memory(pid, addr, &mut header) {
        return None;
    }
    let str_len = u32::from_le_bytes(header[16..20].try_into().unwrap()) as usize;
    if str_len == 0 || str_len > 10000 {
        return None;
    }
    let mut chars_buf = vec![0u8; str_len * 2];
    if !kmod_read_memory(pid, addr + 20, &mut chars_buf) {
        return None;
    }
    let chars: Vec<u16> = chars_buf
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16(&chars).ok()
}

pub fn find_entity_id_by_value(pid: i32, target_id: i32) {
    let pattern = target_id.to_le_bytes();
    println!("[MEM] Ищем entity_id={} (0x{:08x}) в памяти PID={}", target_id, target_id, pid);
    let ranges = get_anonymous_rw_ranges(pid);
    let mut found = 0;

    for range in &ranges {
        let size = (range.end - range.start) as usize;
        if size < 4 || size > 256 * 1024 * 1024 { continue; }
        if size > 10 * 1024 * 1024 {
            let mut addr = range.start;
            while addr < range.end {
                let remaining = (range.end - addr) as usize;
                let chunk = if remaining > 1024 * 1024 { 1024 * 1024 } else { remaining };
                let mut buf = vec![0u8; chunk];
                if read_process_memory(pid, addr, &mut buf) {
                    for &off in &memmem(&buf, &pattern) {
                        let abs_addr = addr + off as u64;
                        dump_entity_context(pid, abs_addr, target_id);
                        found += 1;
                        if found >= 10 { break; }
                    }
                }
                addr += (chunk as u64).saturating_sub(4);
                if found >= 10 { break; }
            }
        } else {
            let mut buf = vec![0u8; size];
            if read_process_memory(pid, range.start, &mut buf) {
                for &off in &memmem(&buf, &pattern) {
                    let abs_addr = range.start + off as u64;
                    dump_entity_context(pid, abs_addr, target_id);
                    found += 1;
                    if found >= 10 { break; }
                }
            }
        }
        if found >= 10 { break; }
    }
    if found == 0 {
        println!("[MEM] Entity ID {} не найден в rw-p памяти", target_id);
    }
}

fn dump_entity_context(pid: i32, abs_addr: u64, target_id: i32) {
    let mut buf = vec![0u8; 512];
    let read_addr = if abs_addr >= 16 { abs_addr - 16 } else { abs_addr };
    if !read_process_memory(pid, read_addr, &mut buf) {
        println!("[MEM] ID {} @ 0x{:x} (не смог прочитать контекст)", target_id, abs_addr);
        return;
    }
    let off = (abs_addr - read_addr) as usize;
    let ctx_hex: Vec<String> = buf.iter().take(256).map(|b| format!("{:02x}", b)).collect();
    print!("[MEM] ID {} @ 0x{:x}: {}", target_id, abs_addr, ctx_hex.join(" "));
    let _ = stdout().flush();

    for &delta in &[0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60] {
        let start = off + 4 + delta;
        if start + 12 <= buf.len() {
            let x = f32::from_le_bytes(buf[start..start+4].try_into().unwrap());
            let y = f32::from_le_bytes(buf[start+4..start+8].try_into().unwrap());
            let z = f32::from_le_bytes(buf[start+8..start+12].try_into().unwrap());
            if x.is_finite() && y.is_finite() && z.is_finite()
                && x.abs() > 0.1 && y.abs() > 0.1
                && x.abs() < 20000.0 && y.abs() < 20000.0 && z.abs() < 20000.0
            {
                println!(" XYZ(delta={}) ({:.1},{:.1},{:.1})", delta, x, y, z);
                return;
            }
        }
    }
    // also check delta from id end (off+4) in wider steps
    for &delta in &[64, 72, 80, 88, 96, 104, 112, 120, 128, 136, 144] {
        let start = off + 4 + delta;
        if start + 12 <= buf.len() {
            let x = f32::from_le_bytes(buf[start..start+4].try_into().unwrap());
            let y = f32::from_le_bytes(buf[start+4..start+8].try_into().unwrap());
            let z = f32::from_le_bytes(buf[start+8..start+12].try_into().unwrap());
            if x.is_finite() && y.is_finite() && z.is_finite()
                && x.abs() > 0.1 && y.abs() > 0.1
                && x.abs() < 20000.0 && y.abs() < 20000.0 && z.abs() < 20000.0
            {
                println!(" XYZ(delta={}) ({:.1},{:.1},{:.1})", delta, x, y, z);
                return;
            }
        }
    }
    // search for known position 202.36, 49.9 as raw bytes
    let target_x = 202.36f32; let target_y = 49.9f32;
    let txb = target_x.to_le_bytes();
    let tyb = target_y.to_le_bytes();
    for i in 4..buf.len()-12 {
        if buf[i..i+4] == txb && buf[i+4..i+8] == tyb {
            let delta = i - (off + 4);
            println!(" KNOWN_POS(delta={}) ({:.1},{:.1})", delta, target_x, target_y);
            return;
        }
    }
    println!(" (no pos found)");
}

pub fn find_candidate_positions(pid: i32) -> Vec<(f32, f32, f32, u64)> {
    println!("[MEM] Поиск кандидатов (3 float, Mtest стиль)...");
    let mut candidates: Vec<(i32, f32, f32, f32, u64)> = Vec::new();
    scan_entity_candidates(pid, &mut candidates);
    let result: Vec<(f32, f32, f32, u64)> = candidates.into_iter()
        .map(|(_, x, y, z, addr)| (x, y, z, addr))
        .collect();
    if let Ok(mut s) = SCANNED_CANDIDATES.lock() {
        *s = result.clone();
    }
    println!("[MEM] Найдено {} кандидатов (сохранено в SCANNED_CANDIDATES)", result.len());
    for (i, (x, y, z, addr)) in result.iter().enumerate().take(5) {
        println!("[MEM]   [{i}] ({x:.1}, {y:.1}, {z:.1}) @ 0x{addr:x}");
    }
    result
}

pub fn filter_nearby_positions(mx: f32, my: f32, radius: f32) -> Vec<(i32, f32, f32)> {
    let candidates = SCANNED_CANDIDATES.lock().unwrap_or_else(|e| e.into_inner());
    let result: Vec<(i32, f32, f32)> = candidates.iter()
        .filter(|(x, y, _, _)| {
            let dx = x - mx;
            let dy = y - my;
            dx * dx + dy * dy <= radius * radius
        })
        .map(|(x, y, _, addr)| {
            let id = (addr & 0x7FFFFFFF) as i32;
            (id, *x, *y)
        })
        .collect();
    println!("[MEM] filter_nearby_positions: {} из {} кандидатов в радиусе {:.0} от ({:.1},{:.1})",
             result.len(), candidates.len(), radius, mx, my);
    result
}

fn scan_entity_candidates(pid: i32, candidates: &mut Vec<(i32, f32, f32, f32, u64)>) {
    let ranges = get_mtest_regions(pid);
    println!("[MEM] Сканирую {} регионов (Mtest стиль: 3 float, шаг 8)...", ranges.len());
    let max_candidates = 500;
    let mut buf = [0u8; 12];

    for range in &ranges {
        let size = (range.end - range.start) as usize;
        if size > 4 * 1024 * 1024 { continue; }

        for addr in (range.start..range.end.saturating_sub(12)).step_by(8) {
            if !read_process_memory(pid, addr, &mut buf) { continue; }
            let x = f32::from_le_bytes(buf[0..4].try_into().unwrap());
            let y = f32::from_le_bytes(buf[4..8].try_into().unwrap());
            let z = f32::from_le_bytes(buf[8..12].try_into().unwrap());
            if x != 0.0 && y != 0.0
                && x > -2000.0 && x < 2000.0
                && y > -2000.0 && y < 2000.0
            {
                let id = 0;
                candidates.push((id, x, y, z, addr));
                if candidates.len() >= max_candidates { return; }
            }
        }
    }
}

/// Регионы как в C# Mtest: rw-p, исключая .so и [brackets]
fn get_mtest_regions(pid: i32) -> Vec<MemoryRange> {
    let maps_path = format!("/proc/{}/maps", pid);
    let file = match File::open(&maps_path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);
    let mut ranges = Vec::new();
    for line in reader.lines().flatten() {
        if !line.contains("rw-p") { continue; }
        if line.contains(".so") { continue; }
        if line.contains('[') { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(range_str) = parts.get(0) {
            if let Some((start_str, end_str)) = range_str.split_once('-') {
                if let (Ok(start), Ok(end)) = (
                    u64::from_str_radix(start_str, 16),
                    u64::from_str_radix(end_str, 16),
                ) {
                    ranges.push(MemoryRange { start, end });
                }
            }
        }
    }
    ranges
}

pub fn scan_id_addrs(pid: i32, target_id: i32) -> Vec<u64> {
    let pattern = target_id.to_le_bytes();
    let ranges = get_anonymous_rw_ranges(pid);
    let mut addrs = Vec::new();
    let max_find = 16;
    let mut total_scanned: usize = 0;
    let max_scan = 200 * 1024 * 1024; // limit total scanned to 200 MB

    for range in &ranges {
        if addrs.len() >= max_find { break; }
        let size = (range.end - range.start) as usize;
        if size < 4 || size > 50 * 1024 * 1024 { continue; }
        if total_scanned > max_scan { break; }

                if size > 1024 * 1024 {
                    let mut addr = range.start;
                    while addr < range.end {
                        let remaining = (range.end - addr) as usize;
                        let chunk = std::cmp::min(remaining, 1024 * 1024);
                        if chunk < 4 { addr = range.end; continue; }
                        let mut buf = vec![0u8; chunk];
                        if read_process_memory(pid, addr, &mut buf) {
                            for &off in &memmem(&buf, &pattern) {
                                addrs.push(addr + off as u64);
                                if addrs.len() >= max_find { break; }
                            }
                        }
                        total_scanned += chunk;
                        if total_scanned > max_scan || addrs.len() >= max_find { break; }
                        addr += chunk as u64;
            }
        } else {
            let mut buf = vec![0u8; size];
            if read_process_memory(pid, range.start, &mut buf) {
                for &off in &memmem(&buf, &pattern) {
                    addrs.push(range.start + off as u64);
                    if addrs.len() >= max_find { break; }
                }
            }
            total_scanned += size;
        }
    }

    // Также сканируем GASM rw-p сегмент (статические переменные)
    if let Some(range) = get_module_rw_range(pid, "GameAssembly.so") {
        let size = (range.end - range.start) as usize;
        if size >= 4 && size <= 50 * 1024 * 1024 && addrs.len() < max_find {
            if total_scanned + size <= max_scan * 2 {
                let mut buf = vec![0u8; size];
                if read_process_memory(pid, range.start, &mut buf) {
                    total_scanned += size;
                    for &off in &memmem(&buf, &pattern) {
                        let a = range.start + off as u64;
                        if !addrs.contains(&a) {
                            addrs.push(a);
                            if addrs.len() >= max_find { break; }
                        }
                    }
                }
            }
        }
    }

    println!("[MEM] ID {} найден по {} адресам (просканировано {} MB):",
             target_id, addrs.len(), total_scanned / 1024 / 1024);
    for a in &addrs {
        dump_entity_context(pid, *a, target_id);
    }
    if let Ok(mut stored) = ENTITY_ADDRS.lock() {
        *stored = addrs.clone();
    }
    addrs
}

pub fn find_id_changed(pid: i32, old_id: i32, new_id: i32) {
    let addrs = ENTITY_ADDRS.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if addrs.is_empty() {
        println!("[MEM] Нет сохранённых адресов, сначала сделай SCANID <id>");
        return;
    }
    let old_bytes = old_id.to_le_bytes();
    let new_bytes = new_id.to_le_bytes();
    println!("[MEM] Проверяю {} адресов: старый ID={}, новый ID={}", addrs.len(), old_id, new_id);

    for &addr in &addrs {
        let mut buf = [0u8; 64];
        let read_addr = if addr >= 16 { addr - 16 } else { addr };
        if !read_process_memory(pid, read_addr, &mut buf) { continue; }
        let off = (addr - read_addr) as usize;

        let got_id = i32::from_le_bytes(buf[off..off+4].try_into().unwrap());
        if got_id == old_id {
            println!("[MEM]   0x{:x}: всё ещё old ID={}", addr, old_id);
        } else if got_id == new_id {
            println!("[MEM] *** 0x{:x}: ID СМЕНИЛСЯ {}→{} <-- ЭТО ИГРОК!", addr, old_id, new_id);
            dump_entity_context(pid, addr, new_id);
        } else {
            let ctx_hex: Vec<String> = buf[off..off+8].iter().map(|b| format!("{:02x}", b)).collect();
            println!("[MEM]   0x{:x}: другое значение {} hex={}", addr, got_id, ctx_hex.join(" "));
        }
    }
}

pub fn find_all_collision_grids(pid: i32) -> Vec<CollisionGrid> {
    let mut grids = Vec::new();

    let mut pointer_buf = [0u8; 8];
    let mut size_buf = [0u8; 4];

    let module_base = match get_module_base_address(pid, "GameAssembly.so") {
        Some(base) => base,
        None => return grids,
    };
    let qword_address = module_base + 0x7277568;
    if !kmod_read_memory(pid, qword_address, &mut pointer_buf) {
        return grids;
    }
    let type_info_rva = u64::from_le_bytes(pointer_buf);

    let type_info_address = if type_info_rva > 0x7fffffffffff {
        type_info_rva
    } else {
        module_base + type_info_rva
    };

    let static_fields_ptr_addr = type_info_address + 184;
    if !kmod_read_memory(pid, static_fields_ptr_addr, &mut pointer_buf) {
        return grids;
    }
    let static_fields_address = u64::from_le_bytes(pointer_buf);
    if static_fields_address < 0x10000 || static_fields_address > 0x7fffffffffff {
        return grids;
    }

    let instance_ptr_addr = static_fields_address + 8;
    if !kmod_read_memory(pid, instance_ptr_addr, &mut pointer_buf) {
        return grids;
    }
    let cluster_map_instance = u64::from_le_bytes(pointer_buf);
    if cluster_map_instance < 0x10000 || cluster_map_instance > 0x7fffffffffff {
        return grids;
    }

    if !kmod_read_memory(pid, cluster_map_instance + 0x30, &mut size_buf) {
        return grids;
    }
    let width = i32::from_le_bytes(size_buf);

    if width < 100 || width > 2000 {
        return grids;
    }

    let cluster_info_ptr_addr = cluster_map_instance + 0x48;
    if !kmod_read_memory(pid, cluster_info_ptr_addr, &mut pointer_buf) {
        return grids;
    }
    let cluster_info_address = u64::from_le_bytes(pointer_buf);
    if cluster_info_address < 0x10000 || cluster_info_address > 0x7fffffffffff {
        return grids;
    }

    let array_ptr_addr = cluster_info_address + 0x18;
    if !kmod_read_memory(pid, array_ptr_addr, &mut pointer_buf) {
        return grids;
    }
    let array_ptr = u64::from_le_bytes(pointer_buf);
    if array_ptr < 0x10000 || array_ptr > 0x7fffffffffff {
        return grids;
    }

    let total_cells = (width * width) as usize;
    let mut raw_matrix = vec![0u8; total_cells];

    if kmod_read_memory(pid, array_ptr + 0x20, &mut raw_matrix) {
        println!("[+] Collision grid: {}x{} ({} bytes)", width, width, total_cells);

        let chunk_x: i32;
        let chunk_z: i32;

        kmod_read_memory(pid, cluster_map_instance + 0x68, &mut size_buf);
        chunk_x = i32::from_le_bytes(size_buf);

        kmod_read_memory(pid, cluster_map_instance + 0x70, &mut size_buf);
        chunk_z = i32::from_le_bytes(size_buf);

        let mut float_buf = [0u8; 4];
        let world_x = if kmod_read_memory(pid, cluster_map_instance + 0xA0, &mut float_buf) {
            f32::from_le_bytes(float_buf)
        } else {
            0.0
        };
        let world_y = if kmod_read_memory(pid, cluster_map_instance + 0xA4, &mut float_buf) {
            f32::from_le_bytes(float_buf)
        } else {
            0.0
        };

        println!("[+] chunk_x={}, chunk_z={}, world=({}, {})", chunk_x, chunk_z, world_x, world_y);

        grids.push(CollisionGrid {
            chunk_x,
            chunk_z,
            world_pos_x: world_x,
            world_pos_y: world_y,
            width,
            height: width,
            raw_matrix,
        });
    }

    grids
}
/// Читает список сущностей через GOM linked list (как в walk_gom.py)
pub fn read_entities_via_gom(pid: i32) -> Vec<(i32, f32, f32)> {
    let mut entities = Vec::new();
    let mut found_unity = false;
    let mut unity_base = 0u64;

    if let Ok(maps) = std::fs::read_to_string(format!("/proc/{}/maps", pid)) {
        for line in maps.lines() {
            if line.contains("UnityPlayer.so") && line.contains("r--p") && line.contains("00000000") {
                if let Some(addr_str) = line.split('-').next() {
                    if let Ok(base) = u64::from_str_radix(addr_str, 16) {
                        unity_base = base;
                        found_unity = true;
                        break;
                    }
                }
            }
        }
    }

    if !found_unity {
        if let Some(base) = get_module_base_address(pid, "GameAssembly.so") {
            unity_base = base;
        } else {
            return entities;
        }
    }

    let mut gom_buf = [0u8; 8];
    if !read_process_memory(pid, unity_base + 0x20EAAC0, &mut gom_buf) {
        return entities;
    }
    let gom = u64::from_le_bytes(gom_buf);
    if gom < 0x100000 {
        return entities;
    }

    let mut sentinel_buf = [0u8; 16];
    if !read_process_memory(pid, gom + 0x18, &mut sentinel_buf) {
        return entities;
    }
    let sentinel_next = u64::from_le_bytes(sentinel_buf[8..16].try_into().unwrap());
    if sentinel_next == gom + 0x18 {
        return entities;
    }

    let mut node = sentinel_next;
    let mut go_count = 0;
    while node != gom + 0x18 && go_count < 500 && entities.len() < 200 {
        go_count += 1;
        let game_obj = node - 0x68;
        let mut gob = [0u8; 0x80];
        if !read_process_memory(pid, game_obj, &mut gob) {
            break;
        }

        let klass = u64::from_le_bytes(gob[0x00..0x08].try_into().unwrap());
        let transform_ptr = u64::from_le_bytes(gob[0x10..0x18].try_into().unwrap());
        let name_ptr = u64::from_le_bytes(gob[0x28..0x30].try_into().unwrap());

        let mut entity_id = 0i32;
        let mut pos_x = 0.0f32;
        let mut pos_y = 0.0f32;
        let mut have_entity_id = false;
        let mut have_pos = false;

        if transform_ptr >= 0x700000000000 && transform_ptr <= 0x800000000000 {
            let mut tb = [0u8; 0xA0];
            if read_process_memory(pid, transform_ptr, &mut tb) {
                for off in (0x38..0x98).step_by(4) {
                    if off + 8 > tb.len() { break; }
                    let x = f32::from_le_bytes(tb[off..off+4].try_into().unwrap());
                    let y = f32::from_le_bytes(tb[off+4..off+8].try_into().unwrap());
                    if x.is_finite() && y.is_finite() && x.abs() > 0.5 && x.abs() < 20000.0 && y.abs() > 0.5 && y.abs() < 20000.0 {
                        pos_x = x;
                        pos_y = y;
                        have_pos = true;
                        break;
                    }
                }
            }
        }

        let comp_handle = u64::from_le_bytes(gob[0x18..0x20].try_into().unwrap());
        if have_pos {
            for scan_off in (0x20..0x70).step_by(4) {
                if scan_off + 4 > gob.len() { break; }
                let val = i32::from_le_bytes(gob[scan_off..scan_off+4].try_into().unwrap());
                if val > 100_000 && val < 50_000_000 {
                    entity_id = val;
                    have_entity_id = true;
                    break;
                }
            }
        }

        if !have_entity_id {
            let mut scan_data = [0u8; 256];
            let scan_addr = if game_obj > 128 { game_obj - 128 } else { 0 };
            if scan_addr > 0 && read_process_memory(pid, scan_addr, &mut scan_data) {
                let off = (game_obj - scan_addr) as usize;
                for i in (0..=off).step_by(4) {
                    if i + 4 > scan_data.len() { break; }
                    let val = i32::from_le_bytes(scan_data[i..i+4].try_into().unwrap());
                    if val > 100_000 && val < 50_000_000 {
                        entity_id = val;
                        have_entity_id = true;
                        break;
                    }
                }
            }
        }

        if have_pos && have_entity_id {
            entities.push((entity_id, pos_x, pos_y));
        }

        let ln_next = u64::from_le_bytes(gob[0x70..0x78].try_into().unwrap());
        if ln_next == node { break; }
        node = ln_next;
    }

    if entities.is_empty() {
        entities = scan_heap_entities(pid);
    }

    entities
}

pub fn discover_coord_candidates(pid: i32) -> usize {
    let ranges = get_anonymous_rw_ranges(pid);
    let mut found = 0usize;
    for range in &ranges {
        let size = (range.end - range.start) as usize;
        if size < 12 || size > 4 * 1024 * 1024 { continue; }
        if range.start < 0x720000000000 { continue; }
        if range.start > 0x730000000000 { continue; }
        let max_read = size.min(1024 * 1024);
        let mut buf = vec![0u8; max_read];
        if !read_process_memory(pid, range.start, &mut buf) { continue; }
        for i in (0..max_read.saturating_sub(12)).step_by(8) {
            let x = f32::from_le_bytes(buf[i..i+4].try_into().unwrap());
            let y = f32::from_le_bytes(buf[i+4..i+8].try_into().unwrap());
            let z = f32::from_le_bytes(buf[i+8..i+12].try_into().unwrap());
            if x != 0.0 && y != 0.0 && x > -2000.0 && x < 2000.0 && y > -2000.0 && y < 2000.0 {
                let addr = range.start + i as u64;
                if let Ok(mut t) = COORD_TRACKER.lock() {
                    if !t.contains_key(&addr) {
                        t.insert(addr, (x, y, false));
                        found += 1;
                    }
                }
            }
        }
    }
    found
}

pub fn track_coord_enemies(pid: i32) -> Vec<(i32, f32, f32)> {
    let addrs: Vec<u64> = if let Ok(t) = COORD_TRACKER.lock() {
        t.keys().copied().collect()
    } else { return Vec::new(); };

    let mut updates = Vec::new();
    for &addr in &addrs {
        let mut buf = [0u8; 12];
        if !read_process_memory(pid, addr, &mut buf) {
            updates.push((addr, None));
            continue;
        }
        let x = f32::from_le_bytes(buf[0..4].try_into().unwrap());
        let y = f32::from_le_bytes(buf[4..8].try_into().unwrap());
        if !x.is_finite() || !y.is_finite() || x == 0.0 || y == 0.0 {
            updates.push((addr, None));
            continue;
        }
        updates.push((addr, Some((x, y))));
    }

    let mut confirmed = Vec::new();
    if let Ok(mut t) = COORD_TRACKER.lock() {
        for (addr, opt) in updates {
            match opt {
                None => { t.remove(&addr); }
                Some((x, y)) => {
                    let entry = t.entry(addr).or_insert((x, y, false));
                    let moved = (x - entry.0).abs() > 1.0 || (y - entry.1).abs() > 1.0;
                    entry.0 = x;
                    entry.1 = y;
                    if moved { entry.2 = true; }
                    if entry.2 {
                        let id = -((addr & 0xFFFF) as i32);
                        confirmed.push((id, x, y));
                    }
                }
            }
        }
    }
    if confirmed.len() > 200 { confirmed.truncate(200); }
    confirmed
}
