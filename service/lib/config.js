"use strict";
// Where things live. On the TV the service runs from <package root>/server/; in the repository
// it runs from <repo>/service/. Both have project.json one level up, so the same lookup works.
var fs = require("fs");
var path = require("path");
var log = require("./util").log;

var ROOT = path.join(__dirname, "..", "..");      // lib -> server (or service) -> package root
var APPDIR = ROOT;                                // the installed app's directory on the TV

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

var project = readJson(path.join(ROOT, "project.json")) || {};
// In a package appinfo.json sits at the root; in the repository it is app/appinfo.json.
var appinfo = readJson(path.join(ROOT, "appinfo.json")) || readJson(path.join(ROOT, "app", "appinfo.json")) || {};

var envPort = parseInt(process.env.TELEDASH_PORT, 10);
var port = envPort > 0 && envPort < 65536 ? envPort : (parseInt(project.port, 10) || 8770);

// The data directory holds settings and secrets, so it is created private (700). If the TV path
// cannot be created (a developer Mac has no /home/root), fall back to <package root>/.data, which
// .gitignore keeps out of the repository.
function dataDir() {
  var wanted = process.env.TELEDASH_DATA || "/home/root/teledash";
  var tries = process.env.TELEDASH_DATA ? [wanted] : [wanted, path.join(ROOT, ".data")];
  for (var i = 0; i < tries.length; i++) {
    try {
      // Not { recursive: true }: that needs Node 10.12. The parent always exists (start.sh and
      // install.sh run mkdir -p first; the fallback's parent is the package root).
      try { fs.mkdirSync(tries[i], 448); } catch (e) { if (e.code !== "EEXIST") throw e; }   // 448 = 0o700
      fs.chmodSync(tries[i], 448);
      if (i > 0) log("data dir " + wanted + " is not usable here; using " + tries[i]);
      return tries[i];
    } catch (e) { /* try the next one */ }
  }
  throw new Error("cannot create the data directory " + wanted);
}

module.exports = {
  ROOT: ROOT,
  APPDIR: APPDIR,
  appId: project.appId || "com.teledashpro.dashboard",
  name: project.name || "TeleDash Pro",
  port: port,
  pagesBase: String(project.pagesBase || "").replace(/\/+$/, ""),
  version: String(appinfo.version || "0.0.0"),
  DATA: dataDir()
};
