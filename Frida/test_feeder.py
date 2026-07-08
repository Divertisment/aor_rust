import socket, json, time
try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect(("127.0.0.1", 4448))
    print("[TEST] Connected to 4448")
    while True:
        # Тестовые данные для игрока
        msg = {"t":"p", "id": 209881, "x": 360.0, "y": -220.0}
        sock.sendall((json.dumps(msg) + "\n").encode())
        print(f"[TEST] Sent {msg}")
        time.sleep(0.5)
except Exception as e:
    print(f"[TEST] Error: {e}")
