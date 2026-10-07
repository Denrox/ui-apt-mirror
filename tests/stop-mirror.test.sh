#!/bin/bash
# Regression tests for scripts/stop-mirror.sh with stand-in sync processes (no apt-mirror needed):
#   bash tests/stop-mirror.test.sh
set -u

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK=$(mktemp -d)
export MIRROR_SYNC_LOCK="$WORK/apt-mirror.lock" MIRROR_SYNC_STOP="$WORK/apt-mirror.stop"
started=()
cleanup() {
    local pid
    for pid in "${started[@]}"; do pkill -KILL -P "$pid" 2>/dev/null; kill -KILL "$pid" 2>/dev/null; done
    rm -rf "$WORK"
}
trap cleanup EXIT

failures=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; failures=$((failures + 1)); fi; }

# Stand-in for apt-mirror2: exits at once on TERM when $1 is "quick", else ignores TERM.
cat > "$WORK/apt-mirror-signed.py" <<'PY'
import signal, sys, time
if sys.argv[1] == "slow":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(120)
PY
# Stand-in for mirror-sync.sh: takes the lock, runs the stand-in like the real script, then cleans up.
cat > "$WORK/mirror-sync.sh" <<EOF2
#!/bin/bash
echo \$\$ > "$MIRROR_SYNC_LOCK"
timeout 300 python3 "$WORK/apt-mirror-signed.py" "\$1" 2>&1 | tee -a "$WORK/log" >/dev/null
[ "\$(cat "$MIRROR_SYNC_LOCK" 2>/dev/null)" = \$\$ ] && rm -f "$MIRROR_SYNC_LOCK"
rm -f "$MIRROR_SYNC_STOP"
EOF2
chmod +x "$WORK/mirror-sync.sh"

start_sync() { "$WORK/mirror-sync.sh" "$1" & started+=("$!"); LAST=$!; sleep 0.5; }

echo "# a normal stop ends the run and removes its lock"
start_sync slow
OLD=$LAST
"$SRC/scripts/stop-mirror.sh" > "$WORK/out"
sleep 0.5
check "stand-in apt-mirror killed" '! pgrep -f "^python3 $WORK/apt-mirror-signed.py slow" >/dev/null'
check "lock removed" '[ ! -f "$MIRROR_SYNC_LOCK" ]'
check "says stopped" 'grep -q "stopped successfully" "$WORK/out"'
wait "$OLD" 2>/dev/null

echo "# a sync started while Stop still waits is left alone"
start_sync quick
OLD=$LAST
"$SRC/scripts/stop-mirror.sh" > "$WORK/out" &
STOPPER=$!
sleep 1      # the old run is gone; Stop is in its 3 s wait
wait "$OLD" 2>/dev/null
start_sync slow
NEW=$LAST
wait "$STOPPER"
check "the new run's apt-mirror still runs" 'pgrep -f "^python3 $WORK/apt-mirror-signed.py slow" >/dev/null'
check "the new run's lock is kept" '[ "$(cat "$MIRROR_SYNC_LOCK" 2>/dev/null)" = "$NEW" ]'
"$SRC/scripts/stop-mirror.sh" >/dev/null
check "a second Stop ends the new run" '! pgrep -f "^python3 $WORK/apt-mirror-signed.py slow" >/dev/null && [ ! -f "$MIRROR_SYNC_LOCK" ]'

echo "# no lock: nothing to stop"
check "refused without a lock" '! "$SRC/scripts/stop-mirror.sh" >/dev/null'

echo
if [ "$failures" -eq 0 ]; then echo "All stop-mirror tests passed"; else echo "$failures test(s) failed"; exit 1; fi
