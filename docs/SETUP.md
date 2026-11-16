# Setting up TeleDash Pro from your phone

Everything about TeleDash Pro is set from a web page that the TV itself serves to your phone.
Nothing goes through an outside server. This page walks through it.

Before you start: TeleDash Pro is installed, you have opened it once, and you chose **OK** when
it offered to install the helper (see the [README](../README.md#first-run)). Without the helper
there is no setup page; the app runs on its built-in defaults and shows
"Setup helper not running".

> The names of buttons and sections on the setup page may differ slightly from this guide.
> What each setting does is fixed; its label may not be.

## 1. Open the setup page

1. On the TV, select the **Set up** tile (just before **All apps**), or press `0` or the
   blue button on the remote.
2. The TV shows a QR code, an address like `http://192.168.1.50:8770/s/<code>`, and the code.
3. Make sure your phone is on the **same Wi-Fi or home network** as the TV.
4. Scan the QR code with the phone's camera, or type the address into the phone's browser.

The code works **once** and lasts **10 minutes**. While the QR screen stays open the TV makes a
fresh code every 9 minutes. If your phone says *"This code has expired — press OK on the TV for
a new one"*, get a new code on the TV and scan again.

After scanning, your phone stays signed in to the setup page for 12 hours. Press Back on the
remote to close the QR screen.

## 2. Weather

Choose a place, give it a short label, and pick Celsius or Fahrenheit. The TV saves the
position **rounded to one decimal place** (roughly 10 km), so it
never stores your exact address. Turn weather off to hide it.

Under **Alerts** you can turn off:

- **Weather warnings**: official warnings for that place. These come from the US National
  Weather Service, so outside the US you will not see any.
- **Air quality**: the air-quality index, shown when it is worth knowing about.

## 3. App tiles

- **Automatic** (the default): every app installed on the TV that is meant to be opened by a
  person, ordered by how much you use it. The order is updated once a day, never while you
  are looking at the screen. `HDMI 1`, `Set up` and `All apps` stay pinned at the end.
- **Choose my own**: pick apps from the TV's list and put them in order. `HDMI 1` shows only if
  you add it; `Set up` always sits just before `All apps`.
- **Columns**: how many tiles per row (6 by default).

The **All apps** tile opens LG's own home screen. If you have turned on the Home button
setting, it also tells TeleDash Pro to leave you there until you open another app
(see [HOME-BUTTON.md](HOME-BUTTON.md)).

## 4. Calendar

Choose one:

- **Google Calendar**: you sign in with Google on your phone. It needs a one-time setup in
  Google's developer console (about 15 minutes). Step by step:
  [GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md).
- **iCal address**: paste the address of a calendar feed (`.ics`). Quicker, but read the warning
  in [GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md#the-ical-alternative) first.
- **None** (the default).

The TV shows today's and tomorrow's events and checks for changes about every 5 minutes.

## 5. Market strip

Shows a few stock indexes. By default: S&P 500 (`^GSPC`), Nasdaq (`^IXIC`) and Dow (`^DJI`).
You can change the symbols and their labels, or turn the strip off.

## 6. Data feed

One line of your own numbers, from a JSON or CSV file at an address you choose (for example a
file in a GitHub repository). Formats and how to make a safe read-only key:
[DATA-FEED.md](DATA-FEED.md).

## 7. Morning brief

During a time window the screen shows a full-brightness summary (time, weather, calendar,
alerts) instead of dimming. Defaults:

| Days | From | To |
|---|---|---|
| Weekdays | 06:30 | 09:00 |
| Weekends | 07:30 | 10:00 |

Times are 24-hour, in the TV's own time zone. Turn either group off to keep the normal dim
idle view on those days.

## 8. Countdowns

- **Holidays**: on or off.
- **Show when within**: how many days ahead a countdown appears (45 by default).
- **Your dates**: a title and a date. Use `MM-DD` for something that repeats every year
  (a birthday) or `YYYY-MM-DD` for a one-off.

## 9. Idle view

After this many seconds without a button press (120 by default) the screen dims to a slowly
moving clock and weather view, to be kind to the panel. Any button wakes it.

## 10. Home button

**Open TeleDash when I press Home** is off by default. When on, the remote's Home button brings
you back to TeleDash Pro after a short delay (1 second by default, 0 to 30). Read
[HOME-BUTTON.md](HOME-BUTTON.md) before turning it on; it explains how to get to LG's own
home screen and how to undo it.

## 11. Updates

**Automatic updates** are off by default. The helper still checks once a day whether a newer
version has been published, so TeleDash Pro can tell you about it. With automatic updates on,
it downloads the new package, checks its fingerprint (SHA-256) and installs it. **Update now**
on the setup page starts the same steps straight away. You can always update from Homebrew
Channel instead. See [SECURITY.md](../SECURITY.md#updates).

## Removing a key or calendar

Keys and calendar addresses you have entered are never shown again, not even to you. To change
one, enter the new value. To remove it, use the remove button next to it; the TV deletes it from
its secrets file.

## Troubleshooting

| What you see | What to try |
|---|---|
| The phone cannot open the address | Phone and TV must be on the same network. Some guest Wi-Fi networks block devices from reaching each other. |
| "This code has expired" | Codes are single use and last 10 minutes. Get a new one on the TV. |
| "Setup helper not running" on the TV | The helper is not installed or did not start. Close and reopen TeleDash Pro; if it asks to install the helper, choose OK. Restarting the TV also starts it. |
| Changes do not appear on the TV | The TV checks for new settings every 30 seconds. |
| Google sign-in is greyed out | You are running a development build, which has no web address for Google to return to. Install a release build. |
