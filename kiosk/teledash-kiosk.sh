#!/bin/sh
# TeleDash Pro kiosk: watches which app is in front, logs it for the daily tile order, and (when
# kiosk.conf says ENABLED=1) makes Home on the remote return to the TeleDash dashboard.
# Started by system/start.sh (pid in $DATA/kiosk.pid, log in /tmp/teledash-kiosk.log).
#   sh teledash-kiosk.sh boot   at power-on: mark the boot in the usage log and, if enabled, keep
#                               putting the dashboard in front while the TV starts up
#   sh teledash-kiosk.sh        after a restart: just watch
# - The usage log is written whether or not the Home button is taken over: tiles are "ordered by
#   use" with the default settings too. With ENABLED=0 nothing is ever launched.
# - Home returns to the dashboard DELAY seconds after LG's home appears, except in "LG mode",
#   which the app's All apps tile turns on (/tmp/teledash-lgmode) and any other app turns off.
# - kiosk.conf is re-read on every Home press, so a changed DELAY or ENABLED applies at once.
APP=com.teledashpro.dashboard
HOME_APP=com.webos.app.home
DATA=${TELEDASH_DATA:-/home/root/teledash}
TMPD=${TELEDASH_TMP:-/tmp}
CONF=$DATA/kiosk.conf
OFF=$DATA/kiosk-off              # hard off switch: if this file exists, nothing is ever launched
LGMODE=$TMPD/teledash-lgmode     # written by the All apps tile
USAGE=$DATA/usage.log            # "<unix seconds> <appId>" per foreground change; read by the app
BRAKE=5                          # never bounce twice within this many seconds
LAST=0

# Value of KEY=... in kiosk.conf, read rather than sourced so the file can never run code.
conf_value() {
  sed -n "s/^$1=//p" "$CONF" 2>/dev/null | tail -n 1 | tr -d "\"' \r"
}

# Sets ENABLED (1 or not) and DELAY (whole seconds, 0-30, default 1).
read_conf() {
  ENABLED=$(conf_value ENABLED)
  DELAY=$(conf_value DELAY)
  case "$DELAY" in
    ''|*[!0-9]*) DELAY=1 ;;
    ???*) DELAY=30 ;;
  esac
  [ "$DELAY" -gt 30 ] && DELAY=30
}

front() {
  luna-send -n 1 luna://com.webos.service.applicationmanager/getForegroundAppInfo '{}' 2>/dev/null |
    sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p'
}

launch() {
  [ -e "$OFF" ] && return
  luna-send -n 1 luna://com.webos.service.applicationmanager/launch "{\"id\":\"$APP\"}" >/dev/null 2>&1
}

# Boot phase: the TV may not be ready yet, and it may switch to the last input (e.g. HDMI 1)
# after we launch. Keep launching once a second until the dashboard has held the front for
# 5 seconds in a row, for at most 90 seconds.
boot_settle() {
  i=0; ok=0
  while [ $i -lt 90 ]; do
    [ -e "$OFF" ] && return
    f=$(front)
    if [ "$f" = "$APP" ]; then
      ok=$((ok + 1))
      [ $ok -ge 5 ] && { echo "$(date +%T)  boot: dashboard is in front"; return; }
    else
      ok=0
      echo "$(date +%T)  boot: front is '${f:-nothing yet}', launching dashboard"
      launch
    fi
    sleep 1; i=$((i + 1))
  done
  echo "$(date +%T)  boot: gave up after 90 seconds"
}

read_conf
[ "$ENABLED" = 1 ] || echo "$(date +%T)  Home button not taken over (ENABLED=0): only logging app use"

# Keep the usage log to its last 6000 lines (roughly months of normal use). At power-on, mark the
# boot so the app does not count the time the TV was off as time in the last app; a restart (a
# settings change) is not a boot and must not cut the current app's time short.
if [ -f "$USAGE" ]; then tail -n 6000 "$USAGE" > "$USAGE.tmp" && mv "$USAGE.tmp" "$USAGE"; fi
if [ "$1" = boot ]; then
  echo "$(date +%s) boot" >> "$USAGE"
  [ "$ENABLED" = 1 ] && boot_settle
fi

while true; do
  prev=""
  luna-send -i luna://com.webos.service.applicationmanager/getForegroundAppInfo '{"subscribe":true}' 2>/dev/null |
  while read -r line; do
    cur=$(echo "$line" | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')
    [ -z "$cur" ] && continue
    echo "$(date +%T)  ${prev:-start} -> $cur"
    [ "$cur" != "$prev" ] && echo "$(date +%s) $cur" >> "$USAGE"
    if [ "$cur" = "$HOME_APP" ]; then
      read_conf
      if [ "$ENABLED" != 1 ]; then
        echo "            Home button not taken over (ENABLED=0), leaving it"
      elif [ -e "$LGMODE" ]; then
        echo "            LG mode, staying"
      elif [ $(( $(date +%s) - LAST )) -lt $BRAKE ]; then
        echo "            just bounced, leaving it (safety brake)"
      else
        sleep "$DELAY"
        if [ "$(front)" = "$HOME_APP" ]; then
          echo "            bounce to dashboard (after ${DELAY}s)"
          LAST=$(date +%s)
          launch
        fi
      fi
    elif [ -e "$LGMODE" ]; then
      rm -f "$LGMODE"
      echo "            LG mode off"
    fi
    prev=$cur
  done
  sleep 5                        # the subscription ended (luna-send restarted?): subscribe again
done
