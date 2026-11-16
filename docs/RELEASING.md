# Releasing

Releases are driven by git tags. Pushing a tag `vX.Y.Z` makes CI build the package, publish a
GitHub Release, and update the Homebrew Channel repository on the project's GitHub Pages site.

## One-time setup for a repository

- **GitHub Pages** must be turned on for the repository (Settings → Pages → Source:
  **GitHub Actions**, which is how `.github/workflows/release.yml` deploys the site).
- **Let tags deploy to Pages.** Turning Pages on creates an environment called `github-pages`
  that, by default, only accepts deployments from the default branch. Releases run from a tag,
  so add one: Settings → Environments → `github-pages` → Deployment branches and tags → Add
  rule → type **Tag**, pattern `v*`. Without it the Release is still created, but the Pages
  deployment is refused and Homebrew Channel and automatic updates never see the new version.
- The release workflow fills `pagesBase` in `project.json` from the repository
  (`https://<owner>.github.io/<repo>`). The Google sign-in return address and the Homebrew
  Channel repository address both come from it, so a fork publishes under its own address.
- Turn on **private vulnerability reporting** (Settings → Code security) so people can report
  problems privately; see [SECURITY.md](../SECURITY.md).

## Making a release

1. Make sure `main` is green: `bash scripts/check.sh` passes locally and in CI.
2. Set the new version in `app/appinfo.json` (`"version": "X.Y.Z"`) and merge that to `main`.
   Use a higher version than the last release: Homebrew Channel and the automatic updater only
   offer a version that is newer than the one installed.
3. Tag that commit with the same version, prefixed with `v`, and push the tag:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   The tag **must** equal the version in `app/appinfo.json`. Do not push the tag until they match.

## What CI does with the tag

In outline (the workflow files in `.github/workflows/` are the source of truth):

1. Runs every check (`scripts/check.sh`).
2. Builds the package with `scripts/build.sh`, with `pagesBase` filled in.
3. Writes the Homebrew Channel manifest `com.teledashpro.dashboard.manifest.json`
   (id, version, package address, size, and SHA-256 hash of the package).
4. Creates a GitHub Release for the tag with the `.ipk` and the manifest attached.
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

Make a new release with a higher version that fixes or reverts the problem. Do not re-use or
move a tag: TVs compare version numbers, and a package with the same version will not be
offered again.

## Unconfirmed

- The repository index `repo/apps.json` follows the format in Homebrew Channel's sources, but
  adding it as a custom repository has not been tried on a TV yet. The release workflow is the
  source of truth.
