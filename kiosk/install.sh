#!/bin/sh
# TeleDash Pro root helper install. Run as root by the app through Homebrew Channel's exec
# service: sh $APPDIR/system/install.sh
# Safe to run any number of times (first install and after every app update).
# Off-TV testing: TELEDASH_DATA and TELEDASH_HOOK_DIR override the data dir and hook dir.
APPDIR=$(cd "$(dirname "$0")/.." && pwd)
DATA=${TELEDASH_DATA:-/home/root/teledash}
HOOK_DIR=${TELEDASH_HOOK_DIR:-/var/lib/webosbrew/init.d}
HOOK=$HOOK_DIR/90-teledash

fail() { echo "install failed: $*"; exit 1; }

[ -f "$APPDIR/system/start.sh" ] || fail "start.sh not found under $APPDIR/system"
[ -f "$APPDIR/system/90-teledash" ] || fail "boot hook template not found"

# Data dir: settings and secrets live here, so only root may read it.
mkdir -p "$DATA" || fail "cannot create $DATA"
chmod 700 "$DATA"

# Boot hook: bake in absolute paths (boot has no idea where the app lives). '|' as the sed
# delimiter because the paths contain '/'. Write a temp file and rename so a half-written hook
# never runs.
mkdir -p "$HOOK_DIR" || fail "cannot create $HOOK_DIR"
sed -e "s|@APPDIR@|$APPDIR|g" -e "s|@DATA@|$DATA|g" "$APPDIR/system/90-teledash" > "$HOOK.tmp" ||
  fail "cannot write $HOOK"
chmod 755 "$HOOK.tmp" && mv -f "$HOOK.tmp" "$HOOK" || fail "cannot install $HOOK"

# Kiosk config: off by default; the service rewrites it when the user changes Home settings.
if [ ! -f "$DATA/kiosk.conf" ]; then
  printf 'ENABLED=0\nDELAY=1\n' > "$DATA/kiosk.conf" && chmod 600 "$DATA/kiosk.conf"
fi

# start.sh's own message (for example "node not found ...") becomes the reason the app shows.
out=$(TELEDASH_DATA="$DATA" sh "$APPDIR/system/start.sh" restart 2>&1); rc=$?
[ -n "$out" ] && echo "$out"
[ "$rc" = 0 ] || fail "$(echo "$out" | tail -n 1)"

VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$APPDIR/appinfo.json" 2>/dev/null | head -n 1)
echo "installed ${VERSION:-unknown}"
