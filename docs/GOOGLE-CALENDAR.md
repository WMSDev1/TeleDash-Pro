# Connecting Google Calendar

TeleDash Pro reads your Google Calendar with **read-only** access. You sign in with Google on
your phone once; after that the TV keeps itself connected and fetches your events itself.

Why on the phone and not on the TV? Google's TV sign-in method (the "device flow", where you
type a code at google.com/device) does not allow calendar access, so sign-in happens in your
phone's browser instead, from the setup page you open with the TV's QR code.

## Sign in

1. Open the setup page on your phone (scan the QR code on the TV; see [SETUP.md](SETUP.md)).
   Your phone must be on the same home network as the TV.
2. Under **Calendar**, choose **Google**, then **Sign in with Google**.
3. Pick your Google account and allow TeleDash Pro to see your calendars.
   - Google may first say **"Google hasn't verified this app"**. TeleDash Pro has not been
     through Google's review yet. Tap **Advanced**, then **Go to TeleDash Pro**. *(Until it is
     verified, Google also limits the app to 100 users in total.)*
4. Google sends your phone to the TeleDash Pro site's `oauth/` page, which hands the result
   straight back to your TV on your home network and returns you to the setup page.
5. Choose which calendars to show. Your main calendar is selected by default.

The return page only ever forwards to a home-network address (`10.x.x.x`, `172.16–31.x.x` or
`192.168.x.x`), never anywhere else. Sign-in needs a **release build** (installed from Homebrew
Channel): development builds have no site for Google to return to, and no built-in Google client.

## Advanced: your own Google client

If you build TeleDash Pro yourself, or would rather not use the project's Google app, create
your own OAuth client and paste it under **Calendar → Google → Advanced** on the setup page. A
client you save there is used instead of the built-in one. It takes about 15 minutes; follow
[RELEASING.md](RELEASING.md#the-projects-google-client) with your own names, and use the
redirect URI the setup page shows. A personal client left in **Testing** status loses its
sign-in after about seven days; publish it (**In production**) to avoid that.

## Revoking access

- At any time: <https://myaccount.google.com/permissions>, find **TeleDash Pro** (or your own
  client's name), and remove its access. The TV stops showing your calendar.
- On the setup page: **Disconnect Google**. This deletes the sign-in (and any keys you saved)
  from the TV. It does not tell Google; revoke it there as well if you are done with it.

## If it stops working

| Symptom | Likely cause |
|---|---|
| Google says `redirect_uri_mismatch` | The client's redirect URI does not exactly match `<site>/oauth/` (check `https`, the owner, the repository name's capitals, and the trailing slash). |
| Google says access is blocked / app not available | The client is in Testing and your account is not a test user, or the unverified app has reached its 100-user limit. |
| Worked for a week, then stopped | Your own client is still in Testing (see above). Sign in again, or publish it. |
| "Sign in with Google" is greyed out | This build has no built-in client (a development build). Install a release build, or add your own client under Advanced. |
| The `oauth` page shows an error instead of returning | It refused to forward somewhere that is not a home-network address, or the sign-in link was opened on a different network. Start again from the setup page. |

## The iCal alternative

Google Calendar, and most other calendar services, can give you a **secret address** for a
calendar in iCal format. TeleDash Pro can read that instead, with no Google Cloud project.

In Google Calendar on a computer: **Settings → Settings for my calendars → (your calendar) →
Integrate calendar → Secret address in iCal format**. Copy it and paste it into the setup page
under **Calendar → iCal address**. Use an address starting with `https://`.

**The risk:** this address is a key and a door at once. **Anyone who has it can read your
whole calendar** (past and future, every detail of every event) for as long as it exists,
without signing in, and you cannot see who has used it. It does not expire. TeleDash Pro stores
it only on your TV and never displays it again, but if it ever leaks (a screenshot, a shared
note, a chat message) your calendar is exposed until you notice.

If you use it:

- Never paste it anywhere except the TeleDash Pro setup page.
- If you think it has leaked, go back to the same Google Calendar setting and choose **Reset**.
  The old address stops working at once; paste the new one into the setup page.
- Consider a separate calendar that holds only what you want on the TV, and use that
  calendar's secret address.

Google sign-in (above) is safer: it is read-only, can be revoked from your Google account, and
the TV holds a token rather than a permanent address.
