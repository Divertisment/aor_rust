#!/bin/bash
# ============================================================================
# aor_smoke_dry.sh — preflight only, NO dotnet run.
#
# Use this when you want to verify that Albion-Online is reachable, not
# a zombie, and has enough head-room to safely run the full aor_smoke.sh.
# Safe to run when the game is dead (exits 1 in that case).
#
# Exit codes:
#   0 = game alive and safe to scan
#   1 = game not running
#   2 = game is a zombie / disk-wait
#   3 = system too low on memory (override with FORCE_AVAILABLE_MB)
# ============================================================================
set -u

GAME_NAME="${GAME_NAME:-Albion-Online}"
FORCE_AVAILABLE_MB="${FORCE_AVAILABLE_MB:-300}"
NO_COLOR="${NO_COLOR:-}"

if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
    G="\033[1;32m"; Y="\033[1;33m"; R="\033[1;31m"; Z="\033[0;36m"; N="\033[0m"
else
    G=""; Y=""; R=""; Z=""; N=""
fi

say()  { printf "${G}[ok]${N}   %s\n"   "$*"; }
warn() { printf "${Y}[warn]${N} %s\n"   "$*"; }
die()  { printf "${R}[fail]${N} %s\n"  "$*"; exit "${2:-1}"; }
info() { printf "${Z}[info]${N} %s\n"  "$*"; }

# ---------- 1. PID ----------------------------------------------------------
PID="$(pidof -s "$GAME_NAME" 2>/dev/null || true)"
if [ -z "$PID" ]; then
    die "$GAME_NAME is not running" 1
fi
say "PID = $PID"

# ---------- 2. State --------------------------------------------------------
STATE_RAW="$(awk '{print $3}' "/proc/$PID/stat" 2>/dev/null || echo '?')"
case "$STATE_RAW" in
    R) STATE="runnable";;
    S) STATE="sleeping";;
    D) STATE="disk-wait";;
    Z) STATE="ZOMBIE"; die "$GAME_NAME (PID $PID) is a zombie" 2;;
    T) STATE="stopped";;
    *) STATE="unknown($STATE_RAW)";;
esac
say "state = $STATE"
if [ "$STATE" = "disk-wait" ]; then
    warn "process is stuck in D state (uninterruptible sleep — IO hang)"
fi

# ---------- 3. RSS ----------------------------------------------------------
RSS_KB="$(awk '/VmRSS/ {print $2}' "/proc/$PID/status" 2>/dev/null || echo 0)"
RSS_MB=$((RSS_KB / 1024))
say "RSS = ${RSS_MB} MiB"

# ---------- 4. Free memory --------------------------------------------------
FREE_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
say "MemAvailable = ${FREE_MB} MiB (threshold = ${FORCE_AVAILABLE_MB})"
if [ "$FREE_MB" -lt "${FORCE_AVAILABLE_MB}" ]; then
    die "system has ${FREE_MB} MiB available, threshold is ${FORCE_AVAILABLE_MB}. Aborting scan to avoid OOM-killing the game. Re-run with FORCE_AVAILABLE_MB=150 to override." 3
fi

# ---------- 5. Heap region count (cheap probe) ------------------------------
# Modern kernels label anonymous rw regions with no path column (NF==6) or
# with [anon]. The literal [heap] tag only appears for the brk() heap
# segment. For an in-game Unity process we expect hundreds of anon rw
# pages from il2cpp / Mono allocations; near zero while on the login screen.
HEAP_REGIONS="$(awk '$2 ~ /rw/ && NF==6 {c++} END {print c+0}' /proc/$PID/maps 2>/dev/null || echo 0)"
info "anonymous-rw regions = ${HEAP_REGIONS} (proxy for 'is heap populated / in-game?')"

# ---------- summary ---------------------------------------------------------
echo
printf "${G}[preflight OK]${N} Safe to run: ${Z}bash ./aor_smoke.sh${N} (or pass max_entities: ${Z}bash ./aor_smoke.sh 500${N})\n"
exit 0
