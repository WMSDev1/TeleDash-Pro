# Connecting Google Calendar

TeleDash Pro reads your Google Calendar with **read-only** access, using your own Google Cloud
project. This takes about 15 minutes once. After that, sign-in happens on your phone and the
TV keeps itself connected.

Why your own project? TeleDash Pro has no company behind it and no server, so there is no
shared "TeleDash" Google app to sign in to. Your project means only you hold the keys, and you
can switch it off at any time.

Why not "sign in on the TV with a code"? Google's TV sign-in method (the "device flow") does not
allow calendar access, so sign-in happens in your phone's browser instead.

Prefer something quicker? See [The iCal alternative](#the-ical-alternative) below, and its
risk.

> Google changes the names and layout of its console from time to time. If a menu below is not
> where this guide says, look for the same words nearby.

## What you need

- A Google account (the one whose calendar you want on the TV).
- A **release build** of TeleDash Pro, installed from Homebrew Channel. Development builds have
  no web address for Google to return to, so Google sign-in is disabled in them.
- The web address of the TeleDash Pro site your build came from. It is the Homebrew Channel
  repository address without `/repo/apps.json` at the end, for example
  `https://<owner>.github.io/teledash-pro`. Below this is written `<site>`.
- Your phone on the same home network as the TV, with the setup page open
  (see [SETUP.md](SETUP.md)).

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in.
2. Open the project picker at the top and choose **New project**.
3. Name it something you will recognise, for example `TeleDash TV`, and create it.
   Make sure the new project is selected before continuing.

## 2. Turn on the Google Calendar API

1. Go to **APIs & Services → Library**.
2. Search for **Google Calendar API**, open it, and choose **Enable**.

## 3. Set up the OAuth consent screen

This is the screen Google shows when you sign in, and the rules for who may use your project.
In newer versions of the console it is under **Google Auth Platform** (Branding, Audience,
Data access); in older ones under **APIs & Services → OAuth consent screen**.

1. **App name**: anything, for example `TeleDash TV`. **Support email** and **developer contact**:
   your own address. These are shown only to you.
2. **Audience / user type**: **External** (unless your account belongs to a Google Workspace
   organisation and you only need it there, in which case **Internal** is simpler).
3. **Scopes / data access**: add `https://www.googleapis.com/auth/calendar.readonly`
   ("See and download any calendar you can access"). This is the only scope TeleDash Pro asks
   for. It cannot change or delete anything.
4. **Test users**: add the Google account whose calendar you will show.

### Publishing status: Testing or In production

A new project starts in **Testing**.

- **Testing**: only the test users you listed can sign in. Google also expires the sign-in
  after about **seven days**, so the TV loses calendar access roughly once a week and you
  have to sign in again from the setup page. *(Assumed: this is Google's published rule for
  Testing apps that request calendar access; it has not been measured with TeleDash Pro.)*
- **In production**: choose **Publish app** on the consent screen page. The sign-in then
  lasts until you revoke it. Because calendar access is a "sensitive" scope and your project
  has not been through Google's review, Google shows a warning when you sign in
  ("Google hasn't verified this app"). Since you created the app yourself, it is safe to choose
  **Advanced → Go to TeleDash TV (unsafe)**. *(Assumed: unverified personal projects can be
  published this way and are limited to a small number of users, which is fine for one
  household; Google's rules may change.)*

If you are unsure, start with Testing, check that everything works, then publish.

## 4. Create the OAuth client

1. Go to **APIs & Services → Credentials** (or **Google Auth Platform → Clients**).
2. Choose **Create credentials → OAuth client ID**.
3. **Application type**: **Web application**. (Not "TVs and Limited Input devices".)
4. **Name**: anything, for example `TeleDash TV`.
5. **Authorised JavaScript origins**: leave empty.
6. **Authorised redirect URIs**: add exactly

   ```
   <site>/oauth/
   ```

   for example `https://<owner>.github.io/teledash-pro/oauth/`, with the trailing slash.
   It must match the site your build came from, character for character.
7. Choose **Create**. Google shows a **Client ID** and a **Client secret**. Keep this window open.

## 5. Connect on the setup page

1. On your phone's setup page, under **Calendar**, choose **Google**.
2. Paste the **Client ID** and **Client secret**, and save. They are stored only on your TV and
   are never shown again.
3. Choose **Sign in with Google**. Your phone goes to Google's normal sign-in page.
4. Sign in with the test-user account and allow read-only calendar access.
5. Google sends your phone to `<site>/oauth/`. That page does one thing: it hands the result
   straight back to your TV on your home network and returns you to the setup page, which
   should now say Google is connected.
6. Choose which calendars to show. Your main calendar is selected by default.

Use the **same phone and home network** for the whole sign-in: the return page can only reach
the TV from inside your home network. For safety it only ever forwards to a home-network
address (`10.x.x.x`, `172.16–31.x.x` or `192.168.x.x`) and never anywhere else.

## Revoking access

- At any time: <https://myaccount.google.com/permissions>, find your app (for example
  `TeleDash TV`), and remove its access. The TV stops showing your calendar.
- On the setup page: remove the Google connection. This deletes the stored keys and sign-in from
  the TV. It does not tell Google; revoke it there as well if you are done with it.
- To stop everything for good, delete the Google Cloud project.

## If it stops working

| Symptom | Likely cause |
|---|---|
| Google says `redirect_uri_mismatch` | The redirect URI in step 4 does not exactly match `<site>/oauth/` (check `https`, the owner, and the trailing slash). |
| Google says access is blocked / app not available | You are signing in with an account that is not a test user, while the app is in Testing. |
| Worked for a week, then stopped | The app is still in Testing (see above). Sign in again, or publish the app. |
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
