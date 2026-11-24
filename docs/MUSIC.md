# Music (Spotify)

The **Music** tile opens Spotify full screen on the TV: what is playing, its artwork, a progress
bar, a row of controls, and your library. TeleDash Pro is a remote control here: the sound comes
from whichever Spotify device is playing (a phone, a speaker, a computer), and the Music view
shows and steers it.

You need **Spotify Premium**. Spotify only lets Premium accounts control playback from another
app, and only Premium accounts may create the developer app described below.

## Why you create your own Spotify app

Spotify limits each developer app to five users until it passes a review meant for large
companies. So TeleDash Pro cannot ship one Spotify app for everybody, the way it does for Google
Calendar. Instead you create your own, once. It is free and takes about five minutes, and it
means your sign-in goes through an app that only you control.

## Connect

1. On your phone, open the setup page (scan the QR code on the TV; see [SETUP.md](SETUP.md))
   and go to **Music (Spotify)**. It shows a **Redirect URI**. Keep the page open.
2. In another tab, open `developer.spotify.com/dashboard` and sign in with your Spotify account.
3. Choose **Create app**. The name and description can be anything.
4. Under **Redirect URIs**, paste the Redirect URI from the setup page, exactly as shown.
5. Under the question about which APIs you plan to use, tick **Web API**. Save.
6. Copy the app's **Client ID** (32 letters and digits). There is also a client secret:
   TeleDash Pro does not need it and never asks for it.
7. Back on the setup page, paste the Client ID, tap **Save client ID**, then **Sign in with
   Spotify** and allow access.
8. Spotify sends your phone to the TeleDash Pro site's `oauth/` page, which hands the result
   straight back to your TV on your home network, as it does for Google sign-in.

The **Music** tile now appears on the TV, just before **Set up**.

What TeleDash Pro asks Spotify for: to see and control playback, to read your library and
playlists and your recently played songs, and to save or remove a song from your Liked Songs
(the heart button). Nothing else.

## On the TV

Open it with the **Music** tile or the remote's **yellow** button.

| Button | What it does |
|---|---|
| Left / Right | Move along the controls |
| OK | Press the highlighted control |
| Up | Open the library: playlists, albums, liked songs, recently played, the queue, devices |
| Down | Hide the artwork and controls now |
| Back | Close the library, then leave the Music view (the music keeps playing) |
| Play, Pause, Stop | Play or pause |
| Fast-forward, Rewind | Next and previous song |

The controls, left to right: shuffle, previous, back 15 seconds, play or pause, forward 15
seconds, next, repeat (off, all, one), like, volume down and up (only when the playing device
lets Spotify set its volume), and the library.

In the library, **OK** opens a playlist or album, or plays a song. Choosing a song inside a
playlist or album plays the rest of it afterwards. **Devices** lists your Spotify devices;
choosing one moves the music there.

"Nothing is playing" means Spotify has no active device. Start Spotify on a phone, speaker or
computer, or pick one under **Devices**.

## Fade, and the look

After a few seconds without a button press, the artwork and controls fade away, and any button
brings them back. On the setup page you can set:

- **how long** before they fade (0 = never);
- **how much stays** once faded, from 0% (nothing) to 100% (no change). Whatever stays drifts
  slowly, so nothing sits still on an OLED screen;
- **the look**: *retro*, a late-1990s desktop music player with silver windows and a green
  display, or *modern*, in the dashboard's own style.

While music is playing in the Music view the screen does not go to standby. Paused and left
alone, it goes to standby as usual.

## Disconnecting

On the setup page, **Disconnect Spotify** deletes the sign-in from the TV and hides the Music
tile. To withdraw access on Spotify's side as well, open your Spotify account page, **Manage
apps**, and remove your app; or delete the app in the developer dashboard.

## If it stops working

- **"Spotify is not connected"**: sign in again on the setup page. Spotify ends a sign-in when
  you change your password or remove the app's access, and a developer app's sign-in also has a
  fixed lifetime (the app's page in the developer dashboard shows it, for example 180 days).
- **"Spotify Premium is needed"**: the account lost Premium.
- **Sign-in is not offered**: development builds have no site for Spotify to return to. Install
  a release build from Homebrew Channel.
- **"INVALID_CLIENT: Invalid redirect URI"** on Spotify's page: the Redirect URI in your
  Spotify app does not match the one on the setup page exactly, including the final `/`.
