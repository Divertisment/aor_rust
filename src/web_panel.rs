use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

fn cmd(cmd: &str, host: &str) -> String {
    let mut stream = match TcpStream::connect(host) {
        Ok(s) => s,
        Err(e) => return format!("ERR connect: {}", e),
    };
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    let _ = write!(stream, "{}\n", cmd);
    let mut reader = BufReader::new(&stream);
    let mut resp = String::new();
    reader.read_line(&mut resp).ok();
    resp.trim().to_string()
}

fn test_afk() -> String {
    let ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default()
        .subsec_nanos() as f64 / 1e9;
    let base = 350.0;
    let up_ms = (base * (0.9 + ns.fract() * 0.2)) as i32;
    let down_ms = (base * (0.9 + (1.0 - ns.fract()) * 0.2)) as i32;
    let r1 = std::fs::write("/proc/aor_input", format!("K 103 {}\n", up_ms));
    std::thread::sleep(std::time::Duration::from_millis(800));
    let r2 = std::fs::write("/proc/aor_input", format!("K 108 {}\n", down_ms));
    match (r1, r2) {
        (Ok(_), Ok(_)) => "OK".to_string(),
        _ => "ERR write".to_string(),
    }
}

fn start_server() -> String {
    let result = Command::new("sudo")
        .arg("-S")
        .arg("nohup")
        .arg("env")
        .arg("AOR_MY_ID=562")
        .arg("/home/stas/AOR_rust/target/release/albion_kernel")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    match result {
        Ok(mut child) => {
            if let Some(ref mut stdin) = child.stdin {
                let _ = write!(stdin, "31271\n");
            }
            thread::spawn(move || { let _ = child.wait(); });
            thread::spawn(|| {
                let start = std::time::Instant::now();
                loop {
                    thread::sleep(Duration::from_secs(1));
                    if start.elapsed().as_secs() > 30 { break; }
                    let resp = cmd("STATUS_JSON", "127.0.0.1:4446");
                    if resp.contains(r#""clients":0"#) || resp.contains("ERR connect") {
                        continue;
                    }
                    cmd("AFK ON", "127.0.0.1:4446");
                    break;
                }
            });
            "OK start".to_string()
        }
        Err(e) => format!("ERR start: {}", e),
    }
}

fn status_json(host: &str) -> String {
    cmd("STATUS_JSON", host)
}

const PANEL_HTML: &str = r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>AOR Control</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:monospace;background:#1a1a2e;color:#e0e0e0;padding:20px}
h1{color:#ffc107;font-size:18px;margin-bottom:20px}
.card{background:#16213e;padding:15px;border-radius:8px;margin-bottom:15px}
.row{margin:5px 0}
.l{color:#888}
.v{color:#0f0}
.v.off{color:#f44}
.btn{display:inline-block;padding:8px 16px;margin:3px;border:none;border-radius:4px;cursor:pointer;font:14px monospace}
.b1{background:#1a5fb4;color:#fff}
.b2{background:#26a269;color:#fff}
.b3{background:#e66100;color:#fff}
.b4{background:#c01c28;color:#fff}
.in{background:#0d1117;border:1px solid #333;color:#e0e0e0;padding:6px 10px;border-radius:4px;width:100px;font:14px monospace}
#msg{margin-top:10px;padding:8px;border-radius:4px;display:none;background:#333;color:#ffc107}
</style></head>
<body>
<h1>AOR Web Control</h1>
<div class="card" id="st">
<div class="row"><span class="l">Server:</span> <span class="v" id="srv">-</span> <span id="srvver" style="color:#888"></span></div>
<div class="row"><span class="l">Clients:</span> <span id="cl">0</span></div>
<div class="row"><span class="l">Entity ID:</span> <span id="eid">-</span></div>
<div class="row"><span class="l">Main:</span> <span id="ename">-</span></div>
<div class="row"><span class="l">Slave:</span> <span id="sname">-</span> <span id="sid" style="color:#888"></span></div>
<div class="row"><span class="l">Packets:</span> <span id="cap">0</span> cap / <span id="rly">0</span> rel</div>
<div class="row"><span class="l">AFK:</span> <span id="afk">OFF</span></div>
<div class="row"><span class="l">Position:</span> <span id="mypos">-</span></div>
</div>
<div>
<button class="btn b1" onclick="p('/scanall')">SCANALL</button>

<button class="btn b2" onclick="p('/afk-on')">AFK ON</button>
<button class="btn b3" onclick="p('/afk-off')">AFK OFF</button>
<button class="btn b1" onclick="p('/test-afk')">TEST AFK</button>
</div>
<div style="margin-top:10px">
<input class="in" id="idi" placeholder="entity ID">
<button class="btn b1" onclick="setid()">SETID</button>
</div>
<div style="margin-top:10px">
<input class="in" id="nm" placeholder="Main" style="width:100px">
<button class="btn b2" onclick="setname()">SET MAIN</button>
<input class="in" id="sn" placeholder="Slave" style="width:100px;margin-left:6px">
<button class="btn b2" onclick="setname2()">SET SLAVE</button>
</div>
<div style="margin-top:10px"><button class="btn b1" onclick="p('/start')">START SERVER</button> <button class="btn b4" onclick="p('/stop')">SHUTDOWN</button></div>
<div id="msg"></div>
<script>
function p(p,b){fetch(p,{method:'POST',body:b||''}).then(r=>r.text()).then(t=>m(t)).catch(e=>m('ERR: '+e))}
function setid(){let i=document.getElementById('idi').value;if(i)p('/setid',i)}
function setname(){let n=document.getElementById('nm').value;if(n)fetch('/setname',{method:'POST',body:n}).then(r=>r.json()).then(d=>{if(d.ok)document.getElementById('ename').textContent=n;m(d.ok)})}
function setname2(){let n=document.getElementById('sn').value;if(n)fetch('/setslave',{method:'POST',body:n}).then(r=>r.json()).then(d=>{if(d.ok)document.getElementById('sname').textContent=n;m(d.ok)})}
function m(t){let e=document.getElementById('msg');e.textContent=t;e.style.display='block';setTimeout(()=>{e.style.display='none'},3000)}
function st(){fetch('/status').then(r=>r.json()).then(d=>{
document.getElementById('srv').textContent=d.running?'RUNNING':'STOPPED';document.getElementById('srv').className='v'+(d.running?'':' off');
document.getElementById('srvver').textContent=d.version||'';
document.getElementById('cl').textContent=d.clients;document.getElementById('eid').textContent=d.entity_id;document.getElementById('ename').textContent=d.entity_name||'-';document.getElementById('sname').textContent=d.slave||'-';document.getElementById('sid').textContent=d.slave_id?'('+d.slave_id+')':'';
document.getElementById('cap').textContent=d.packets_captured;document.getElementById('rly').textContent=d.packets_relayed;
document.getElementById('afk').textContent=d.afk?'ON':'OFF';
document.getElementById('mypos').textContent=(d.pos_x||0).toFixed(1)+', '+(d.pos_y||0).toFixed(1)})}
setInterval(st,2000);st()
</script>
</body></html>"#;

fn handle(mut stream: TcpStream, server: String) {
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]);
    let line = req.split("\r\n").next().unwrap_or("");
    let parts: Vec<&str> = line.split(' ').collect();
    if parts.len() < 2 { return; }
    let path = parts[1];

    let (status, ct, body): (u16, &str, String) = match path {
        "/" => (200, "text/html; charset=utf-8", PANEL_HTML.to_string()),
        "/status" => (200, "application/json", status_json(&server)),
        "/afk-on" => (200, "application/json", cmd("AFK ON", &server)),
        "/afk-off" => (200, "application/json", cmd("AFK OFF", &server)),
        "/test-afk" => (200, "application/json", test_afk()),
        "/scanall" => (200, "application/json", cmd("SCANALL", &server)),
        _ if path == "/setid" => {
            let body = req.split("\r\n\r\n").nth(1).unwrap_or("").trim().to_string();
            (200, "application/json", cmd(&format!("SETID {}", body), &server))
        }
        _ if path == "/setname" => {
            let body = req.split("\r\n\r\n").nth(1).unwrap_or("").trim().to_string();
            (200, "application/json", cmd(&format!("SETNAME {}", body), &server))
        }
        _ if path == "/setslave" => {
            let body = req.split("\r\n\r\n").nth(1).unwrap_or("").trim().to_string();
            (200, "application/json", format!(r#"{{"ok":"slave={}"}}"#, body))
        }
        "/stop" => (200, "application/json", cmd("SHUTDOWN", &server)),
        "/start" => (200, "application/json", start_server()),
        _ => (404, "text/plain", "404 Not Found".to_string()),
    };

    let resp = format!("HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                       status, if status == 200 { "OK" } else { "Not Found" }, ct, body.len(), body);
    let _ = stream.write_all(resp.as_bytes());
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let server = args.get(1).map(|s| s.clone()).unwrap_or("127.0.0.1:4446".to_string());
    let bind = args.get(2).map(|s| s.clone()).unwrap_or("0.0.0.0:8080".to_string());
    println!("[WEB] Панель управления: http://{} -> CMD {}", bind, server);

    let listener = TcpListener::bind(&bind).unwrap();
    listener.set_nonblocking(true).ok();

    loop {
        if let Ok((stream, addr)) = listener.accept() {
            let s = server.clone();
            thread::spawn(move || handle(stream, s));
        }
        thread::sleep(Duration::from_millis(50));
    }
}
