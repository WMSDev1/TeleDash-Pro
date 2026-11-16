#!/bin/sh
# TeleDash Pro root helper uninstall: sh $APPDIR/system/uninstall.sh [--purge]
# Stops the service and kiosk and removes the boot hook. Settings and secrets in $DATA are kept
# unless --purge is given.
APPDIR=$(cd "$(dirname "$0")/.." && pwd)
DATA=${TELEDASH_DATA:-/home/root/teledash}
HOOK_DIR=${TELEDASH_HOOK_DIR:-/var/lib/webosbrew/init.d}
TMPD=${TELEDASH_TMP:-/tmp}

TELEDASH_DATA="$DATA" sh "$APPDIR/system/start.sh" stop
rm -f "$HOOK_DIR/90-teledash" "$TMPD/teledash-lgmode"
# Nothing runs any more, so the app must offer the install again next time it starts.
rm -f "$DATA/running-version"

if [ "$1" = --purge ]; then
  case "$DATA" in
    ''|/) echo "refusing to remove '$DATA'"; exit 1 ;;
  esac
  rm -rf "$DATA"
  echo "uninstalled, data removed"
else
  echo "uninstalled, data kept in $DATA"
fi
