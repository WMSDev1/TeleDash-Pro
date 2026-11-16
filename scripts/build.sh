#!/bin/bash
# Build the TeleDash Pro package (CONTRACT.md, "Package layout"):
#   app/ + project.json -> build/stage/,  service/ -> build/stage/server/,  kiosk/ -> build/stage/system/
# then  ares-package --no-minify build/stage -o build.
#   scripts/build.sh               stage and package
#   scripts/build.sh --stage-only  stage only (no ares-package needed)
#   EXPECT_VERSION=1.2.3 scripts/build.sh   also require app/appinfo.json to have that version (release)
# Needs node and, for packaging, ares-package (npm package @webos-tools/cli).
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE_ONLY=0
for a in "$@"; do
  case "$a" in
    --stage-only) STAGE_ONLY=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
die() { echo "build: $*" >&2; exit 1; }

APP_ID=$(node -p 'require("./project.json").appId')
ID=$(node -p 'require("./app/appinfo.json").id')
VER=$(node -p 'require("./app/appinfo.json").version')
[ "$ID" = "$APP_ID" ] || die "app/appinfo.json id '$ID' is not project.json appId '$APP_ID'"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "app/appinfo.json version '$VER' is not x.y.z"
if [ -n "${EXPECT_VERSION:-}" ] && [ "$VER" != "$EXPECT_VERSION" ]; then
  die "app/appinfo.json version $VER does not match expected $EXPECT_VERSION"
fi
for d in app service kiosk; do [ -d "$d" ] || die "missing $d/"; done

# Copy a source tree without tests, local data or editor/OS litter. tar --exclude works the
# same with BSD tar (Mac) and GNU tar (CI). COPYFILE_DISABLE stops macOS adding ._ metadata files.
copy_tree() {
  mkdir -p "$2"
  COPYFILE_DISABLE=1 tar -C "$1" -cf - --exclude='._*' \
    --exclude='test' --exclude='tests' --exclude='*.test.js' --exclude='*.spec.js' \
    --exclude='node_modules' --exclude='.data' --exclude='.DS_Store' --exclude='*.md' \
    --exclude='*.map' --exclude='.eslintrc*' --exclude='.git*' --exclude='*.log' . \
    | tar -C "$2" -xf -
}

STAGE=build/stage
rm -rf "$STAGE"
copy_tree app "$STAGE"
cp project.json "$STAGE/project.json"
copy_tree service "$STAGE/server"
# The project's Google sign-in client (ADR-31): from $TELEDASH_GOOGLE_CLIENT (the release job's
# secret, the JSON text) or a local google-client.json. Never in git. Without it the package
# still works; the phone page then offers only an owner's own client.
if [ -n "${TELEDASH_GOOGLE_CLIENT:-}" ]; then printf '%s' "$TELEDASH_GOOGLE_CLIENT" > "$STAGE/google-client.json"
elif [ -f google-client.json ]; then cp google-client.json "$STAGE/google-client.json"; fi
if [ -f "$STAGE/google-client.json" ]; then
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),w=j.web||j.installed||j;
    if(!/\.apps\.googleusercontent\.com$/.test(w.client_id||w.clientId||"")||!(w.client_secret||w.clientSecret))process.exit(1)' \
    "$STAGE/google-client.json" || die "google-client.json is not a Google OAuth client file"
  chmod 644 "$STAGE/google-client.json"
  echo "Google sign-in client included"
else
  echo "no Google sign-in client (google-client.json): sign-in needs an owner's own client"
fi
copy_tree kiosk "$STAGE/system"
# The TV runs these through sh, but keep them executable for anyone running them directly.
find "$STAGE/system" -type f -exec chmod 755 {} +

# The staged package must be what the contract says the TV will find.
[ -f "$STAGE/server/server.js" ] || die "service/server.js is missing (staged as server/server.js)"
for f in install.sh start.sh uninstall.sh teledash-kiosk.sh 90-teledash; do
  [ -f "$STAGE/system/$f" ] || die "kiosk/$f is missing (staged as system/$f)"
done
SVER=$(node -p 'require("./'"$STAGE"'/appinfo.json").version')
[ "$SVER" = "$VER" ] || die "staged appinfo.json version $SVER is not $VER"
echo "staged $ID $VER in $STAGE"
[ "$STAGE_ONLY" = 1 ] && exit 0

command -v ares-package >/dev/null 2>&1 || die "ares-package not found (npm install -g @webos-tools/cli)"
IPK="build/${ID}_${VER}_all.ipk"
rm -f "$IPK"
ares-package --no-minify "$STAGE" -o build >/dev/null
[ -f "$IPK" ] || die "package not found: $IPK"
echo "$IPK"
