#!/bin/bash
# Put a development build of TeleDash Pro on a rooted TV in one step:
#   TELEDASH_TV=192.168.1.50 scripts/deploy.sh            check, build, copy, install, confirm the version, reopen
#   TELEDASH_TV=192.168.1.50 scripts/deploy.sh --helper   also (re)install the root helper: sh <APPDIR>/system/install.sh
# Raise "version" in app/appinfo.json before deploying a change. SSH settings: scripts/tv.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

HELPER=0
for a in "$@"; do
  case "$a" in
    --helper) HELPER=1 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
. scripts/tv.sh

APP=$(node -p 'require("./project.json").appId')
APPDIR="/media/developer/apps/usr/palm/applications/$APP"
step() { printf '\n== %s\n' "$*"; }

step "Checks"
sh scripts/check.sh | grep -v '^ok:' || true
sh scripts/check.sh >/dev/null || { echo "Checks failed; nothing was sent to the TV." >&2; exit 1; }

step "Build"
IPK=$(bash scripts/build.sh | tail -n 1)
VER=$(node -p 'require("./app/appinfo.json").version')
[ -f "$IPK" ] || { echo "package not found: $IPK" >&2; exit 1; }
echo "$IPK"

step "Copy to the TV ($TV_HOST)"
tv_scp "$IPK" /tmp/teledash-dev.ipk

step "Install"
# Same installer the service uses for updates. The script goes in on stdin so the remote
# command line is just "sh -s".
tv_ssh "sh -s" <<REMOTE
L=/tmp/teledash-install.log; rm -f \$L
luna-send -i -f luna://com.webos.appInstallService/dev/install '{"id":"$APP","ipkUrl":"/tmp/teledash-dev.ipk","subscribe":true}' > \$L 2>&1 &
P=\$!; i=0
while [ \$i -lt 90 ]; do
  grep -q '"installed"' \$L && break
  grep -qiE 'fail|"returnValue": *false' \$L && break
  sleep 1; i=\$((i + 1))
done
kill \$P 2>/dev/null
rm -f /tmp/teledash-dev.ipk
if ! grep -q '"installed"' \$L; then echo "install did not finish:"; cat \$L; exit 1; fi
V=\$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' $APPDIR/appinfo.json)
echo "installed; the TV now has version \$V"
[ "\$V" = "$VER" ] || { echo "expected $VER"; exit 1; }
REMOTE

if [ "$HELPER" = 1 ]; then
  step "Root helper"
  OUT=$(tv_ssh "sh $APPDIR/system/install.sh" 2>&1) || { echo "$OUT"; echo "helper install failed" >&2; exit 1; }
  echo "$OUT"
  echo "$OUT" | grep -q "^installed $VER" || { echo "helper did not report 'installed $VER'" >&2; exit 1; }
fi

step "Reopen TeleDash Pro"
tv_ssh "luna-send -n 1 luna://com.webos.service.applicationmanager/closeByAppId '{\"id\":\"$APP\"}' >/dev/null 2>&1; sleep 2;
  luna-send -n 1 luna://com.webos.service.applicationmanager/launch '{\"id\":\"$APP\"}' >/dev/null 2>&1; echo reopened"
echo
echo "Done: version $VER is on the TV."
