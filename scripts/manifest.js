#!/usr/bin/env node
// Writes the Homebrew Channel (HBC) package manifest and repository index for a release:
//   node scripts/manifest.js --ipk build/<id>_<ver>_all.ipk --out _site/repo \
//        --base https://<owner>.github.io/<repo> --ipk-url <release asset URL> --source-url https://github.com/<owner>/<repo>
// Output in --out:
//   <appId>.manifest.json  the package manifest (also read by the service's auto-update, CONTRACT.md)
//   apps.json              the repository index; users add <base>/repo/apps.json in HBC Settings
//   icon.png               app/largeIcon.png, for the iconUri
//
// Format sources (checked 2026-11):
//   https://github.com/webosbrew/webos-homebrew-channel/blob/main/tools/gen-manifest.js
//     manifest fields: id, version, type, title, appDescription, iconUri, sourceUrl,
//     rootRequired, ipkUrl, ipkHash.sha256
//   https://github.com/webosbrew/webos-homebrew-channel/blob/main/frontend/views/BrowserPanel.js
//     a repository URL must return JSON with a "packages" array (only that one URL is fetched)
//   https://github.com/webosbrew/webos-homebrew-channel/blob/main/frontend/views/DetailsPanel.js
//     uses package.manifest when present, else fetches manifestUrl; rootRequired may be
//     true | false | "optional"; ipkUrl is resolved against manifestUrl, so both are absolute here
//   https://github.com/webosbrew/webos-homebrew-channel/blob/main/frontend/configutils.js
//     the default repository is https://repo.webosbrew.org/api/apps.json
//   https://repo.webosbrew.org/api/apps.json
//     live example: { paging: {...}, packages: [ { id, title, iconUri, manifestUrl, manifest,
//     pool, shortDescription, ... } ] }, manifests also carry ipkSize
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DESCRIPTION = "An open-source home screen for rooted LG webOS TVs.";

function buildManifest(opts) {
  const a = opts.appinfo;
  return {
    id: a.id,
    version: a.version,
    type: a.type || "web",
    title: opts.title || a.title,
    appDescription: a.appDescription || DESCRIPTION,
    iconUri: opts.base + "/repo/icon.png",
    sourceUrl: opts.sourceUrl,
    // The dashboard runs without root; the phone setup helper and Home-button kiosk need it.
    rootRequired: "optional",
    ipkUrl: opts.ipkUrl,
    ipkSize: opts.ipk.length,
    ipkHash: { sha256: crypto.createHash("sha256").update(opts.ipk).digest("hex") },
  };
}

function buildIndex(manifest, base) {
  return {
    paging: { page: 1, count: 1, maxPage: 1, itemsTotal: 1, prevUrl: null, nextUrl: null },
    packages: [{
      id: manifest.id,
      title: manifest.title,
      iconUri: manifest.iconUri,
      manifestUrl: base + "/repo/" + manifest.id + ".manifest.json",
      manifest: manifest,
      pool: "main",
      shortDescription: manifest.appDescription,
    }],
  };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--[a-z-]+$/.test(argv[i]) || argv[i + 1] === undefined) throw new Error("bad argument: " + argv[i]);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of ["ipk", "out", "base", "ipk-url", "source-url"]) if (!o[k]) throw new Error("missing --" + k);
  if (!/^https:\/\/[^/]+(\/[^/]+)*$/.test(o.base)) throw new Error("--base must be https://host[/path] without a trailing slash");
  return o;
}

function main() {
  const o = args(process.argv.slice(2));
  const appinfo = JSON.parse(fs.readFileSync(path.join(ROOT, "app", "appinfo.json"), "utf8"));
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, "project.json"), "utf8"));
  const expected = appinfo.id + "_" + appinfo.version + "_all.ipk";
  if (path.basename(o.ipk) !== expected) throw new Error("ipk is " + path.basename(o.ipk) + ", expected " + expected);
  if (path.basename(o["ipk-url"]) !== expected) throw new Error("--ipk-url must end in " + expected);

  const manifest = buildManifest({
    appinfo, title: project.name, ipk: fs.readFileSync(o.ipk), base: o.base,
    ipkUrl: o["ipk-url"], sourceUrl: o["source-url"],
  });
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, manifest.id + ".manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(o.out, "apps.json"), JSON.stringify(buildIndex(manifest, o.base), null, 2) + "\n");
  fs.copyFileSync(path.join(ROOT, "app", appinfo.largeIcon || "largeIcon.png"), path.join(o.out, "icon.png"));
  console.log("wrote " + path.join(o.out, manifest.id + ".manifest.json") + " and apps.json (" + manifest.version + ")");
}

if (require.main === module) {
  try { main(); } catch (e) { console.error("manifest: " + e.message); process.exit(1); }
}
module.exports = { buildManifest, buildIndex };
