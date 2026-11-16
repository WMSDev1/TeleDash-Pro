# TeleDash Pro

A calm, ad-free home screen for rooted LG webOS TVs.

TeleDash Pro replaces the busy, promoted-content home screen with one quiet page: big tiles
for the apps you actually use, the time, the weather, today's calendar, and a few small
things you choose to see. You set it up from your phone by scanning a QR code on the TV.

It is an early, community project. It has been tested on **one LG TV running webOS 6**.
Other webOS versions and models are **unknown**: they may work, partly work, or not work.

## What it shows

- **App tiles.** Automatic by default: the apps installed on your TV, ordered by how often you
  use them (re-sorted once a day, never while you are looking). Or pick and order your own.
  Automatic tiles end with `HDMI 1`, `Set up` and `All apps`; in your own list `Set up` always
  sits just before `All apps`.
- **Clock** and date.
- **Weather** for a place you choose, in Celsius or Fahrenheit.
- **Alerts**: official weather warnings and air quality for that place. Each can be turned off.
- **Calendar**: today's and tomorrow's events from Google Calendar or any iCal address.
- **Market strip**: a few stock indexes (S&P 500, Nasdaq and Dow by default; you can change them).
- **Data feed**: one line of numbers from a JSON or CSV file you host, for example an account
  balance or a home sensor. See [docs/DATA-FEED.md](docs/DATA-FEED.md).
- **Morning brief**: during the hours you choose, the screen shows a full-brightness summary of
  the day instead of going dim.
- **Countdowns**: days until holidays and your own dates.
- **Idle view**: after two minutes without a button press, a dim clock and weather that drift
  slowly around the screen.
- **Home button** (optional): make the remote's Home button open TeleDash Pro instead of
  LG's home screen. Off by default. See [docs/HOME-BUTTON.md](docs/HOME-BUTTON.md).

## Requirements

- An LG TV running webOS that has been **rooted** and has the
  [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) installed.
  Tested on webOS 6 only.
- A phone on the same home network as the TV, for setup.
- Without root the app still opens and works as a plain launcher with built-in defaults, but
  phone setup, calendar, data feed and the Home button need the small root helper described below.

Rooting a TV is your decision and your risk. This project does not explain how to root a TV.

## Install

1. On the TV, open **Homebrew Channel**, go to its settings and add this custom repository:

   ```
   https://<owner>.github.io/teledash-pro/repo/apps.json
   ```

   Replace `<owner>` with the GitHub account that publishes the TeleDash Pro releases you want
   (the project's GitHub page links to it). If you build and publish your own fork, it is your
   own GitHub Pages address followed by `/repo/apps.json`.

   > Note: `apps.json` follows the repository index format in Homebrew Channel's sources, but
   > adding it as a custom repository has not yet been tried on a TV, and the menu names may
   > differ. If it is rejected, check the latest release notes.

2. Find **TeleDash Pro** in Homebrew Channel's list and install it.
3. Open it from the TV's app list.

## First run

1. The first time TeleDash Pro opens on a rooted TV it asks:
   *"TeleDash Pro can install a small helper so you can set it up from your phone and make
   Home open TeleDash. Install?"* Choose **OK** to install the helper, or **Not now** to use
   TeleDash Pro as a plain launcher. Installing the helper does not change what the Home
   button does; that is a separate setting, off until you turn it on.
2. Select the **Set up** tile (or press `0` or the blue button on the remote). The TV shows a
   QR code, the setup address, and a one-time code.
3. Scan the QR code with your phone. The setup page opens on your phone. The code works once
   and expires after 10 minutes; if it has expired, press OK on the TV for a new one.
4. Choose your weather location, apps, calendar, and so on. The TV picks up changes within
   about 30 seconds.

Step by step, with every option explained: [docs/SETUP.md](docs/SETUP.md).

## Privacy

- **No account, no tracking, no analytics.** TeleDash Pro has no server of its own.
- **Your settings and keys stay on your TV**, in a folder only the TV's root user can read.
  Keys and calendar addresses you enter are never shown again, never sent to the dashboard or
  your phone, and never written to logs.
- **Your location is rounded** to about 10 km (one decimal place) before it is saved.
- **The TV talks directly to the services you turn on**: a weather service (Open-Meteo), the
  US National Weather Service for warnings, a public stock-quote service for the market
  strip, Google or your iCal provider for your calendar, and the address of your data feed.
  Each of them sees your TV's internet address when it is asked for data.
- **App usage** (which app was in front, and when) is logged on the TV only, to order the
  tiles. It never leaves the TV.
- **Automatic updates are off by default.**

More detail, including what someone on your home network could and could not do:
[SECURITY.md](SECURITY.md).

## Turning it off

- The Home button behaviour can be turned off from the setup page, or with an off-switch file.
- The helper can be removed completely with one command.

Both are explained in [docs/HOME-BUTTON.md](docs/HOME-BUTTON.md).

## Development quick start

You need Node.js (22 is what CI uses), bash, and for packaging the LG webOS CLI tools
(`ares-package`).

```sh
bash scripts/check.sh      # every check CI runs: personal-data scan, syntax, ES5, tests
bash scripts/build.sh      # stages build/stage/ and makes an .ipk in build/
```

Run the helper on your own computer (it skips anything that only exists on a TV):

```sh
TELEDASH_DATA=./.data node service/server.js
# prints a one-time setup address; the key is what the TV app reads from the data folder
curl -X POST -H "X-TeleDash-Local: $(cat .data/local.token)" http://127.0.0.1:8770/api/local/pair
```

Open the printed address in a browser to use the setup page against your local copy.

To try a build on your own rooted TV over SSH:

```sh
TELEDASH_TV=192.168.1.50 bash scripts/deploy.sh      # use your TV's address
```

Parts, ports and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md). How releases work:
[docs/RELEASING.md](docs/RELEASING.md).

## Documentation

| Document | What it covers |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Setting everything up from your phone |
| [docs/GOOGLE-CALENDAR.md](docs/GOOGLE-CALENDAR.md) | Connecting Google Calendar, or an iCal address instead |
| [docs/DATA-FEED.md](docs/DATA-FEED.md) | The data feed: JSON and CSV formats, GitHub files, read-only keys |
| [docs/HOME-BUTTON.md](docs/HOME-BUTTON.md) | Making Home open TeleDash Pro, and undoing it |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the parts fit together |
| [docs/RELEASING.md](docs/RELEASING.md) | Making a release |
| [SECURITY.md](SECURITY.md) | Threat model and how to report a vulnerability |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Code rules and checks |

## Licence

A licence has **not been chosen yet**, and this repository does not contain a licence file.
Until one is added, please open an issue before reusing the code elsewhere.

## Trademarks

LG and webOS are trademarks of their owners, as are the names of streaming services and other
apps that may appear on your tiles. TeleDash Pro bundles no logos: tiles use the icons your TV
already has, or the app's name on a plain colour. TeleDash Pro is an independent project and is
not affiliated with, endorsed by, or supported by LG Electronics.
