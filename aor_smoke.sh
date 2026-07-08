#!/bin/bash
# ============================================================================
# aor_smoke.sh — manual smoke test for AOR Scanner against running Albion
# Usage:  ./aor_smoke.sh [max_entities]
# Exits:  0 = scanner ran successfully
#         1 = game not running
#         2 = low memory (refused)
#         3 = scanner failed
# ============================================================================
set -e

GAME_NAME="Albion-Online"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAX_ENTITIES="${1:-200}"

# ─── Colours (only if stdout is a tty) ───────────────────────────────────
if [ -t 1 ]; then
    C_RED='\033[0;31m'; C_GRN='\033[0;32m'; C_YEL='\033[0;33m'
    C_CYN='\033[0;36m'; C_RST='\033[0m'
else
    C_RED=''; C_GRN=''; C_YEL=''; C_CYN=''; C_RST=''
fi
say()  { echo -e "${C_CYN}[aor-smoke]${C_RST} $*"; }
ok()   { echo -e "${C_GRN}[+]${C_RST} $*"; }
warn() { echo -e "${C_YEL}[!]${C_RST} $*"; }
err()  { echo -e "${C_RED}[-]${C_RST} $*" >&2; }

# ─── Pre-flight: find Albion ──────────────────────────────────────────────
say "Looking for ${GAME_NAME}…"
PID=$(pidof -s "$GAME_NAME" 2>/dev/null)

if [ -z "$PID" ]; then
    err "${GAME_NAME} is not running. Start it first:"
    err "    ${SCRIPT_DIR}/run_game.sh"
    exit 1
fi

# ─── Pre-flight: zombie check ─────────────────────────────────────────────
STATE=$(cat "/proc/$PID/stat" 2>/dev/null | awk '{print $3}')
if [ "$STATE" = "Z" ]; then
    err "PID $PID is a zombie. Cannot scan."
    exit 1
fi

RSS_KB=$(cat "/proc/$PID/status" 2>/dev/null | awk '/VmRSS/ {print $2}')
RSS_MB=$((RSS_KB / 1024))
ok "Albion-Online PID=${PID}  state=${STATE}  rss=${RSS_MB} MiB"

# ─── Pre-flight: memory check (avoid OOM-kill cascade) ────────────────────
AVAIL_MB=$(free -m | awk '/^Mem:/ {print $7}')
say "System available memory: ${AVAIL_MB} MiB"

if [ "$AVAIL_MB" -lt 300 ]; then
    err "Less than 300 MiB free — running the scanner risks OOM-killing the game."
    err "Free some memory or run anyway with FORCE=1."
    if [ "${FORCE:-0}" != "1" ]; then
        exit 2
    fi
    warn "FORCE=1 set, proceeding despite low memory"
fi

# ─── Run scanner ──────────────────────────────────────────────────────────
say "Running EntityListFinder.Scan(pid=${PID}, maxEntities=${MAX_ENTITIES})…"
echo

# Build once if needed, then run. Captures both stdout and stderr.
# The scanner self-terminates after one scan tick; Ctrl+C in terminal is safe.
if ! dotnet run --project "$SCRIPT_DIR" -c Release --no-build 2>&1; then
    # Fall back to building first
    say "Pre-built binary missing, building…"
    dotnet run --project "$SCRIPT_DIR" -c Release 2>&1
fi

SCAN_RC=$?
echo
if [ $SCAN_RC -eq 0 ]; then
    ok "Scanner exited cleanly (rc=0)"
else
    err "Scanner exited with rc=${SCAN_RC}"
    exit 3
fi
