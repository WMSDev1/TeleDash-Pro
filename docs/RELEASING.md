# Releasing

Releases happen on merge. When a push to `main` (normally a merged pull request) carries a
version in `app/appinfo.json` that has no GitHub Release yet, CI builds the package, creates the
tag `vX.Y.Z` and a GitHub Release, and updates the Homebrew Channel repository on the project's
GitHub Pages site. A merge that keeps an already released version publishes nothing.

## One-time setup for a repository

- **GitHub Pages** must be turned on for the repository (Settings → Pages → Source:
  **GitHub Actions**, which is how `.github/workflows/release.yml` deploys the site).
- **Let `main` deploy to Pages.** Turning Pages on creates an environment called
  `github-pages` that accepts deployments from the default branch (`main`), which is where
  releases run. If its deployment rules were changed (Settings → Environments → `github-pages`
  → Deployment branches and tags), make sure `main` is allowed. Otherwise the Release is still
  created, but the Pages deployment is refused and Homebrew Channel and automatic updates never
  see the new version.
- The release workflow fills `pagesBase` in `project.json` from the repository
  (`https://<owner>.github.io/<repo>`). The Google sign-in return address and the Homebrew
  Channel repository address both come from it, so a fork publishes under its own address.
- Turn on **private vulnerability reporting** (Settings → Code security) so people can report
  problems privately; see [SECURITY.md](../SECURITY.md).

## The project's Google client

Release packages carry one Google OAuth client, so users only sign in, with no Google Cloud setup of
their own. The maintainer creates it once. It never goes into git: `scripts/build.sh` takes it
from a local `google-client.json` (git-ignored) or, in the release job, from the repository
secret `GOOGLE_CLIENT`. The client secret does end up inside the public package; for an
app installed on people's devices Google does not treat it as confidential, and it gives no
access to anyone's calendar.

> Google renames and moves console pages from time to time. If a menu is not where this says,
> look for the same words nearby.

1. Go to <https://console.cloud.google.com/>, open the project picker, choose **New project**,
   name it `TeleDash Pro`, create it, and make sure it is selected.
2. **APIs & Services → Library**: search **Google Calendar API**, open it, choose **Enable**.
3. **Google Auth Platform → Branding** (older consoles: **OAuth consent screen**):
   - **App name** `TeleDash Pro`; **User support email** and **Developer contact**: the
     maintainer's address (Google shows the support email on the consent screen).
   - Leave the logo empty: adding one requires Google's verification before it shows.
   - **Application home page** `https://<owner>.github.io/<Repo>/` and **Application privacy
     policy link** `https://<owner>.github.io/<Repo>/privacy/` (`site/privacy/index.html`,
     published with each release). Google will not publish the app without them.
   - **Authorized domains**: `<owner>.github.io`.
   - Google's branding check also needs proof that you own the home page: in Google Search
     Console (same Google account as the Cloud project) add a **URL prefix** property for the
     home page and verify it with the **HTML file** method. The file goes in `site/` (this
     project's is `site/google94e74883a7fd90b2.html`); keep it there, or ownership lapses.
4. **Audience**: user type **External**. Then **Publish app** so the status is **In
   production**. Do not leave it in **Testing**: sign-ins would expire after about seven days
   and only listed test users could sign in. Do not submit for verification yet.
5. **Data access**: **Add or remove scopes**, add
   `https://www.googleapis.com/auth/calendar.readonly`, save.
6. **Clients → Create client**:
   - **Application type**: **Web application** (not "TVs and Limited Input devices").
   - **Name**: `TeleDash Pro`.
   - **Authorised JavaScript origins**: leave empty.
   - **Authorised redirect URIs**: the release site plus `/oauth/`, exactly, for example
     `https://<owner>.github.io/<Repo>/oauth/` (keep the repository name's capitals and the
     trailing slash).
   - **Create**, then **Download JSON**.
7. Save the download as `google-client.json` in the repository root (it is git-ignored, and
   `scripts/check.sh` fails if it is ever tracked). Local builds now include it.
8. For release builds, store it as the repository secret (run by the maintainer):

   ```sh
   gh secret set GOOGLE_CLIENT < google-client.json
   ```

   Or on the website: Settings → Secrets and variables → Actions → **New repository secret**,
   name `GOOGLE_CLIENT`, value: the whole contents of `google-client.json`.

   The release job stops with an error if this secret is missing, rather than publishing a
   package without Google sign-in.

Until the app is verified, users see "Google hasn't verified this app" once and the client is
limited to 100 users in total. Verification (later) needs the homepage, a privacy policy, and a
short video of the sign-in, and Google's review.

## Making a release

1. In the pull request, raise the version in `app/appinfo.json` (`"version": "X.Y.Z"`; Z for
   fixes, Y for new features). CI already insists on this when the package changes, and the
   release job refuses a version that is not newer than the latest release: Homebrew Channel
   and the automatic updater only offer a newer version.
2. Merge the pull request. That is the release: no tag to push by hand.
3. Watch **Actions → Release** for the run on the merge commit.

To run it again by hand (for example after adding a missing secret): **Actions → Release → Run
workflow** on `main`. It only publishes if that version has no Release yet.

## What CI does on a release

In outline (the workflow files in `.github/workflows/` are the source of truth):

1. Runs every check (`scripts/check.sh`).
2. Builds the package with `scripts/build.sh`, with `pagesBase` filled in.
3. Writes the Homebrew Channel manifest `com.teledashpro.dashboard.manifest.json`
   (id, version, package address, size, and SHA-256 hash of the package).
4. Creates the tag `vX.Y.Z` on the merged commit and a GitHub Release for it, with the `.ipk`
   and the manifest attached.
5. Publishes `site/` to GitHub Pages with:
   - `repo/`: the manifest and the repository index Homebrew Channel reads;
   - `oauth/index.html`: the Google sign-in return page.

After that:

- TVs that have added the repository see the update in Homebrew Channel.
- TVs with automatic updates turned on install it within about a day, after checking the
  package's SHA-256 against the manifest. Everyone else can update from Homebrew Channel, or on
  demand from the TV.

## Checking a release

- The release page lists the `.ipk` and the manifest, and the manifest's `version` equals the tag.
- `https://<owner>.github.io/<repo>/repo/com.teledashpro.dashboard.manifest.json` serves the new
  manifest.
- `https://<owner>.github.io/<repo>/oauth/` loads (it shows an error when opened without a
  sign-in result; that is correct).
- On a test TV: install or update from Homebrew Channel, open TeleDash Pro, and confirm the
  helper is re-installed for the new version (setup page reachable through the QR code).

## If a release is bad

Merge a fix or revert with a higher version. Do not re-use or move a tag, or delete a Release
to publish the same version again: TVs compare version numbers, and a package with the same version will not be
offered again.

## Unconfirmed

- The repository index `repo/apps.json` follows the format in Homebrew Channel's sources, but
  adding it as a custom repository has not been tried on a TV yet. The release workflow is the
  source of truth.
