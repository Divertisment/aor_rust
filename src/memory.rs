use std::fs::{read_to_string, File};
use std::io::{BufRead, BufReader, Read, Write, stdout};
use std::path::Path;
use std::sync::Mutex;

static ENTITY_ADDRS: Mutex<Vec<u64>> = Mutex::new(Vec::new());

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
        ret as usize == buf.len()
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
    // Читаем 64 байта: 16 до entity_id + 4 (id) + 44 после
    let mut buf = vec![0u8; 64];
    let read_addr = if abs_addr >= 16 { abs_addr - 16 } else { abs_addr };
    if !read_process_memory(pid, read_addr, &mut buf) {
        println!("[MEM] ID {} по адресу 0x{:x} (не смог прочитать контекст)", target_id, abs_addr);
        return;
    }
    let off = (abs_addr - read_addr) as usize; // смещение entity_id в buf
    let ctx_hex: Vec<String> = buf.iter().map(|b| format!("{:02x}", b)).collect();
    print!("[MEM] ID {} @ 0x{:x} range=0x{:x}: {}", target_id, abs_addr, read_addr, ctx_hex.join(" "));
    let _ = stdout().flush();

    // Пробуем интерпретировать байты после entity_id как f32 (x,y,z) на разных смещениях
    for delta in [0, 4, 8, 12, 16, 20] {
        let start = off + 4 + delta;
        if start + 12 <= buf.len() {
            let x = f32::from_le_bytes(buf[start..start+4].try_into().unwrap());
            let y = f32::from_le_bytes(buf[start+4..start+8].try_into().unwrap());
            let z = f32::from_le_bytes(buf[start+8..start+12].try_into().unwrap());
            if x.is_finite() && y.is_finite() && z.is_finite()
                && x.abs() > 0.1 && y.abs() > 0.1
                && x.abs() < 10000.0 && y.abs() < 10000.0 && z.abs() < 10000.0
            {
                println!(" XYZ(delta={}) ({:.1},{:.1},{:.1})", delta, x, y, z);
                return;
            }
        }
    }
    println!();
}

pub fn find_player_entity_id(pid: i32) -> Option<(i32, f32, f32, f32, u64)> {
    println!("[MEM] find_player_entity_id запущен...");
    let mut candidates: Vec<(i32, f32, f32, f32, u64)> = Vec::new();
    scan_entity_candidates(pid, &mut candidates);
    if candidates.is_empty() {
        println!("[MEM] Кандидатов не найдено");
        return None;
    }
    use std::collections::HashMap;
    let mut counts: HashMap<i32, usize> = HashMap::new();
    for (id, _, _, _, _) in &candidates {
        *counts.entry(*id).or_insert(0) += 1;
    }
    let mut sorted: Vec<(i32, usize)> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    println!("[MEM] Найдено {} кандидатов. Топ по частоте:", candidates.len());
    for (id, count) in sorted.iter().take(5) {
        if let Some((_, x, y, z, addr)) = candidates.iter().find(|(i, _, _, _, _)| i == id) {
            println!("[MEM]   ID={} count={} pos=({:.0},{:.0},{:.0}) @ 0x{:x}", id, count, x, y, z, addr);
        }
    }
    if let Some((best_id, _count)) = sorted.first() {
        if let Some((_, x, y, z, addr)) = candidates.iter().find(|(i, _, _, _, _)| i == best_id) {
            return Some((*best_id, *x, *y, *z, *addr));
        }
    }
    None
}

fn scan_entity_candidates(pid: i32, candidates: &mut Vec<(i32, f32, f32, f32, u64)>) {
    let ranges = get_anonymous_rw_ranges(pid);
    println!("[MEM] Сканирую {} rw-p регионов на entity_id (layout: [id][?][x][y][z])...", ranges.len());
    let max_candidates = 500;
    for range in &ranges {
        let size = (range.end - range.start) as usize;
        if size < 1000 || size > 256 * 1024 * 1024 { continue; }
        // Try scan with bigger chunks since process_vm_readv is slow
        if size > 1024 * 1024 {
            let mut addr = range.start;
            while addr < range.end {
                let remaining = (range.end - addr) as usize;
                let chunk = std::cmp::min(remaining, 1024 * 1024);
                let mut buf = vec![0u8; std::cmp::max(chunk, 20)];
                if !read_process_memory(pid, addr, &mut buf) { addr += chunk as u64; continue; }
                let max = buf.len().saturating_sub(20);
                let mut i = 0;
                while i < max {
                    i += 4;
                    let id = i32::from_le_bytes(buf[i..i+4].try_into().unwrap());
                    if id <= 0 || id > 10000000 { continue; }
                    // Try layouts: x at offset 4, 8, 12, or 16 from id
                    for xoff in [4, 8, 12, 16] {
                        if i + xoff + 12 > buf.len() { continue; }
                        let x = f32::from_le_bytes(buf[i+xoff..i+xoff+4].try_into().unwrap());
                        let y = f32::from_le_bytes(buf[i+xoff+4..i+xoff+8].try_into().unwrap());
                        let z = f32::from_le_bytes(buf[i+xoff+8..i+xoff+12].try_into().unwrap());
                        if x.is_finite() && y.is_finite() && z.is_finite()
                            && x > -20000.0 && x < 20000.0
                            && y > -20000.0 && y < 20000.0
                            && z > -20000.0 && z < 20000.0
                            && (x.abs() > 1.0 || y.abs() > 1.0)
                            && !(x.abs() < 0.1 && y.abs() < 0.1 && z.abs() < 0.1)
                        {
                            let abs_addr = addr + i as u64;
                            candidates.push((id, x, y, z, abs_addr + xoff as u64 - 4));
                            if candidates.len() >= max_candidates { return; }
                            break; // found a good layout, skip others
                        }
                    }
                }
                if candidates.len() >= max_candidates { return; }
                addr += (chunk as u64).saturating_sub(20);
            }
        } else {
            let mut buf = vec![0u8; size];
            if !read_process_memory(pid, range.start, &mut buf) { continue; }
            let max = buf.len().saturating_sub(20);
            let mut i = 0;
            while i < max {
                i += 4;
                let id = i32::from_le_bytes(buf[i..i+4].try_into().unwrap());
                if id <= 0 || id > 10000000 { continue; }
                for xoff in [4, 8, 12, 16] {
                    if i + xoff + 12 > buf.len() { continue; }
                    let x = f32::from_le_bytes(buf[i+xoff..i+xoff+4].try_into().unwrap());
                    let y = f32::from_le_bytes(buf[i+xoff+4..i+xoff+8].try_into().unwrap());
                    let z = f32::from_le_bytes(buf[i+xoff+8..i+xoff+12].try_into().unwrap());
                    if x.is_finite() && y.is_finite() && z.is_finite()
                        && x > -20000.0 && x < 20000.0
                        && y > -20000.0 && y < 20000.0
                        && z > -20000.0 && z < 20000.0
                        && (x.abs() > 1.0 || y.abs() > 1.0)
                        && !(x.abs() < 0.1 && y.abs() < 0.1 && z.abs() < 0.1)
                    {
                        candidates.push((id, x, y, z, range.start + i as u64 + xoff as u64 - 4));
                        if candidates.len() >= max_candidates { return; }
                        break;
                    }
                }
            }
        }
    }
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
