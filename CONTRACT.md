# TeleDash Pro — build contract

The fixed interfaces between the parts of TeleDash Pro. Each part is built separately; anything
that crosses a boundary is defined here and nowhere else. If a builder needs to change something
in this file, it says so in its report instead of changing it silently.

TeleDash Pro is an open-source home screen for rooted LG webOS TVs (Homebrew Channel). This
repository must contain **no personal data**: no names, home
locations, IP addresses, calendar addresses, account names, repository names of private
projects, or passwords (not even well-known defaults). Defaults are generic.

## Targets and constraints

| Part | Runs on | Language level |
|---|---|---|
| `app/` (web app) | LG webOS 6 browser engine, Chromium ~79 | ES5 only: `var`, `function`, no arrow functions, no template literals, no `let/const`, no Promise-only APIs without fallback, no `fetch` (use `XMLHttpRequest`), no CSS flex `gap` |
| `service/` (helper server) | Node.js on the TV (Assumed v12; may be older — do not use anything newer than Node 12: no `??`, no `?.`, no `fetch`, no `fs/promises`, no top-level await) | CommonJS, **zero dependencies** (built-in modules only) |
| `kiosk/` (shell) | TV's BusyBox `sh` as root | POSIX sh, BusyBox applets only (no bash-isms, no `[[`, no arrays) |
| `site/` (GitHub Pages) | phone and desktop browsers | plain HTML/JS, no build step |
| `scripts/`, `test/`, CI | developer Mac / Linux CI | bash, Node 22 in CI |

The service must also **run on a developer Mac** for testing: everything TV-specific (`luna-send`,
paths under `/home/root`) degrades gracefully when absent.

## Names and paths

| Thing | Value |
|---|---|
| Product name | TeleDash Pro |
| App id | `com.teledashpro.dashboard` (`project.json` → `appId`) |
| App install dir on TV | `/media/developer/apps/usr/palm/applications/com.teledashpro.dashboard/` (written `$APPDIR` below) |
| Service port | `8770` (`project.json` → `port`), listening on all interfaces |
| Data dir on TV | `/home/root/teledash/` (mode 700). Override with env `TELEDASH_DATA` (dev runs use `./.data/`) |
| Settings file | `$DATA/settings.json` (non-secret, mode 600) |
| Secrets file | `$DATA/secrets.json` (mode 600). Never sent to any client, never logged |
| Local key | `$DATA/local.token` (mode 600; 32+ random URL-safe chars, created by the service at start and kept across restarts). The app reads it as root through Homebrew Channel and sends it on every `/api/local/*` call |
| Kiosk config | `$DATA/kiosk.conf` (shell-sourceable, written by the service: `ENABLED=0|1`, `DELAY=<seconds>`) |
| Usage log | `$DATA/usage.log` — lines `"<unix seconds> <appId>"`, plus `"<unix> boot"` |
| Running-version marker | `$DATA/running-version` (written by `start.sh`: the app version whose helper is running) |
| LG-mode flag | `/tmp/teledash-lgmode` |
| Kiosk off switch | `$DATA/kiosk-off` (if present the kiosk never launches anything) |
| Logs | `/tmp/teledash-server.log`, `/tmp/teledash-kiosk.log` |
| Boot hook | `/var/lib/webosbrew/init.d/90-teledash` |
| `project.json` | repo root; copied into the package root by the build. `pagesBase` is filled by the release workflow from the GitHub repository (`https://<owner>.github.io/<repo>`); empty in dev builds, which disables Google sign-in with a clear message |

## Package layout (what `scripts/build.sh` stages into `build/stage/` and packages)

```
build/stage/
  appinfo.json, index.html, *.js, icon.png, largeIcon.png   <- app/
  project.json                                              <- repo root
  server/                                                   <- service/   (server.js entry point)
  system/                                                   <- kiosk/     (install.sh, start.sh, uninstall.sh, teledash-kiosk.sh, 90-teledash)
```
Packaged with `ares-package --no-minify build/stage -o build`.

## Who owns what (builders touch only their own paths)

| Builder | Owns |
|---|---|
| A — app | `app/` except `app/qr.js` |
| B — service | `service/` (incl. `service/www/` setup page) |
| C — build & release | `site/`, `scripts/`, `.github/`, `project.json` |
| D — system | `kiosk/` |
| E — QR & tests | `app/qr.js`, `test/` |
| F — docs | `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/` |

## Settings schema (`settings.json`; the service is the source of truth)

```json
{
  "rev": 0,
  "apps": null,
  "columns": 6,
  "idleSeconds": 120,
  "weather": null,
  "alerts": { "warnings": true, "airQuality": true },
  "market": { "show": true, "indexes": [ {"symbol":"^GSPC","label":"S&P 500"}, {"symbol":"^IXIC","label":"Nasdaq"}, {"symbol":"^DJI","label":"Dow"} ] },
  "feed": { "enabled": false, "title": "", "url": "", "format": "json",
            "csv": { "date": "date", "value": "value", "flows": "", "time": "" } },
  "calendar": { "source": "none", "calendars": ["primary"] },
  "morning": { "weekdays": {"from":"06:30","to":"09:00"}, "weekends": {"from":"07:30","to":"10:00"} },
  "countdowns": { "holidays": true, "withinDays": 45, "dates": [] },
  "tileOrder": "daily",
  "pinned": ["com.webos.app.hdmi1", "com.webos.app.home"],
  "home": { "opensDashboard": false, "delaySeconds": 1 },
  "updates": { "auto": false }
}
```
- `rev` increases by one on every save; the app re-applies settings when it changes.
- `apps`: `null` = automatic (installed, visible, non-system apps from the TV's app list, ordered by
  use) followed by `HDMI 1`, `Set up` and `All apps`; or an array `[{ "id", "title", "color"? }]`
  (the setup page's own list, in its order; `HDMI 1` appears only if listed). In both cases the
  app inserts the `Set up` tile (internal id `teledash.setup`) just before `All apps`, and adds
  `All apps` at the end if the list lacks it.
  The `All apps` tile is `{ "id": "com.webos.app.home", "title": "All apps", "exit": true }`.
- `pinned`: ids that keep their place when tiles are re-sorted by use; `Set up` and `All apps` are
  always pinned (and `HDMI 1` in automatic mode).
- `weather`: `null` (off) or `{ "latitude", "longitude", "label", "fahrenheit" }`; coordinates are
  rounded to 1 decimal place by the service before saving (privacy: ~10 km).
- `calendar.source`: `"none" | "ical" | "google"`.
- `feed.format`: `"json"` (TeleDash feed, below) or `"csv"` (last row of a CSV; columns named in `feed.csv`).
- `morning`: `"HH:MM"` 24-hour; `null` for a day group turns morning mode off for it.
- `countdowns.dates`: `[{ "title", "date": "MM-DD" | "YYYY-MM-DD" }]`.
- `home.delaySeconds`: 0–30. `updates.auto`: default **false**.

Secrets (`secrets.json`), write-only from the setup page:
`{ "icalUrl", "google": { "clientId", "clientSecret", "refreshToken", "accessToken", "expiry" }, "feedToken", "feedTokenOrigin" }`

## Service HTTP API (port 8770)

All responses are JSON unless noted, with `Access-Control-Allow-Origin: *` on `/api/local/*` only.
Every request whose `Host` header is not an IP address or `localhost` (any port) gets 403: this
blocks DNS rebinding. Real clients always use an IP address (the QR code, `127.0.0.1`).
Errors: HTTP 4xx/5xx with `{ "error": "<plain-English message>" }` (for example 404 when no feed is
set up, 502 when the calendar or feed source fails); clients treat any non-2xx as "no data".

### Local endpoints — only from the TeleDash app on the TV itself
Accepted only when the socket's remote address is loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`)
**and** the request carries header `X-TeleDash-Local: <contents of $DATA/local.token>`; anything else
gets 403 (loopback alone is not enough: web pages in the TV's browser and other apps on the TV also
connect from 127.0.0.1). `OPTIONS` preflights are answered without the key and allow that header.
The web app calls these at `http://127.0.0.1:8770`; it reads the key at start, and again after a 403.

| Method & path | Returns |
|---|---|
| `GET /api/local/state` | `{ "version", "settings", "connected": { "ical": bool, "google": bool, "feed": bool }, "update": { "current", "latest", "available": bool, "auto": bool } }` — `settings` is the full settings object (no secrets) |
| `POST /api/local/pair` | `{ "url": "http://<lan-ip>:8770/s/<code>", "code", "expires" }` — new one-time pairing code, 8+ random URL-safe chars, valid 10 minutes, single use; invalidates the previous one. `url` uses the TV's first private (else first non-loopback) IPv4 address. `expires` is Unix time in milliseconds |
| `GET /api/local/calendar?days=2&tz=<minutes>` | `{ "source": "none" }`, or `{ "source": "ical", "ics": "<iCalendar text>" }`, or `{ "source": "google", "events": [ { "summary", "start", "end", "allDay" } ] }` (ISO 8601 times; all-day events use `YYYY-MM-DD`), covering today plus `days-1` more days in the TV's local time (Google: plus 2 h spare for a daylight-saving change). `tz` (optional) is the app's `Date#getTimezoneOffset()`, because node on the TV may not run in the zone the TV shows; outside −840…840 → 400. Cached ≤5 min |
| `GET /api/local/feed` | `{ "title", "asOf", "items": [ { "label", "value", "change"?, "format"? } ] }`. Cached ≤5 min |
| `GET /api/local/usage` | `text/plain` usage log (last 6000 lines) |
| `POST /api/local/update` | starts installing the latest release now (same steps as automatic update) → `{ "started": true }` or `{ "error" }` |

### Setup endpoints — from a phone on the same network
| Method & path | Behaviour |
|---|---|
| `GET /s/<code>` | valid code → sets cookie `td_session` (random, HttpOnly, SameSite=Lax, 12 h), consumes the code, redirects to `/setup`; invalid → plain page "This code has expired — press OK on the TV for a new one" |
| `GET /setup` | the setup page (`service/www/setup.html`); without a valid session → the expired page |
| `GET /api/settings` | settings (session required) |
| `PUT /api/settings` | partial update, validated field by field against the schema; unknown keys rejected; returns the saved settings |
| `POST /api/secrets` | `{ "icalUrl"? , "google": { "clientId", "clientSecret" }?, "feedToken"? }` → `{ "ok": true }`; values never echoed back. `icalUrl` must be `https://` or `webcal://` (stored as `https://`) |
| `DELETE /api/secrets/<icalUrl|google|feedToken>` | removes it; removing the secret of the current `calendar.source` also sets it to `"none"` |
| `GET /api/apps` | installed apps `[ { "id", "title" } ]` (via `luna-send ... listApps`; `[]` off-TV) |
| `POST /api/google/start` | `{ "authUrl" }` (see below); error if `pagesBase` is empty or no client id |
| `GET /api/google/calendars` | `[ { "id", "summary", "primary" } ]` |
| `GET /oauth/return?code&state` | completes Google sign-in (no session cookie needed: protected by the single-use `state` nonce + PKCE), then redirects to `/setup?google=ok` or `/setup?google=error` |
| `GET /api/status` | `{ "version", "connected": {...}, "stored": { "icalUrl", "googleClient", "googleSignedIn", "feedToken" } (booleans), "update": {..., "installing", "error"}, "google": { "available", "redirectUri", "lastError" } }` (session required) |
| `POST /api/update` | same as `POST /api/local/update`, for the setup page's "Update now" (the phone cannot reach the loopback-only endpoint) |

Every state-changing setup request requires the session cookie **and** an `X-TeleDash: 1` header
(blocks cross-site form posts). Session-less requests get 401. Sessions are stored as hashes in
`$DATA/sessions.json` (600) so they survive the service restart after a `home.*` change.

## Google sign-in (no device flow: Google does not allow Calendar scopes on it)

1. The user creates their own Google Cloud project and an OAuth client of type **Web application**,
   with authorised redirect URI `<pagesBase>/oauth/` (docs explain), and pastes the client id and
   secret into the setup page.
2. `POST /api/google/start` creates `state = base64url(JSON {"t": "http://<lan-ip>:8770", "n": "<nonce>"})`
   and a PKCE verifier/challenge (S256), remembers nonce → verifier for 10 minutes, and returns
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=<pagesBase>/oauth/&response_type=code&scope=https://www.googleapis.com/auth/calendar.readonly&access_type=offline&prompt=consent&state=…&code_challenge=…&code_challenge_method=S256`.
3. Google returns the phone to `site/oauth/index.html`, which decodes `state`, **checks `t` is
   `http://` + a private IPv4 address (10/8, 172.16/12, 192.168/16) + `:` port**, and only then
   does `location.replace(t + "/oauth/return" + location.search)`. Anything else: shows an error,
   never redirects (no open redirect).
4. The service checks the nonce, exchanges the code at `https://oauth2.googleapis.com/token`
   (with client secret + verifier + same redirect URI), stores the refresh token in secrets, and
   sets `calendar.source = "google"`.
5. Calendar reads use `https://www.googleapis.com/calendar/v3/calendars/<id>/events?singleEvents=true&orderBy=startTime&timeMin&timeMax`.

## Data feed

- `feed.url` is any HTTPS URL, or `github:<owner>/<repo>/<path>[@ref]`, which the service turns into
  `https://api.github.com/repos/<owner>/<repo>/contents/<path>?ref=<ref>` with
  `Accept: application/vnd.github.raw` and, if `feedToken` is set, `Authorization: Bearer <token>`.
  For plain HTTPS URLs the token (if set) is sent the same way.
- The token is tied to the origin the feed address resolves to when it is saved (`feedTokenOrigin`
  in `secrets.json`; `https://api.github.com` for `github:` addresses) and is sent only to that
  origin. A token saved before any address is tied to the first address saved after it; changing
  the address to a different origin deletes the token (the setup page then shows "No token saved").
- `format: "json"` — TeleDash feed v1:
  `{ "title": "Account", "asOf": "2026-01-02 15:00", "items": [ { "label": "Value", "value": 1234.5, "change": 12.3, "format": "usd" } ] }`
  (`format`: `"usd" | "number" | "percent"`; default number).
- `format: "csv"` — header row required. Uses the last row with a non-empty `value` column: item
  `{ label: feed.title || "Value", value, format: "usd" }`; `change` = value − value of the last row
  with an earlier `date`, minus the difference in the `flows` column if `flows` is named (deposits
  are not gains). `asOf` = that row's `date` + `time` column if named.

## Web app ↔ service

- The app works **without** the service (no root, or service not started): built-in defaults from
  `app/config.js`, weather/market as configured there, no calendar/feed, a one-line hint
  "Setup helper not running".
- With the service: on start and every 30 s the app calls `/api/local/state`; when `settings.rev`
  changes it rebuilds from `DEFAULTS` + settings (cached in `localStorage` key `teledash.settings`
  so the last good settings apply instantly on the next launch).
- Setup screen on the TV: a "Set up" tile (pinned, before `All apps`) and the remote's `0`/blue key
  open an overlay: QR code of the `/api/local/pair` URL, the URL in text, and the code; it refreshes
  the code every 9 minutes while open. Back/Esc closes it.
- QR: `app/qr.js` exposes `QR.matrix(text)` → array of rows of booleans (byte mode, error
  correction M, smallest version that fits, versions 1–10 at least) and `QR.svg(text, sizePx)` →
  SVG markup string. UMD-style: `var QR = …; if (typeof module !== "undefined") module.exports = QR;`
- App icons: tiles for apps without a `logo` use the TV's own icon from the app list
  (`luna://com.webos.applicationManager/listApps` via `WebOSServiceBridge`/`PalmServiceBridge`;
  fields `id`, `title`, `icon`, `largeIcon`, `iconColor`/`bgColor` where present — Assumed; if that call gives no apps, the same
  list from `luna-send -n 1 luna://com.webos.service.applicationmanager/listApps '{}'` run as root
  through Homebrew Channel), falling
  back to the title on a solid colour. No streaming-service logos are bundled.

## Root helper install (kiosk + service) — consent on the TV

- `system/install.sh` (run as root through Homebrew Channel's exec service
  `luna://org.webosbrew.hbchannel.service/exec`, `{ "command": "sh $APPDIR/system/install.sh" }`):
  creates `$DATA` (700), writes the boot hook `90-teledash`, which runs `$APPDIR/system/start.sh`
  if it exists (and does nothing if the app was uninstalled), then runs `start.sh`. Idempotent.
  Prints `installed <version>` on success.
- `system/start.sh [restart]`: (re)starts the service (`node $APPDIR/server/server.js`, logging to
  `/tmp/teledash-server.log`) if `node` exists (try `command -v node`, then `/usr/bin/node`), and the
  kiosk script (always, when `luna-send` exists: it logs app use, and takes over Home only when
  `kiosk.conf` says `ENABLED=1`); log files are removed before being written. Writes
  `running-version` and exits 0 only when the service was started; otherwise prints the reason as
  its last line and exits 1 (`install.sh` then prints `install failed: <reason>`). `$APPDIR` is the
  physical path (`pwd -P`), and old copies are recognised by the full script path. Stops old copies first without
  matching its own command line (`pkill -f <name>` run inside a shell whose command line contains
  `<name>` kills itself — use pid files in `$DATA`: `server.pid`, `kiosk.pid`). No argument = boot
  (the kiosk does its boot settle); `restart` skips the settle; `stop` stops both. The service runs
  `start.sh restart` through a detached shell, because start.sh stops the server's process tree.
- `system/uninstall.sh`: stops both, removes the boot hook; keeps `$DATA` unless given `--purge`.
- The app, on launch, if Homebrew Channel's exec service answers and `$DATA/running-version` differs
  from its own version (or is missing): first run → shows a one-time screen on the TV ("TeleDash
  Pro can install a small helper so you can set it up from your phone and make Home open
  TeleDash. Install?" OK / Not now); after an update → re-runs `install.sh` silently.
- Kiosk behaviour (`system/teledash-kiosk.sh`): boot settle; Home returns to the dashboard; LG
  mode flag; 5-second anti-bounce brake; usage log (trimmed to 6000 lines); plus: re-reads
  `kiosk.conf` (parsed, never sourced) on every Home event, waits `DELAY` seconds (default 1) before returning, and
  with `ENABLED=0` keeps logging but never launches anything (boot settle only when enabled). The
  `"<unix> boot"` line is written only at power-on (`boot` argument), not on a restart. The service
  writes `kiosk.conf` and runs `system/start.sh restart` when `home.*` settings change.

## Automatic updates (service side; off by default)

- Once a day (and on `POST /api/local/update`), the service reads `<pagesBase>/repo/com.teledashpro.dashboard.manifest.json`
  (Homebrew Channel manifest: `id`, `version`, `ipkUrl`, `ipkHash.sha256`, …). If `version` is newer
  than the running app's and `updates.auto` is true (or the update was requested), it downloads
  `ipkUrl`, **verifies the SHA-256**, writes it (mode 644, exclusive create) into a fresh private
  directory `/tmp/teledash-update-XXXXXX/` (mode 711; never a fixed name in world-writable `/tmp`),
  and installs it with
  `luna-send -i luna://com.webos.appInstallService/dev/install '{"id":"com.teledashpro.dashboard","ipkUrl":"<that file>","subscribe":true}'`
  (subscribed: the first reply only acknowledges the request), waits up to 2 minutes for
  `"installed"`, removes the directory, then relaunches the app only if it is on screen (or was,
  and the install closed it): an update never interrupts another app.
- `GET /api/local/state` → `update` reports what it knows.

## Homebrew Channel repository (site, built by CI on release)

- `site/` is published to GitHub Pages. The release workflow adds `repo/` with the package manifest
  above, `icon.png` and the repository index `apps.json` (format taken from webosbrew's sources:
  `{ paging, packages: [ { id, title, manifestUrl, manifest, pool, … } ] }`; users add
  `<pagesBase>/repo/apps.json` in Homebrew Channel — not yet tried on a TV), plus `oauth/`.
- Releases are tag-driven (`v*`). `app/appinfo.json` `version` must equal the tag.

## Tests and checks (CI and local)

`scripts/check.sh` runs everything: personal-data and secret scan over tracked files, `node --check`
on all JS, ES5 check on `app/*.js` (parse with `ecmaVersion: 5` when a parser is available locally,
otherwise a regex check for `=>`, `` ` ``, `let `, `const `), `sh -n` on `kiosk/*`, `bash -n` on
`scripts/*.sh`, JSON validity, and `node test/unit.js` (+ any `test/*.test.js`,
`service/test/*.test.js` and `scripts/test-*.js`).
