# Music (Spotify)

The **Music** tile opens Spotify full screen on the TV: what is playing, its artwork, a progress
bar, a row of controls, your library, and visualizers that move with the music.

The TV is a Spotify device of its own, called **TeleDash Pro**. Choose it in Spotify on your
phone, or press Play on the TV, and the music comes out of the TV. The Music view also shows and
steers whatever is playing on your other Spotify devices (a phone, a speaker, a computer).

You need **Spotify Premium**. Spotify only lets Premium accounts play through or control another
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
5. Under the question about which APIs you plan to use, tick **Web API** and **Web Playback
   SDK**. Save.
6. Copy the app's **Client ID** (32 letters and digits). There is also a client secret:
   TeleDash Pro does not need it and never asks for it.
7. Back on the setup page, paste the Client ID, tap **Save client ID**, then **Sign in with
   Spotify** and allow access.
8. Spotify sends your phone to the TeleDash Pro site's `oauth/` page, which hands the result
   straight back to your TV on your home network, as it does for Google sign-in.

The **Music** tile now appears on the TV, just before **Set up**.

What TeleDash Pro asks Spotify for: to see and control playback, to play music on the TV, to
read your library and playlists and your recently played songs, and to save or remove a song from
your Liked Songs (the heart button). Spotify's sign-in page also lists your email address and
account details: Spotify requires those two permissions of any app that plays music, and TeleDash
Pro does not read either.

If you connected Spotify before version 1.2.0, sign in once more on the setup page: playing on the
TV needs a permission the earlier sign-in did not ask for.

## On the TV

Open it with the **Music** tile or the remote's **yellow** button.

| Button | What it does |
|---|---|
| Left / Right | Move along the controls |
| OK | Press the highlighted control |
| Up | Open the library: playlists, albums, liked songs, recently played, the queue, devices, options |
| Down | Hide the artwork and controls now |
| Back | Close the library, then leave the Music view (the music keeps playing) |
| Play, Pause, Stop | Play or pause |
| Fast-forward, Rewind | Next and previous song |

The controls, left to right: shuffle, previous, back 15 seconds, play or pause, forward 15
seconds, next, repeat (off, all, one), like, volume down and up (only when the playing device
lets Spotify set its volume), the visualizer, and the library.

In the library, **OK** opens a playlist or album, or plays a song. Choosing a song inside a
playlist or album plays the rest of it afterwards. **Devices** lists your Spotify devices;
choosing one moves the music there.

"Nothing is playing" means Spotify is not playing anywhere. Press **OK** on Play to start on the
TV, pick a song from the library, or start Spotify on a phone, speaker or computer.

## Playing on the TV

When the TV starts playing, the Music view opens by itself. To move music that is playing
somewhere else onto the TV, choose **TeleDash Pro** under **Devices**, or in the device list of
any Spotify app.

This part depends on two things about the TV, and TeleDash Pro checks both before it offers the
TV as a device:

- Spotify's player expects a newer browser than the TV has, and on its own would stop every song
  after ten seconds. The helper repairs that on your TV each time the player starts, through the
  TV's built-in developer tools. Those are available on TVs set up with Homebrew Channel in the
  usual way. Where they are not, the Music view says so and works as a remote control for your
  other devices.
- Spotify can change its player at any time. If playing on the TV stops working after such a
  change, everything else in the Music view carries on.

## Visualizers

Behind the player there is a visualizer. The button with four bars, next to the library button,
steps through them: spectrum bars, oscilloscope, radial, particles, plasma, and off. They take
their colours from the album artwork (the retro bars keep their green, yellow and red).

**They move with the music when the TV is the one playing.** The helper measures the sound on its
way to the TV's speakers (the TV's own mix, not a microphone) thirty times a second, while the
Music view is open. The sound itself is never stored and never leaves the TV.

When the music is playing on another device, the TV has no sound to measure, so the visualizers
move to a made-up beat instead, and the player says so when you switch.

## Fade, and the look

After a few seconds without a button press, the artwork and controls fade away, and any button
brings them back. With the remote, press **Up** for the library and choose **Options**; each
press of **OK** steps an option to its next value. The setup page on your phone has the same
settings. You can set:

- **how long** before they fade (0 = never);
- **how much stays** once faded, from 0% (nothing) to 100% (no change). Whatever stays drifts
  slowly, so nothing sits still on an OLED screen;
- **the look**: *retro*, a late-1990s desktop music player with silver windows and a green
  display; *modern*, in the dashboard's own style; or *slim*, one strip along the bottom that
  leaves the screen to the visualizer.

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
- **"To play music on this TV itself, sign in to Spotify again"**: the sign-in was made before
  version 1.2.0. Sign in once more on the setup page.
- **"This TV cannot play Spotify itself"**: the repair described under "Playing on the TV" could
  not be made. Music still steers your other devices.
- **A song stops after about ten seconds on the TV**: leave the Music view and open it again,
  which repeats the repair, then start the song again.
- **Sign-in is not offered**: development builds have no site for Spotify to return to. Install
  a release build from Homebrew Channel.
- **"INVALID_CLIENT: Invalid redirect URI"** on Spotify's page: the Redirect URI in your
  Spotify app does not match the one on the setup page exactly, including the final `/`.
