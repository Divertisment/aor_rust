#!/usr/bin/env python3
"""Anti-AFK: arrow up/down via aor_input.ko, возвращается на место."""
import random, time, sys, os

KPROC = "/proc/aor_input"

UP = 103
DOWN = 108

pidpath = "/tmp/anti_afk.pid"
try:
    with open(pidpath, "w") as f:
        f.write(str(os.getpid()))
except PermissionError:
    pidpath = os.path.expanduser("~/.anti_afk.pid")
    with open(pidpath, "w") as f:
        f.write(str(os.getpid()))

while True:
    base = random.randint(300, 400)
    gap = random.uniform(500, 1000)
    # up ±10%
    up_ms = int(base * random.uniform(0.9, 1.1))
    # down ±10%  
    down_ms = int(base * random.uniform(0.9, 1.1))
    with open(KPROC, 'w') as f:
        f.write(f"K {UP} {up_ms}\n")
    time.sleep(gap / 1000)
    with open(KPROC, 'w') as f:
        f.write(f"K {DOWN} {down_ms}\n")
    t = time.strftime('%H:%M:%S')
    print(f"[{t}] Up={up_ms}ms Down={down_ms}ms gap={int(gap)}ms")
    sys.stdout.flush()
    time.sleep(random.uniform(270, 330))
