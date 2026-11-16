"use strict";
// Everything that touches the TV itself: luna-send, the network address, kiosk.conf and
// system/start.sh. Each degrades to a harmless no-op on a developer Mac.
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");
var config = require("./config");
var store = require("./store");
var log = require("./util").log;

// Runs luna-send once; resolves the parsed JSON answer, or null when luna-send is missing.
function luna(uri, payload, timeout) {
  return new Promise(function (resolve) {
    childProcess.execFile("luna-send", ["-n", "1", uri, JSON.stringify(payload || {})],
      { timeout: timeout || 15000, maxBuffer: 8 * 1024 * 1024 }, function (err, stdout) {
        if (err && err.code === "ENOENT") return resolve(null);
        var s = String(stdout || ""), i = s.indexOf("{");
        try { resolve(i >= 0 ? JSON.parse(s.slice(i)) : null); } catch (e) { resolve(null); }
      });
  });
}

var appsCache = { at: 0, list: null };

// Installed, visible apps as [{ id, title }], sorted by title. [] off the TV.
// The app's own icon file. webOS 6 reports it relative to folderPath ("largeIcon.png",
// "images/largeIcon.png"; Verified on an LG C1). Only image files inside the TV's app folders
// are ever served (see appIcon), so a strange listApps answer cannot expose other files.
var APP_DIRS = ["/media/cryptofs/apps/usr/palm/applications/", "/media/developer/apps/usr/palm/applications/",
  "/usr/palm/applications/"];
function iconPath(a) {
  var icon = a.largeIcon || a.icon;
  if (typeof icon !== "string" || !icon || /^[a-z]+:/i.test(icon)) return "";
  if (icon.charAt(0) !== "/") {
    if (typeof a.folderPath !== "string" || !a.folderPath) return "";
    icon = path.join(a.folderPath, icon);
  }
  icon = path.resolve(icon);
  if (!/\.(png|jpe?g)$/i.test(icon)) return "";
  return APP_DIRS.some(function (d) { return icon.indexOf(d) === 0; }) ? icon : "";
}
// Resolves the icon file for an app id, or "" when it has none.
function appIcon(id) {
  return listApps().then(function (apps) {
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i].icon || "";
    return "";
  });
}

function listApps() {
  if (appsCache.list && Date.now() - appsCache.at < 60000) return Promise.resolve(appsCache.list);
  return luna("luna://com.webos.service.applicationmanager/listApps", {}).then(function (r) {
    var apps = (r && Array.isArray(r.apps) ? r.apps : []).filter(function (a) {
      return a && typeof a.id === "string" && a.visible !== false && a.id !== config.appId;
    }).map(function (a) {
      return { id: a.id, title: typeof a.title === "string" && a.title ? a.title : a.id, icon: iconPath(a) };
    });
    apps.sort(function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; });
    if (r) appsCache = { at: Date.now(), list: apps };
    return apps;
  });
}

function isPrivate(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// The TV's LAN IPv4 address: the first private one, else the first non-loopback one.
function lanAddress() {
  var nets = os.networkInterfaces(), found = [];
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (n) {
      if ((n.family === "IPv4" || n.family === 4) && !n.internal && !/^169\.254\./.test(n.address)) found.push(n.address);
    });
  });
  var priv = found.filter(isPrivate);
  return priv[0] || found[0] || null;
}

// kiosk.conf is read (never sourced) by the kiosk script and start.sh.
function writeKiosk(home) {
  var delay = Math.max(0, Math.min(30, Math.floor(Number(home.delaySeconds) || 0)));
  store.writeText("kiosk.conf", "ENABLED=" + (home.opensDashboard ? 1 : 0) + "\nDELAY=" + delay + "\n");
}

function ensureKiosk(home) {
  if (!fs.existsSync(store.file("kiosk.conf"))) writeKiosk(home);
}

var restartTimer = null;

// Runs `sh <APPDIR>/system/start.sh restart` a moment later (so the HTTP answer gets out first).
// start.sh stops this very process and its children, so it is started through an extra shell
// that exits at once: the restart script is then nobody's child and survives the stop.
function restartSystem() {
  var script = path.join(config.APPDIR, "system", "start.sh");
  if (!fs.existsSync(script)) {
    log("system/start.sh not found (not an installed package): kiosk not restarted");
    return false;
  }
  clearTimeout(restartTimer);
  restartTimer = setTimeout(function () {
    log("running system/start.sh restart");
    var child = childProcess.spawn("sh", ["-c", 'sh "$0" restart >/dev/null 2>&1 </dev/null &', script],
      { detached: true, stdio: "ignore", env: Object.assign({}, process.env, { TELEDASH_DATA: config.DATA }) });
    child.on("error", function (e) { log("could not run start.sh: " + e.message); });
    child.unref();
  }, 800);
  return true;
}

function hasLuna() {
  var dirs = (process.env.PATH || "").split(":").concat(["/usr/bin", "/bin", "/usr/sbin"]);
  return dirs.some(function (d) { return d && fs.existsSync(path.join(d, "luna-send")); });
}

// Installs an .ipk through webOS's developer install service and waits for "installed".
// luna-send runs subscribed (-i) because the first reply only acknowledges the request; the
// install itself finishes later.
function installIpk(ipkPath) {
  return new Promise(function (resolve, reject) {
    var payload = JSON.stringify({ id: config.appId, ipkUrl: ipkPath, subscribe: true });
    var p = childProcess.spawn("luna-send", ["-i", "luna://com.webos.appInstallService/dev/install", payload],
      { stdio: ["ignore", "pipe", "pipe"] });
    var out = "", done = false;
    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { p.kill(); } catch (e) { /* already gone */ }
      if (err) reject(err); else resolve();
    }
    var timer = setTimeout(function () { finish(new Error("The install did not finish within two minutes.")); }, 120000);
    function onData(d) {
      out += d;
      if (/"installed"/.test(out)) finish(null);
      else if (/"returnValue"\s*:\s*false|fail/i.test(out)) finish(new Error("The TV refused to install the update."));
    }
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("error", function () { finish(new Error("luna-send is not available.")); });
    p.on("exit", function () { setTimeout(function () { finish(new Error("The install stopped without finishing.")); }, 200); });
  });
}

// The id of the app on screen, or null when unknown (off the TV).
function foregroundApp() {
  return luna("luna://com.webos.service.applicationmanager/getForegroundAppInfo", {}).then(function (r) {
    return r && typeof r.appId === "string" ? r.appId : null;
  });
}

function relaunchApp() {
  return luna("luna://com.webos.service.applicationmanager/closeByAppId", { id: config.appId }).then(function () {
    return new Promise(function (r) { setTimeout(r, 2000); });
  }).then(function () {
    return luna("luna://com.webos.service.applicationmanager/launch", { id: config.appId });
  });
}

module.exports = {
  listApps: listApps, appIcon: appIcon, lanAddress: lanAddress, isPrivate: isPrivate, writeKiosk: writeKiosk, ensureKiosk: ensureKiosk,
  restartSystem: restartSystem, hasLuna: hasLuna, installIpk: installIpk, foregroundApp: foregroundApp, relaunchApp: relaunchApp
};
