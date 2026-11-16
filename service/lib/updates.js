"use strict";
// Automatic updates (CONTRACT.md "Automatic updates"; off by default). Reads the Homebrew Channel
// manifest from the project's Pages site, downloads the .ipk, refuses it unless its SHA-256
// matches the manifest, then installs it with webOS's developer install service.
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var URL = require("url").URL;
var config = require("./config");
var http = require("./http");
var settings = require("./settings");
var tv = require("./tv");
var util = require("./util");

var DAY = 24 * 60 * 60 * 1000;

var state = { current: config.version, latest: null, available: false, installing: false, checkedAt: null, error: null };

// -1, 0 or 1, comparing dotted numeric versions ("1.10.0" > "1.9.3").
function compareVersions(a, b) {
  var x = String(a).split("."), y = String(b).split(".");
  for (var i = 0; i < Math.max(x.length, y.length); i++) {
    var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function manifestUrl() { return config.pagesBase + "/repo/" + config.appId + ".manifest.json"; }

function check() {
  if (!config.pagesBase) return Promise.reject(util.httpError(409, "This build has no update address (development build)."));
  return http.json({ url: manifestUrl(), timeout: 20000, maxBytes: 256 * 1024 }).then(function (m) {
    if (!util.isObject(m) || typeof m.version !== "string") throw util.httpError(502, "The update information is not in the expected format.");
    state.latest = m.version;
    state.available = compareVersions(m.version, config.version) > 0;
    state.checkedAt = Date.now();
    return m;
  });
}

// A fresh root-owned directory for the download. Never a fixed name in world-writable /tmp: another
// user could plant that file (or a symlink) first and swap the package after it was verified.
// 0711 so the install service can reach the file without being able to list the directory.
function privateDir() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "teledash-update-"));
  fs.chmodSync(dir, 457);                                   // 457 = 0o711
  return dir;
}

function removeDir(dir) {
  try { fs.readdirSync(dir).forEach(function (f) { fs.unlinkSync(path.join(dir, f)); }); fs.rmdirSync(dir); } catch (e) { /* already gone */ }
}

// Downloads and verifies; resolves the path of the verified file (dest, or a file in a new
// private directory that the caller removes).
function download(m, dest) {
  var expected = m.ipkHash && typeof m.ipkHash.sha256 === "string" ? m.ipkHash.sha256.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(expected)) return Promise.reject(util.httpError(502, "The update has no checksum, so it was not installed."));
  var url;
  try { url = (/^https?:\/\//i.test(m.ipkUrl) ? new URL(m.ipkUrl) : new URL(m.ipkUrl, manifestUrl())).href; } catch (e) { return Promise.reject(util.httpError(502, "The update has no valid download address.")); }
  if (!/^https:/.test(url)) return Promise.reject(util.httpError(502, "The update download is not over https, so it was not installed."));
  return http.request({ url: url, timeout: 300000, maxBytes: 64 * 1024 * 1024 }).then(function (r) {
    if (r.status !== 200) throw util.httpError(502, "Could not download the update (HTTP " + r.status + ").");
    var actual = crypto.createHash("sha256").update(r.body).digest("hex");
    if (actual !== expected) throw util.httpError(502, "The downloaded update did not match its checksum, so it was not installed.");
    var dir = dest ? null : privateDir(), file = dest || path.join(dir, "teledash-update.ipk");
    // "wx": never write into a file someone else made. 0644: the package is public, and the install
    // service may not run as root.
    try { fs.writeFileSync(file, r.body, { flag: "wx", mode: 420 }); } catch (e) { if (dir) removeDir(dir); throw e; }
    return file;
  });
}

// Checks, and when there is something newer, starts downloading and installing it in the
// background. Resolves { started: true } as soon as the install is under way.
function startUpdate() {
  if (state.installing) return Promise.reject(util.httpError(409, "An update is already being installed."));
  if (!tv.hasLuna()) return Promise.reject(util.httpError(409, "Updates can only be installed on the TV."));
  return check().then(function (m) {
    if (!state.available) throw util.httpError(409, "TeleDash Pro is already up to date (version " + config.version + ").");
    state.installing = true;
    state.error = null;
    util.log("installing update " + m.version);
    var file = null, wasInFront = false;
    tv.foregroundApp().then(function (id) {
      wasInFront = id === config.appId;
      return download(m);
    }).then(function (f) { file = f; return tv.installIpk(file); }).then(function () {
      return tv.foregroundApp();
    }).then(function (id) {
      // Bring the dashboard back only if it is on screen, or was before the install closed it and
      // nothing else has been opened since: never interrupt what someone is watching.
      var relaunch = id === config.appId || (wasInFront && (!id || id === "com.webos.app.home"));
      if (!relaunch) { util.log("update " + m.version + " installed; it applies the next time the app opens"); return; }
      util.log("update " + m.version + " installed; relaunching the app");
      return tv.relaunchApp();
    }).catch(function (e) {
      state.error = e.message;
      util.log("update failed: " + e.message);
    }).then(function () {
      state.installing = false;
      if (file) removeDir(path.dirname(file));
    });
    return { started: true };
  });
}

function daily() {
  check().then(function () {
    if (state.available && settings.load().updates.auto) return startUpdate();
  }).catch(function (e) { state.error = e.message; });
}

function schedule() {
  if (!config.pagesBase) return;                          // development build: nothing to check
  setTimeout(daily, 5 * 60 * 1000).unref();               // let the TV settle after boot first
  setInterval(daily, DAY).unref();
}

function status() {
  return {
    current: state.current, latest: state.latest, available: state.available,
    auto: settings.load().updates.auto, installing: state.installing, error: state.error
  };
}

module.exports = { compareVersions: compareVersions, check: check, download: download, startUpdate: startUpdate, schedule: schedule, status: status, _state: state };
