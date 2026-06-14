use std::sync::Arc;
use std::thread;
use std::time::Duration;

mod memory;
mod network;
mod photon;
use memory::{find_albion_pid, get_module_base_address, scan_id_addrs, kmod_read_memory};

fn main() {
    println!("[*] AOR - Albion Online Radar");
    if let Ok(id_str) = std::env::var("AOR_MY_ID") {
        if let Ok(id) = id_str.trim().parse::<i32>() {
            *network::PLAYER_ENTITY_ID.lock().unwrap() = id;
            println!("[+] ID игрока установлен из AOR_MY_ID: {}", id);
        }
    }
    println!("[*] Finding Albion Online process...");
    let pid = match find_albion_pid() {
        Some(p) => { println!("[+] Game found! PID: {}", p); p }
        None => { println!("[-] Albion Online not found."); return; }
    };

    let module_base = match get_module_base_address(pid, "GameAssembly.so") {
        Some(base) => { println!("[+] GASM base: 0x{:x}", base); base }
        None => { println!("[-] GameAssembly.so not found."); return; }
    };

    let metadata_base = match get_module_base_address(pid, "global-metadata.dat") {
        Some(base) => { println!("[+] Metadata base: 0x{:x}", base); base }
        None => { println!("[-] global-metadata.dat not found."); return; }
    };

    *network::PLAYER_NAME.lock().unwrap() = "KpAcuBa".to_string();

    let mut magic_buf = [0u8; 16];
    if kmod_read_memory(pid, metadata_base, &mut magic_buf) {
        let magic = u32::from_le_bytes(magic_buf[0..4].try_into().unwrap());
        let version = u32::from_le_bytes(magic_buf[4..8].try_into().unwrap());
        println!("[+] Metadata magic: 0x{:08x}, version: {}", magic, version);
    }

    let mut test_buf = [0u8; 8];
    let kmod_ok = kmod_read_memory(pid, module_base, &mut test_buf);
    if kmod_ok {
        let elf_magic = &test_buf[0..4];
        println!("[+] GASM first bytes: 0x{:02x}{:02x}{:02x}{:02x}",
                 elf_magic[0], elf_magic[1], elf_magic[2], elf_magic[3]);
        println!("[+] Kernel module reading: OK");
    } else {
        println!("[-] Kernel module reading: FAILED — память недоступна");
    }

    if kmod_ok {
        let pid_copy = pid;
        thread::spawn(move || {
            network::start_sync_server(pid_copy);
        });
    }

    let running = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let r = running.clone();
    thread::spawn(move || {
        network::start_relay_server(r, pid);
    });
    let r = running.clone();
    thread::spawn(move || {
        network::start_packet_capture(r, pid);
    });
    let r = running.clone();
    let cmd_pid = pid;
    thread::spawn(move || {
        network::start_command_daemon(r, cmd_pid);
    });
    let r = running.clone();
    thread::spawn(move || {
        while r.load(std::sync::atomic::Ordering::Relaxed) {
            network::broadcast_slave_position();
            thread::sleep(Duration::from_millis(250));
        }
    });
    println!("[*] Web панель (отдельно): web_panel --addr 192.168.1.9:4446");
    println!("[*] Все сервисы запущены. Нажмите Ctrl+C для остановки.");

    while running.load(std::sync::atomic::Ordering::Relaxed) {
        thread::sleep(Duration::from_secs(1));
    }
    println!("[*] AOR server stopped.");
}
