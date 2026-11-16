# Architecture

A short map of how TeleDash Pro fits together. The exact interfaces (paths, settings schema,
HTTP API) are fixed in [CONTRACT.md](../CONTRACT.md); this page explains the shape and the
reasons.

## Parts

| Folder | What it is | Runs on | Language |
|---|---|---|---|
| `app/` | The dashboard itself: a webOS web app (tiles, clock, weather, calendar, alerts, market, feed, brief, countdowns, setup QR) | The TV's browser engine (webOS 6: Chromium about 79) | ES5 JavaScript, no frameworks |
| `service/` | The helper's setup server: settings, secrets, phone setup page, calendar and feed fetching, updates | The TV, as root, on the TV's own Node.js | Node 12-compatible CommonJS, no dependencies |
| `kiosk/` | Install, start, uninstall scripts and the Home watcher | The TV, as root | POSIX `sh` (BusyBox) |
| `site/` | GitHub Pages site: the Google sign-in return page and the Homebrew Channel repository | Phones and browsers | Plain HTML/JS |
| `scripts/`, `test/`, `.github/` | Build, deploy, checks, tests, release workflow | Developer machines and CI | bash, Node |

The build puts them into one package: the app at the root, `service/` as `server/`, `kiosk/`
as `system/`, plus `project.json`.

## Ports and addresses

| Who | Talks to | How |
|---|---|---|
| Dashboard (`app/`) | Setup server | `http://127.0.0.1:8770/api/local/*` — accepted only from the TV itself, with the key from `$DATA/local.token` |
| Dashboard (`app/`) | Setup server | `http://127.0.0.1:8770/icons/<appId>` — app logos for the tiles, TV only, no key |
| Phone | Setup server | `http://<TV address>:8770/s/<code>`, then `/setup` and `/api/*` with a session cookie |
| Google (via the phone) | Return page | `https://<owner>.github.io/teledash-pro/oauth/` |
| Setup server | Internet | Google Calendar API, your iCal address, your data feed, the release manifest |
| Dashboard | Internet | Weather, air quality, weather warnings, market quotes |
| Dashboard | TV system | `luna://` services: app list, launching apps, and Homebrew Channel's root `exec` service (install helper, LG mode flag) |

Port **8770** listens on all network interfaces so the phone can reach it. The "local" endpoints
check that the request comes from the TV itself and carries the dashboard's key (which only root
can read), and refuse anything else. Requests addressed to a host name rather than an IP address
are refused (DNS rebinding).

## Data flow

```
 Phone (same home network)                     TV
 ─────────────────────────                     ──────────────────────────────────────────────
                                               ┌─────────────────────┐   every 30 s
  scan QR  ── /s/<code> ─────────────────────▶ │  setup server       │ ◀─ /api/local/state ─┐
  setup page ◀─ /setup, /api/settings ──────── │  (service/, :8770)  │                      │
                                               │                     │ ── settings, ──────▶ │
                                               │  settings.json      │    calendar, feed    │
                                               │  secrets.json (600) │                ┌─────┴──────┐
                                               │                     │                │ dashboard  │
                                               └──┬──────────┬───────┘                │ (app/)     │
                                                  │          │ kiosk.conf             └─────┬──────┘
                                                  │          ▼                              │ launch,
                                                  │   ┌──────────────┐  Home pressed        │ LG mode
                                                  │   │ Home watcher │ ─▶ opens dashboard ◀─┘
                                                  │   │ (kiosk/)     │ ─▶ usage.log
                                                  │   └──────────────┘
                                                  ▼
                                   Internet: Google Calendar API, iCal address,
                                   data feed (HTTPS or GitHub), release manifest
```

Google sign-in, which needs a public address for Google to return to:

```
 setup page ── POST /api/google/start ──▶ setup server (makes state + PKCE)
     │ ◀──────────── authUrl ──────────────┘
     ▼
 accounts.google.com (sign in, allow read-only calendar)
     ▼
 <site>/oauth/  (GitHub Pages, static page)
     │ decodes state; forwards ONLY to http://<private IPv4>:<port>
     ▼
 http://<TV address>:8770/oauth/return ── checks nonce, swaps code for tokens at Google
     ▼
 /setup?google=ok
```

## Why it is built this way

- **The dashboard works alone.** Without root or the helper it still opens with built-in
  defaults and plain app tiles, and says "Setup helper not running".
- **Secrets never reach the browser.** Calendar addresses, Google keys and feed keys live in
  `secrets.json` on the TV, readable only by root. The dashboard asks the setup server for
  results (events, feed numbers), never for keys.
- **Setup from a phone, not the remote.** Typing keys with a TV remote is slow and error-prone,
  so the TV shows a QR code with a one-time code that opens the setup page on the phone.
- **No Google device flow.** Google's sign-in for TVs and other limited-input devices does not
  allow Calendar scopes. So sign-in uses the normal web flow in the phone's browser, with a
  Web application client the user creates. Google needs a fixed public return address, which is
  the static `oauth/` page on the project's GitHub Pages site; it only hands the result back
  into the home network. PKCE and a single-use `state` nonce protect the exchange.
- **No server of our own.** There is nothing to run, pay for, or trust beyond GitHub Pages
  serving static files and a release package.
- **Settings have one owner.** The setup server holds the settings and bumps `rev` on every save;
  the dashboard rebuilds when `rev` changes and caches the last good settings for instant start.
- **Old engines on purpose.** webOS 6 ships an older Chromium and Node, so the code avoids
  newer language features and has no dependencies to keep up to date.
