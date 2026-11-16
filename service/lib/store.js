"use strict";
// JSON files in the data directory. Every write goes to a temp file (mode 600) that is then
// renamed over the old one, so a power cut never leaves a half-written settings or secrets file.
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");

function file(name) { return path.join(config.DATA, name); }

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch (e) { return fallback; }
}

function writeText(name, text) {
  var target = file(name);
  var tmp = target + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  var fd = fs.openSync(tmp, "w", 384);                  // 384 = 0o600
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.chmodSync(tmp, 384);                              // in case umask or an old file interfered
    fs.renameSync(tmp, target);
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e2) { /* already closed */ } }
    try { fs.unlinkSync(tmp); } catch (e3) { /* nothing to clean */ }
    throw e;
  }
}

function writeJson(name, obj) { writeText(name, JSON.stringify(obj, null, 2) + "\n"); }

module.exports = { file: file, readJson: readJson, writeJson: writeJson, writeText: writeText };
