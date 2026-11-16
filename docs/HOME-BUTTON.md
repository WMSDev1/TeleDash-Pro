# The Home button and the helper

TeleDash Pro can make the remote's **Home** button bring you back to TeleDash Pro instead of
LG's home screen. This is **off by default**. This page explains what the helper does, how the
Home button behaviour works, how to reach LG's own screens, and how to undo all of it.

## What the helper is

The helper is two small programs that TeleDash Pro installs on a rooted TV when you say **OK**
to the one-time question on first run. They run as the TV's **root** user.

- **The setup server** (Node.js, port 8770): serves the phone setup page, keeps your settings
  and keys, and fetches your calendar and data feed. It always runs while the helper is
  installed.
- **The Home watcher** (a shell script): runs only when **Open TeleDash when I press Home** is
  turned on.

Installing it:

1. creates a data folder, `/home/root/teledash/`, readable only by root;
2. adds a start-up hook, `/var/lib/webosbrew/init.d/90-teledash`, which Homebrew Channel runs
   at every boot. The hook starts the helper from the installed app, and does nothing if the
   app has been uninstalled;
3. starts the helper now.

After an app update, TeleDash Pro re-runs the install step by itself so the helper matches the
new version.

Where things live on the TV:

| What | Where |
|---|---|
| App and helper code | `/media/developer/apps/usr/palm/applications/com.teledashpro.dashboard/` |
| Settings, keys, usage log | `/home/root/teledash/` |
| Home watcher on/off and delay | `/home/root/teledash/kiosk.conf` (written by the setup server) |
| Hard off switch | `/home/root/teledash/kiosk-off` (see below) |
| Logs | `/tmp/teledash-server.log`, `/tmp/teledash-kiosk.log` (cleared at reboot) |

## What happens when the Home setting is on

- **At start-up**: the watcher keeps bringing TeleDash Pro to the front until it has stayed
  there for 5 seconds (it gives up after 90 seconds). A brief flash of LG's home screen or of
  an input such as HDMI 1 before TeleDash Pro appears is normal.
- **When you press Home**: LG's home screen opens as usual. The watcher waits for the
  **delay** (1 second by default; 0 to 30 on the setup page) and, if LG's home screen is still
  in front, opens TeleDash Pro.
- **Safety brake**: it never sends you back twice within 5 seconds. If LG's home screen keeps
  coming back, the watcher leaves it showing rather than fighting it.
- **Usage**: each time the app in front changes, the watcher writes the time and the app's id to
  `/home/root/teledash/usage.log` on the TV. This is what orders the automatic tiles. It is
  never sent anywhere. The watcher keeps doing this (and only this) while the Home setting is
  off, so the tiles are ordered by use either way.

A longer delay gives you more time to use LG's home screen after pressing Home; a shorter one
feels more like TeleDash Pro is the real home screen.

## Getting to LG's home screen: "LG mode"

Select the **All apps** tile on TeleDash Pro. It opens LG's home screen and tells the watcher to
leave it alone (it writes the flag file `/tmp/teledash-lgmode`). You stay on LG's home screen for
as long as you like. As soon as you open any other app, LG mode ends, and the next Home press
returns to TeleDash Pro again.

LG mode is forgotten at every restart.

## Known limits

- **LG's Settings menu** is drawn on top of the current screen rather than being an app of its
  own, so the watcher cannot see it. Pressing Home from inside Settings may leave you on LG's
  home screen. Press Home again, or open TeleDash Pro from the app list.
- **Power-on screen**: if the TV is set to power on to the last input (for example HDMI 1), that
  input may win the race at start-up. Setting the TV to power on to the Home screen helps,
  because the watcher always replaces LG's home screen. *(Observed on one webOS 6 TV; the menu
  name differs between models.)*
- Tested on webOS 6 only. Other versions are unknown.

## Turning it off

### The normal way

On the phone setup page, turn **Open TeleDash when I press Home** off. The watcher stops within a
few seconds and Home behaves as LG intended. The setup server keeps running so you can turn it
back on.

### The hard off switch

If you cannot reach the setup page, create this empty file on the TV as root, using whatever
root shell you have (usually SSH, which a rooted TV with Homebrew Channel normally offers):

```sh
touch /home/root/teledash/kiosk-off
```

While that file exists the watcher never opens anything, even at start-up. Delete it to allow
the watcher again:

```sh
rm /home/root/teledash/kiosk-off
```

## Removing the helper completely

As root on the TV:

```sh
sh /media/developer/apps/usr/palm/applications/com.teledashpro.dashboard/system/uninstall.sh
```

This stops the setup server and the watcher and removes the start-up hook. It **keeps** your
settings and keys in `/home/root/teledash/`, so reinstalling picks up where you left off.

To also delete your settings, keys, calendar sign-in and usage log:

```sh
sh /media/developer/apps/usr/palm/applications/com.teledashpro.dashboard/system/uninstall.sh --purge
```

**If you are removing TeleDash Pro for good, run the `--purge` command first, then uninstall
the app** in Homebrew Channel. Uninstalling the app on its own stops the helper from starting at
the next boot, but leaves your keys in `/home/root/teledash/`. Afterwards, also revoke
Google access at <https://myaccount.google.com/permissions> and delete any GitHub key you made
for the data feed.
