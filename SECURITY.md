# Security

TeleDash Pro runs on your TV with root access and can hold keys to your calendar and to a data
file. This page says plainly what it protects, what it does not, and how to report a problem.

## Reporting a vulnerability

Please report security problems **privately** through GitHub's private vulnerability reporting:
on the repository page open the **Security** tab and choose **Report a vulnerability**. Do not
open a public issue for a security problem.

Include what you found, how to reproduce it, and which version (`app/appinfo.json`) you tested.
This is a small volunteer project: we will reply as soon as we can, but there is no guaranteed
response time. Only the latest release receives fixes.

## The threat model, in plain English

### The helper runs as root

The optional helper (the setup server and the Home watcher) runs as the TV's **root** user,
because it needs to start at boot, watch which app is in front, and launch apps. That means a
bug in the helper could, in the worst case, give someone control of the TV. We keep it small,
dependency-free, and limited to the jobs above to reduce that risk. If you do not want this,
choose **Not now** when TeleDash Pro offers to install the helper, or remove it later (see
[docs/HOME-BUTTON.md](docs/HOME-BUTTON.md#removing-the-helper-completely)).

### Who can reach the setup server

The setup server listens on port **8770** on every network interface of the TV, so **anyone on
your home network can reach it**. What they can do without more:

- **Nothing that changes anything.** The setup page and every settings call need a session,
  and a session is only created by opening the **one-time code** shown on the TV screen. Codes
  are random, single use, expire after 10 minutes, and a new code cancels the previous one. In
  practice: you need to be able to see the TV to set it up.
- **Not the dashboard's own data.** The endpoints the dashboard uses (settings, calendar
  events, feed, usage log, new setup codes) answer only connections from the TV itself that also
  carry a random key stored in the helper's root-only folder. The dashboard reads that key as
  root through Homebrew Channel. A web page opened in the TV's own browser, or another app on the
  TV, connects from the TV too but does not have the key, so it is refused.
- **No tricks with web addresses.** The server only answers requests addressed to an IP address
  (as in the QR code) or `localhost`. This stops a web page from pointing a name of its own at
  your TV ("DNS rebinding") to talk to it as if it were the same site.
- "Update now" from a phone needs a setup session like any other change.
- Sessions last 12 hours. Every request that changes something also needs a special header,
  which stops other websites you visit from posting to your TV behind your back.

What this does **not** protect against:

- **The home network is trusted.** The setup page uses plain `http://` on your home network, not
  HTTPS. Someone who can watch traffic on your network while you set up could see what you
  type, including keys. Set up on a network you trust, not on shared or public Wi-Fi.
- **Anyone with root on the TV** (another root app, or someone with your TV's root login) can
  read everything the helper stores, including the dashboard's key.
- **Other apps that can run commands through Homebrew Channel** run them as root too, so they
  can read the key like the dashboard does. Homebrew Channel's exec service is available to any
  app on a rooted TV *(Assumed)*.
- **Anyone who can see the TV screen** while the QR code is showing can use that code within
  10 minutes. Close the QR screen when you are done (Back on the remote).

### Where secrets live

- Keys and addresses you enter (iCal address, Google client id and secret, Google sign-in
  tokens, data-feed key) are stored on the TV in `/home/root/teledash/secrets.json`, mode `600`,
  inside a folder with mode `700`: readable only by root.
- They are **never sent to any client** (not to the dashboard, not back to your phone) and never
  written to logs. To change one you enter a new value; to remove one you delete it.
- Settings that are not secret are stored next to them in `settings.json`. Your weather location
  is rounded to one decimal place (about 10 km) before it is saved.
- Nothing is stored on any TeleDash server. There is no TeleDash server.

### Google Calendar

- TeleDash Pro only asks for **read-only** calendar access
  (`https://www.googleapis.com/auth/calendar.readonly`). It cannot create, change or delete
  events.
- It uses **your own** Google Cloud project, so no one else's app holds your sign-in.
- You can revoke access at any time at <https://myaccount.google.com/permissions>.
- Sign-in returns through a static page on the project's GitHub Pages site. That page only ever
  forwards to a private home-network address (`10.x`, `172.16–31.x`, `192.168.x`), never to
  anywhere else, so it cannot be used to send people to other sites. The exchange is protected
  by a single-use `state` value and PKCE, so an intercepted sign-in code is useless on its own.
- The **iCal secret address** alternative is weaker: anyone who has that address can read your
  whole calendar, with no expiry, until you reset it. See
  [docs/GOOGLE-CALENDAR.md](docs/GOOGLE-CALENDAR.md#the-ical-alternative).

### GitHub key for the data feed

If your data feed is in a private GitHub repository, the key you give the TV should be:

- **read-only** (Contents: Read-only, nothing else),
- for **one repository** only, ideally one that holds nothing but the feed file,
- **expiring**.

Then a leaked key can only read that one repository until it expires. If you also set a key for a
plain `https://` feed address, it is sent to that address, so only do that when the address
belongs to whoever issued the key. The TV sends the key only to the site the feed pointed at when
the key was saved; changing the feed address to another site deletes the key. Step by step:
[docs/DATA-FEED.md](docs/DATA-FEED.md#making-a-read-only-github-key).

### Updates

- **Automatic updates are off by default.**
- When on, the helper checks the project's published manifest once a day. If there is a newer
  version, it downloads the package and **verifies its SHA-256 hash against the manifest before
  installing**; a package that does not match is not installed.
- The hash protects against corrupted or swapped downloads. It does **not** protect against
  someone who takes over the project's GitHub account or release workflow, because the manifest
  comes from the same place. If that worries you, leave automatic updates off and update from
  Homebrew Channel after reading the release notes.

### What leaves your TV

Only requests to services you have turned on: weather and air quality (Open-Meteo), US weather
warnings (National Weather Service), market quotes, your calendar provider, your data-feed
address, and, for update checks, the project's GitHub Pages site. Each of these sees your home's
internet address. App usage is logged on the TV only and never sent anywhere. There is no
analytics or telemetry.

## Scope

In scope: the code in this repository (`app/`, `service/`, `kiosk/`, `site/`, `scripts/`) and the
packages built from it by this repository's release workflow.

Out of scope: rooting methods, Homebrew Channel itself, webOS, and third-party services
(Google, GitHub, weather and market data providers). Please report those to their owners.
