#!/bin/sh
# TeleDash Pro: start, restart or stop the helper service and the kiosk.
#   sh start.sh           at boot (from the hook): stop old copies, start both, kiosk does its boot settle
# Exits non-zero (and leaves running-version alone) when the service cannot be started, so
# install.sh and the app report the reason instead of "installed".
#   sh start.sh restart   from install.sh and the service: same, without the boot settle
#   sh start.sh stop      stop both (uninstall.sh)
# Old copies are found through pid files in $DATA, never with pkill -f: a pattern match can hit
# the shell running this very script.
# -P: the physical path, the same one node reports as its own location, so the service's restart
# and the boot hook start (and later recognise) processes under the same path.
APPDIR=$(cd "$(dirname "$0")/.." && pwd -P)
DATA=${TELEDASH_DATA:-/home/root/teledash}
TMPD=${TELEDASH_TMP:-/tmp}          # logs; overridable only for off-TV tests
export TELEDASH_DATA="$DATA" TELEDASH_TMP="$TMPD"

# Does pid $1 still run a command line containing $2? Guards against a reused pid.
pid_matches() {
  [ "$1" = "$$" ] && return 1
  if [ -r "/proc/$1/cmdline" ]; then
    # arguments are NUL-separated; grep (BusyBox's too) stops at a NUL, so turn them into spaces
    tr '\000' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -qF "$2"
  else
    ps -p "$1" -o command= 2>/dev/null | grep -qF "$2"   # no /proc (developer Mac)
  fi
}

# Direct children of pid $1. /proc/<pid>/stat is "pid (name) state ppid ..."; the greedy ".*)"
# copes with names that contain ")".
children() {
  if [ -r /proc/self/stat ]; then
    cat /proc/[0-9]*/stat 2>/dev/null | sed -n "s/^\([0-9]*\) (.*) [A-Za-z] $1 .*/\1/p"
  else
    pgrep -P "$1" 2>/dev/null
  fi
}

# $1 and all its descendants. Collected before killing anything, because once a parent dies its
# children are re-parented and can no longer be found (the kiosk's luna-send would linger).
tree() {
  all=""; todo=$1
  while [ -n "$todo" ]; do
    next=""
    for p in $todo; do all="$all $p"; next="$next $(children "$p")"; done
    todo=$(echo $next)
  done
  echo $all
}

# stop_one <name> <command-line marker>: stop the process recorded in $DATA/<name>.pid.
stop_one() {
  pidfile=$DATA/$1.pid
  [ -f "$pidfile" ] || return 0
  pid=$(cat "$pidfile" 2>/dev/null)
  case "$pid" in
    ''|*[!0-9]*) ;;
    *)
      if pid_matches "$pid" "$2"; then
        pids=$(tree "$pid")
        kill $pids 2>/dev/null
        n=0
        while kill -0 "$pid" 2>/dev/null && [ $n -lt 3 ]; do sleep 1; n=$((n + 1)); done
        kill -0 "$pid" 2>/dev/null && kill -9 $pids 2>/dev/null
        echo "stopped $1 ($pid)"
      fi ;;
  esac
  rm -f "$pidfile"
}

# Value of KEY=... in kiosk.conf, read rather than sourced so the file can never run code.
conf_value() {
  sed -n "s/^$1=//p" "$DATA/kiosk.conf" 2>/dev/null | tail -n 1 | tr -d "\"' \r"
}

find_node() {
  command -v node 2>/dev/null && return
  for n in /usr/bin/node /usr/local/bin/node; do
    [ -x "$n" ] && { echo "$n"; return; }
  done
}

MODE=${1:-boot}
mkdir -p "$DATA" && chmod 700 "$DATA"

# Full paths, exactly as started below: a bare "server/server.js" would also match some other
# homebrew service whose pid happens to be in a stale pid file after a reboot.
stop_one kiosk "$APPDIR/system/teledash-kiosk.sh"
stop_one server "$APPDIR/server/server.js"
[ "$MODE" = stop ] && exit 0

# Fresh log files: remove first, so a symlink planted under the fixed /tmp name is never followed
# by root.
log_to() { rm -f "$1"; echo "$1"; }

NOHUP=$(command -v nohup 2>/dev/null)

# stdin from /dev/null and output to log files, so nothing keeps the exec service's pipes open
# and its call returns right away.
NODE=$(find_node)
problem=""
if [ -z "$NODE" ]; then
  problem="node not found, so the helper service cannot run on this TV"
elif [ ! -f "$APPDIR/server/server.js" ]; then
  problem="server/server.js missing: helper service not started"
else
  $NOHUP "$NODE" "$APPDIR/server/server.js" < /dev/null > "$(log_to "$TMPD/teledash-server.log")" 2>&1 &
  echo $! > "$DATA/server.pid"
  echo "started server ($!)"
fi

# The watcher always runs: it logs app use for the daily tile order, and takes over Home only
# when kiosk.conf says ENABLED=1 (it re-reads that itself).
if command -v luna-send >/dev/null 2>&1; then
  KARG=""; [ "$MODE" = boot ] && KARG=boot
  $NOHUP sh "$APPDIR/system/teledash-kiosk.sh" $KARG < /dev/null > "$(log_to "$TMPD/teledash-kiosk.log")" 2>&1 &
  echo $! > "$DATA/kiosk.pid"
  echo "started kiosk ($!)"
else
  echo "luna-send not found (not a TV?): Home watcher not started"
fi

if [ -n "$problem" ]; then
  echo "$problem"
  exit 1
fi
VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$APPDIR/appinfo.json" 2>/dev/null | head -n 1)
echo "${VERSION:-unknown}" > "$DATA/running-version"
exit 0
