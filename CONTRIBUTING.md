# Contributing

Thanks for helping. TeleDash Pro is small on purpose: plain code, no frameworks, no dependencies,
and it has to run on old TV software. These rules keep it that way.

## Before you start

- Read [CONTRACT.md](CONTRACT.md). It fixes every path, port, id, settings field and HTTP
  endpoint shared between the parts. If your change crosses a boundary, change the contract in
  the same pull request and say so in the description.
- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security problems: do not open an issue; see [SECURITY.md](SECURITY.md).

## Code rules by folder

### `app/` — ES5 only

The dashboard runs in the webOS 6 browser engine (Chromium about 79). Write ES5:

- `var` and `function` only: no `let`, `const`, arrow functions, classes, or template literals.
- `XMLHttpRequest`, not `fetch`. No Promise-only APIs without a fallback.
- No CSS flex `gap` (use margins).
- No frameworks or build step; files load directly from `index.html`.

### `service/` — Node 8, zero dependencies

The helper runs on the TV's own Node.js, which is old (8.12 on a 2021 OLED). Write for Node 8:

- CommonJS (`require`), built-in modules only. No `package.json` dependencies, no `npm install`.
- No `??`, `?.`, `fetch`, `fs/promises`, or top-level `await`.
- It must also run on a developer computer: anything TV-only (`luna-send`, `/home/root`) should
  fail softly when missing. Use `TELEDASH_DATA=./.data` for local runs.
- Never send secrets to any client and never log them. The one exception is written down in
  CONTRACT.md "Playing on the TV": Spotify's short-lived access token goes to the dashboard on
  the TV, for Spotify's player. Do not add another without changing the contract first.

### `kiosk/` — BusyBox `sh`

These scripts run as root under the TV's BusyBox shell:

- POSIX `sh` only: no `[[`, no arrays, no `function` keyword, no other bash-isms.
- BusyBox applets only.
- Do not stop processes with `pkill -f <name>` from a shell whose own command line contains
  `<name>`: it kills itself. Use the pid files in the data folder.

### `site/`

Plain HTML and JavaScript for phones and desktop browsers, no build step.

### Everywhere

- Short comments that explain *why*, not *what*.
- **No personal data** in code, docs, tests or commit messages: no real names, addresses, home
  locations or coordinates, IP addresses other than documentation examples such as
  `192.168.1.50`, email addresses, calendar addresses, account or private repository names,
  keys, or passwords (not even well-known defaults). Use generic examples.

## Checks

Run before every pull request:

```sh
bash scripts/check.sh
```

It runs everything CI runs: the personal-data and secret scan, `node --check` on all JavaScript,
the ES5 check on `app/*.js`, `sh -n` on `kiosk/*`, `bash -n` on `scripts/*.sh`, JSON validity,
and the unit tests (`node test/unit.js` plus any `test/*.test.js`). Add or update tests in
`test/` when you change behaviour that can be tested off the TV.

Some things can only be checked on a real TV (the Home watcher, app launching, Homebrew Channel
calls). If you changed those, say in the pull request what you tested and on which webOS
version, or that it is untested on a TV.

## Versions

Bump `version` in `app/appinfo.json` whenever you change anything in `app/`, `service/` or
`kiosk/`. They ship in one package, and TVs (Homebrew Channel, the automatic updater, and the
app's own "re-install the helper after an update" step) only notice a change when the version
goes up. Use `X.Y.Z`: raise Z for fixes, Y for new features.

Merging a pull request with a raised version publishes a release; see
[docs/RELEASING.md](docs/RELEASING.md).

## Trying it on a TV

With a rooted TV you can reach over SSH:

```sh
bash scripts/build.sh
TELEDASH_TV=192.168.1.50 bash scripts/deploy.sh    # use your TV's address
```

Never commit your TV's address, keys, or a `.data/` folder from a local run.
