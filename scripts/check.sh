#!/bin/sh
# TeleDash Pro repository checks (CONTRACT.md, "Tests and checks"). Run locally or in CI:
#   sh scripts/check.sh
# POSIX sh on purpose: CI runs it with dash. The heavier checks live in small node scripts.
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
bad() { echo "FAIL: $*"; fail=1; }
ok()  { echo "ok:   $*"; }

command -v node >/dev/null 2>&1 || { echo "FAIL: node is required"; exit 1; }

# Every file that is or would be committed: tracked plus untracked-but-not-ignored.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  files=$(git ls-files -co --exclude-standard)
else
  files=$(find . -type f ! -path './.git/*' ! -path './build/*' ! -path '*/node_modules/*' \
    ! -path './.data/*' ! -name '.DS_Store' | sed 's|^\./||' | sort)
fi
# File names are one per line; split loops on newlines only.
IFS='
'
pick() { printf '%s\n' "$files" | grep -E "$1" || true; }

# 1. Files that must never be committed.
leaked=$(pick '(^|/)(secrets\.json|id_rsa|id_ed25519|denylist\.txt)$|\.(ipk|sqlite|key|pem|p12)$')
[ -z "$leaked" ] && ok "no secret-bearing files" || bad "files that must stay local: $leaked"

# 2. Personal data and secrets inside files (generic rules + optional local denylist).
if printf '%s\n' "$files" | node scripts/scan.js; then ok "personal-data and secret scan"; else bad "personal-data or secret scan (see lines above)"; fi

# 3. All JavaScript parses.
for f in $(pick '\.js$'); do
  [ -f "$f" ] || continue
  out=$(node --check "$f" 2>&1) && ok "parses: $f" || bad "syntax error: $f
$out"
done

# 4. The TV app is ES5.
app_js=$(pick '^app/[^/]*\.js$')
if [ -n "$app_js" ]; then
  # shellcheck disable=SC2086
  node scripts/es5.js $app_js && ok "ES5: app/*.js" || bad "not ES5 (see lines above)"
fi

# 5. Shell scripts parse: kiosk/ runs under the TV's BusyBox sh, scripts/ under bash.
for f in $(pick '^kiosk/'); do
  [ -f "$f" ] || continue
  sh -n "$f" && ok "parses (sh): $f" || bad "shell syntax error: $f"
done
for f in $(pick '^scripts/[^/]*\.sh$'); do
  bash -n "$f" && ok "parses (bash): $f" || bad "bash syntax error: $f"
done

# 6. JSON is valid.
for f in $(pick '\.json$'); do
  [ -f "$f" ] || continue
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$f" 2>/dev/null \
    && ok "valid JSON: $f" || bad "invalid JSON: $f"
done

# 7. The app id and version agree with project.json.
if node -e '
  var p = require("./project.json"), a = require("./app/appinfo.json");
  if (a.id !== p.appId) { console.error("app/appinfo.json id " + a.id + " != project.json appId " + p.appId); process.exit(1); }
  if (!/^\d+\.\d+\.\d+$/.test(a.version)) { console.error("app/appinfo.json version is not x.y.z: " + a.version); process.exit(1); }'
then ok "app id and version"; else bad "app id or version"; fi

# 8. Tests.
for t in test/unit.js test/*.test.js service/test/*.test.js scripts/test-*.js; do
  [ -f "$t" ] || continue
  out=$(node "$t" 2>&1) && ok "test: $t" || bad "test failed: $t
$(printf '%s\n' "$out" | tail -n 15)"
done

[ "$fail" = 0 ] && echo "all checks passed" || echo "some checks FAILED"
exit $fail
