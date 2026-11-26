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
| Dev-run switches | env `TELEDASH_PAGES_BASE` overrides `pagesBase` (a run from the repository can borrow a published return page for sign-in). In a browser with no TV service bridge the app reads the helper's key from `localStorage` key `teledash.devkey` instead of the root shell; on a TV that path is never taken |
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
  "night": { "from": "22:00" },
  "countdowns": { "holidays": true, "withinDays": 45, "dates": [] },
  "tileOrder": "daily",
  "pinned": ["com.webos.app.hdmi1", "com.webos.app.home"],
  "home": { "opensDashboard": false, "delaySeconds": 1 },
  "updates": { "auto": false },
  "music": { "tile": false, "fadeSeconds": 8, "fadeTo": 0, "skin": "retro" }
}
```
- `rev` increases by one on every save; the app re-applies settings when it changes.
- `apps`: `null` = automatic (installed, visible, non-system apps from the TV's app list, ordered by
  use) followed by `HDMI 1`, `Set up`, `Morning brief`, `Night` and `All apps`; or an array `[{ "id", "title", "color"? }]`
  (the setup page's own list, in its order; `HDMI 1` appears only if listed). In both cases the
  app inserts the `Set up`, `Morning brief` and `Night` tiles (internal ids `teledash.setup`,
  `teledash.brief`, `teledash.night`) just before `All apps`, and adds
  `All apps` at the end if the list lacks it.
  The `All apps` tile is `{ "id": "com.webos.app.home", "title": "All apps", "exit": true }`.
- `pinned`: ids that keep their place when tiles are re-sorted by use; `Set up`, `Morning brief`, `Night` and `All apps` are
  always pinned (and `HDMI 1` in automatic mode).
- `weather`: `null` (off) or `{ "latitude", "longitude", "label", "fahrenheit" }`; coordinates are
  rounded to 1 decimal place by the service before saving (privacy: ~10 km).
- `calendar.source`: `"none" | "ical" | "google"`.
- `feed.format`: `"json"` (TeleDash feed, below) or `"csv"` (last row of a CSV; columns named in `feed.csv`).
- `morning`: `"HH:MM"` 24-hour; `null` for a day group turns morning mode off for it.
- `night.from`: `"HH:MM"`, when night hours start; they end when the morning brief starts on the day
  they end (07:00 if that day has none). `night: null` turns automatic night mode off.
- `countdowns.dates`: `[{ "title", "date": "MM-DD" | "YYYY-MM-DD" }]`.
- `home.delaySeconds`: 0–30. `updates.auto`: default **false**.
- `music.tile`: show the `Music` tile (internal id `teledash.music`, always pinned, placed just
  before `Set up`). Spotify sign-in sets it to `true`; removing the Spotify secret sets it to `false`.
  `music.fadeSeconds`: 0–600, seconds after the last button press before the Music view's artwork
  and controls fade (0 = never). `music.fadeTo`: 0–100, the percent of full opacity they rest at
  once faded (0 = gone, leaving only the visualizer). `music.skin`: `"retro"` (a late-90s desktop
  player: bevelled silver windows, a black LCD with a segment clock), `"modern"` (plain text and
  round buttons in the dashboard's own style) or `"slim"` (one strip along the bottom edge). The
  Music view's own Options list (in its library) changes `fadeSeconds`, `fadeTo` and `skin` with
  the remote, through `POST /api/local/music/settings`.
- Visualizers (`app/viz.js`) draw behind the Music view's artwork and controls: spectrum bars,
  oscilloscope, radial, particles, plasma, or off. The visualizer button in the control row steps
  through them; the choice is kept on the TV in `localStorage` key `teledash.viz` (it is not a
  setting). Each one draws from a frame of sound: `bands`, 64 numbers from 0 to 1 covering 40 Hz to
  16 kHz in equal musical steps (bass first), and `wave`, 256 numbers from -1 to 1. A frame comes
  from `Viz.feed({ bands, wave })`; with none in the last 0.6 s the visualizers move to a made-up
  beat while Spotify plays and say so. What feeds real sound on a TV is not decided yet. In a
  browser on a computer, C shares a tab's or the screen's sound and M the microphone.

Secrets (`secrets.json`), write-only from the setup page:
`{ "icalUrl", "google": { "clientId"?, "clientSecret"?, "refreshToken", "accessToken", "expiry", "tokenClientId" }, "spotify": { "clientId", "refreshToken", "accessToken", "expiry" }, "feedToken", "feedTokenOrigin" }` — `tokenClientId` is the client that issued the tokens; refreshes use that client

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
| `POST /api/local/night` | body `{ "on": bool }` → `{ "night": bool, "changed": bool }`. On: saves the TV's picture settings (`backlight`, `contrast`, `brightness`, `energySaving`) to `$DATA/picture-day.json` unless already saved (never the night values themselves), then sets 0 / 70 / 50 / `"max"`. Off: restores the saved values and deletes the file; nothing saved → no change. Calls run in order. Anything but a boolean `on` → 400 |
| `POST /api/local/update` | starts installing the latest release now (same steps as automatic update) → `{ "started": true }` or `{ "error" }` |
| `GET /api/local/music` | what Spotify is playing (see "Spotify"): `{ "connected": false }` when not signed in, else `{ "connected": true, "active", "playing", "progressMs", "durationMs", "at", "shuffle", "repeat", "device", "track" }`. Cached ≤1 s |
| `POST /api/local/music` | body `{ "do": "<command>", … }` (see "Spotify") → `{ "ok": true }`. Unknown command or bad field → 400; not signed in or no active device → 409 |
| `POST /api/local/music/settings` | Body: any of `{ "fadeSeconds", "fadeTo", "skin" }`, validated as in the settings schema. Saves them and answers with the whole `music` settings object. Any other key (including `tile`) → 400 |
| `GET /api/local/music/list?kind=<kind>&id=<id>&offset=<n>&q=<text>` | `{ "items": [ { "kind", "uri", "id", "title", "subtitle", "art", "active"? } ], "next": <offset> or null }` (see "Spotify"). Unknown kind → 400 |

### Setup endpoints — from a phone on the same network
| Method & path | Behaviour |
|---|---|
| `GET /s/<code>` | valid code → sets cookie `td_session` (random, HttpOnly, SameSite=Lax, 12 h), consumes the code, redirects to `/setup`; invalid → plain page "This code has expired — press OK on the TV for a new one" |
| `GET /setup` | the setup page (`service/www/setup.html`); without a valid session → the expired page |
| `GET /api/settings` | settings (session required) |
| `PUT /api/settings` | partial update, validated field by field against the schema; unknown keys rejected; returns the saved settings |
| `POST /api/secrets` | `{ "icalUrl"? , "google": { "clientId", "clientSecret" }?, "spotify": { "clientId" }?, "feedToken"? }` → `{ "ok": true }`; values never echoed back. `icalUrl` must be `https://` or `webcal://` (stored as `https://`). The Spotify client ID is 32 hex characters; saving a different one forgets the earlier Spotify sign-in |
| `DELETE /api/secrets/<icalUrl|google|spotify|feedToken>` | removes it; removing the secret of the current `calendar.source` also sets it to `"none"`; removing `spotify` also sets `music.tile` to `false` |
| `POST /api/spotify/start` | `{ "authUrl" }` (see "Spotify"); error if `pagesBase` is empty or no Spotify client ID is saved |
| `GET /api/apps` | installed apps `[ { "id", "title" } ]` (via `luna-send ... listApps`; `[]` off-TV) |
| `POST /api/google/start` | `{ "authUrl" }` (see below); error if `pagesBase` is empty or there is no client (built-in or own) |
| `GET /api/google/calendars` | `[ { "id", "summary", "primary" } ]` |
| `GET /oauth/return?code&state` | completes a sign-in (no session cookie needed: protected by the single-use `state` nonce + PKCE). The nonce says whose it is: a Spotify sign-in redirects to `/setup?spotify=ok` or `/setup?spotify=error`, anything else is treated as Google's and redirects to `/setup?google=ok` or `/setup?google=error` |
| `GET /api/status` | `{ "version", "connected": {...}, "stored": { "icalUrl", "googleClient", "googleSignedIn", "spotifyClient", "spotifySignedIn", "feedToken" } (booleans), "update": {..., "installing", "error"}, "google": { "available", "builtIn", "redirectUri", "lastError" }, "spotify": { "available", "redirectUri", "lastError" } }` (session required). `builtIn`: the package carries a Google client, so sign-in needs no keys. `connected` (here and in `/api/local/state`) gains `"spotify": bool` (signed in) |
| `POST /api/update` | same as `POST /api/local/update`, for the setup page's "Update now" (the phone cannot reach the loopback-only endpoint) |

Every state-changing setup request requires the session cookie **and** an `X-TeleDash: 1` header
(blocks cross-site form posts). Session-less requests get 401. Sessions are stored as hashes in
`$DATA/sessions.json` (600) so they survive the service restart after a `home.*` change.

## Google sign-in (no device flow: Google does not allow Calendar scopes on it)

1. The client: the owner's own (`secrets.json` `google.clientId/clientSecret`, saved under
   Advanced on the setup page) if present, else the package's `google-client.json` (Google's
   downloaded `{"web": {"client_id", "client_secret"}}` or `{clientId, clientSecret}`; written by
   `scripts/build.sh`, never in git). Either is a **Web application** client with authorised
   redirect URI `<pagesBase>/oauth/`. No client → `POST /api/google/start` returns 400.
2. `POST /api/google/start` creates `state = base64url(JSON {"t": "http://<lan-ip>:8770", "n": "<nonce>"})`
   and a PKCE verifier/challenge (S256), remembers nonce → verifier for 10 minutes, and returns
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=<pagesBase>/oauth/&response_type=code&scope=https://www.googleapis.com/auth/calendar.readonly&access_type=offline&prompt=select_account%20consent&state=…&code_challenge=…&code_challenge_method=S256`.
3. Google returns the phone to `site/oauth/index.html`, which decodes `state`, **checks `t` is
   `http://` + a private IPv4 address (10/8, 172.16/12, 192.168/16) + `:` port**, and only then
   does `location.replace(t + "/oauth/return" + location.search)`. Anything else: shows an error,
   never redirects (no open redirect).
4. The service checks the nonce, exchanges the code at `https://oauth2.googleapis.com/token`
   (with client secret + verifier + same redirect URI), stores the refresh token in secrets, and
   sets `calendar.source = "google"`.
5. Calendar reads use `https://www.googleapis.com/calendar/v3/calendars/<id>/events?singleEvents=true&orderBy=startTime&timeMin&timeMax`.

## Spotify (the Music view)

Spotify Premium is required (Spotify's rule for playback control and for development-mode apps).
No client is built into the package: Spotify caps a development-mode app at five users, so each
owner creates their own app at developer.spotify.com and pastes its client ID on the setup page.

**Sign-in** (authorization code + PKCE; there is no client secret):

1. `POST /api/spotify/start` creates `state` exactly as Google sign-in does
   (`base64url(JSON {"t": "http://<lan-ip>:8770", "n": "<nonce>"})`), a PKCE verifier/challenge
   (S256), remembers nonce → verifier for 10 minutes, and returns
   `https://accounts.spotify.com/authorize?client_id=…&response_type=code&redirect_uri=<pagesBase>/oauth/&scope=<scopes>&state=…&code_challenge=…&code_challenge_method=S256`.
   Scopes, space-separated, only what is used: `user-read-playback-state user-modify-playback-state
   user-read-currently-playing user-library-read user-library-modify playlist-read-private
   playlist-read-collaborative user-read-recently-played`.
2. Spotify returns the phone to the same static `oauth/` page as Google (the owner registers
   `<pagesBase>/oauth/` as the app's redirect URI; Spotify requires HTTPS there). The page forwards
   to `http://<TV>:8770/oauth/return` unchanged.
3. The service sees the nonce is a Spotify one, exchanges the code at
   `https://accounts.spotify.com/api/token` (form body: `grant_type=authorization_code`, `code`,
   `redirect_uri`, `client_id`, `code_verifier`), stores the tokens, and sets `music.tile = true`.
4. Refresh: same address, `grant_type=refresh_token`, `refresh_token`, `client_id`. Spotify may
   answer with a new refresh token, which replaces the old one. `invalid_grant` forgets the tokens
   (the setup page then shows "not signed in").

**Web API** (`https://api.spotify.com/v1`, paths as of Spotify's February 2026 changes):

`GET /api/local/music` reads `GET /me/player?additional_types=track,episode`:

```json
{ "connected": true, "active": true, "playing": true, "progressMs": 61000, "durationMs": 215000,
  "at": 1767366000000, "shuffle": false, "repeat": "off",
  "device": { "id": "…", "name": "Living room", "type": "Speaker", "volume": 40 },
  "track": { "uri": "spotify:track:…", "title": "…", "artist": "A, B", "album": "…", "art": "https://…", "liked": true } }
```
- `at`: Unix milliseconds when Spotify answered, so the app can move the progress bar between reads.
- Nothing active (HTTP 204 from Spotify): `active` and `playing` false, `device` and `track` null.
- `repeat`: `"off" | "context" | "track"`. `device.volume`: 0–100, or `null` when the device does
  not allow volume control. `art`: the largest image, `""` when there is none.
- `liked`: from `GET /me/library/contains?uris=<track uri>`, looked up once per track; `null` when
  unknown. Episodes: `title` is the episode, `artist` the show, `album` `""`.

`POST /api/local/music` commands (`do`):

| `do` | Other fields | Spotify call |
|---|---|---|
| `play` | none (resume), or `context` (a playlist/album URI) with optional `offsetUri` (the track to start at), or `uris` (1–50 track URIs) with optional `offsetUri`; optional `deviceId` | `PUT /me/player/play` |
| `pause` | | `PUT /me/player/pause` |
| `next`, `previous` | | `POST /me/player/next`, `/previous` |
| `seek` | `ms` (0 or more, whole number) | `PUT /me/player/seek?position_ms=` |
| `shuffle` | `on` (boolean) | `PUT /me/player/shuffle?state=` |
| `repeat` | `mode`: `off`, `context`, `track` | `PUT /me/player/repeat?state=` |
| `volume` | `percent` (0–100) | `PUT /me/player/volume?volume_percent=` |
| `transfer` | `deviceId`, optional `play` (boolean) | `PUT /me/player` |
| `queue` | `uri` (track or episode) | `POST /me/player/queue?uri=` |
| `like`, `unlike` | `uri` (track) | `PUT` / `DELETE /me/library?uris=` |

Every URI is checked against `spotify:(track|episode|album|playlist|artist|show):<22 letters or digits>`
before it is sent. Spotify answering 404 with reason `NO_ACTIVE_DEVICE` becomes 409 "No Spotify
device is active…"; 403 `PREMIUM_REQUIRED` becomes 403 "Spotify Premium is needed…"; 429 becomes 429.

`GET /api/local/music/list` kinds (page size 50; `search` 10, Spotify's limit):

| `kind` | Needs | Items | Spotify call |
|---|---|---|---|
| `playlists` | | `playlist` | `GET /me/playlists` |
| `albums` | | `album` | `GET /me/albums` |
| `liked` | | `track` | `GET /me/tracks` |
| `recent` | | `track` (no paging) | `GET /me/player/recently-played` |
| `playlist` | `id` | `track` | `GET /playlists/{id}/items` (each entry's `item`, else its older `track`) |
| `album` | `id` | `track` | `GET /albums/{id}/tracks` (art and album title from `GET /albums/{id}`) |
| `queue` | | `track` (no paging) | `GET /me/player/queue` |
| `devices` | | `device` (`active` set) | `GET /me/player/devices` |
| `search` | `q` (1–100 characters) | `track`, `album`, `playlist` | `GET /search?type=track,album,playlist` |

Item: `{ "kind", "uri", "id", "title", "subtitle", "art" }`: `subtitle` is the artists (track,
album), the owner and track count (playlist), or the device type; `uri` is `""` for a device.

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
- Night mode: the `Night` tile, the red key (403) or launch parameter `{"night": true}` show the
  idle view in a very dark, low-contrast amber-red palette (body class `night`) and call
  `POST /api/local/night {"on": true}`. Going idle during night hours (`night`) enters it too, and
  plain idle turns into it when night hours start. It ignores pointer movement and the app returning
  to the front; a key press ends it, and so does the next night end (the morning brief start) after
  it began. Ending it calls `{"on": false}`; so does every app start that is not in night mode.
- Morning brief by hand: the `Morning brief` tile, the green key (404) or launch parameter
  `{"brief": true}` show the brief at any
  hour (ending night mode). It stays for 15 minutes or until a key press, then normal standby.
  Launch parameter `{"idle": true}` opens straight into the ordinary idle view.
- Music view: the `Music` tile, the yellow key (405) or launch parameter `{"music": true}` show
  Spotify full screen (body class `music`, `app/music.js`): the visualizer canvas behind, and over
  it the artwork, title, progress bar and a row of controls. The app reads `GET /api/local/music`
  every 2 s while the view is up and moves the progress bar itself in between. Keys: ←/→ move
  along the controls, OK presses one, ↑ opens the library (playlists, albums, liked songs,
  recently played, queue, devices), Back closes the library and then the view (the music keeps
  playing); the remote's Play (415), Pause (19), Stop (413), Fast-forward (417, next) and Rewind
  (412, previous) always act. After `music.fadeSeconds` without a button press the artwork and
  controls fade to `music.fadeTo` percent and drift (nothing sits still on an OLED); any button
  brings them back. The screen never goes idle while music is playing in this view.
- QR: `app/qr.js` exposes `QR.matrix(text)` → array of rows of booleans (byte mode, error
  correction M, smallest version that fits, versions 1–10 at least) and `QR.svg(text, sizePx)` →
  SVG markup string. UMD-style: `var QR = …; if (typeof module !== "undefined") module.exports = QR;`
- App icons: tiles use the TV's own icon for each app. listApps on webOS 6 reports `icon`/`largeIcon`
  relative to the app's `folderPath` (Verified on an LG C1), and the web app may not read other
  apps' folders (file:// fails, Verified), so the helper serves them: `GET /icons/<appId>`,
  loopback only, no key (an `<img>` cannot send one), image files inside the TV's app folders only.
  Without the helper, or for an app with no icon, the tile shows the title on the app's colour
  (`bgColor`/`iconColor`), with dark text on light colours. No streaming-service logos are bundled.
- Tile layout: always two rows of 104 px tiles at the top; more apps add columns (at least
  `columns`, at most 14). Past 28 tiles the rest are reached through All apps.

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
- Releases run on push to `main`: a `version` in `app/appinfo.json` with no GitHub Release yet is
  built and published, and the workflow creates the tag `v<version>`. It must be newer than the
  latest release; an already released version publishes nothing.

## Tests and checks (CI and local)

`scripts/check.sh` runs everything: personal-data and secret scan over tracked files, `node --check`
on all JS, ES5 check on `app/*.js` (parse with `ecmaVersion: 5` when a parser is available locally,
otherwise a regex check for `=>`, `` ` ``, `let `, `const `), `sh -n` on `kiosk/*`, `bash -n` on
`scripts/*.sh`, JSON validity, and `node test/unit.js` (+ any `test/*.test.js`,
`service/test/*.test.js` and `scripts/test-*.js`).
