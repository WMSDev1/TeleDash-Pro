"use strict";
// Pairing codes (shown as a QR code on the TV) and the phone sessions they open.
// Only hashes are kept: the pairing code in memory, session tokens in sessions.json (mode 600).
// Sessions are on disk so a service restart (for example after a Home-button change) does not
// throw the phone out of setup halfway through.
var util = require("./util");
var store = require("./store");

var CODE_MS = 10 * 60 * 1000;
var SESSION_MS = 12 * 60 * 60 * 1000;
var MAX_SESSIONS = 20;
var FILE = "sessions.json";

var pairing = null;                          // { hash, expires } of the one valid code

function hashHex(s) { return util.sha256(s).toString("hex"); }

// A new one-time code; the previous one stops working.
function newCode() {
  var code = util.randomToken(9);            // 12 URL-safe characters, 72 random bits
  pairing = { hash: hashHex(code), expires: Date.now() + CODE_MS };
  return { code: code, expires: pairing.expires };
}

// True once for a valid, unexpired code; the code is used up either way it matched.
function consumeCode(code) {
  if (!pairing || typeof code !== "string" || code.length > 64) return false;
  var match = util.safeEqual(hashHex(code), pairing.hash);
  if (!match) return false;
  var fresh = Date.now() < pairing.expires;
  pairing = null;
  return fresh;
}

function loadSessions() {
  var s = store.readJson(FILE, null);
  var now = Date.now(), out = {};
  if (util.isObject(s)) Object.keys(s).forEach(function (h) { if (typeof s[h] === "number" && s[h] > now) out[h] = s[h]; });
  return out;
}

function newSession() {
  var token = util.randomToken(24);
  var all = loadSessions();
  all[hashHex(token)] = Date.now() + SESSION_MS;
  var keys = Object.keys(all).sort(function (a, b) { return all[b] - all[a]; });
  keys.slice(MAX_SESSIONS).forEach(function (k) { delete all[k]; });   // keep the newest
  store.writeJson(FILE, all);
  return { token: token, maxAge: SESSION_MS / 1000 };
}

// Looked up by the token's SHA-256, so timing reveals nothing about stored tokens.
function validSession(token) {
  if (typeof token !== "string" || token.length < 16 || token.length > 128) return false;
  var all = loadSessions();
  var exp = all[hashHex(token)];
  return typeof exp === "number" && exp > Date.now();
}

function cookie(req, name) {
  var header = req.headers.cookie || "";
  var parts = header.split(";");
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim(), eq = p.indexOf("=");
    if (eq > 0 && p.slice(0, eq) === name) return p.slice(eq + 1);
  }
  return null;
}

module.exports = {
  newCode: newCode, consumeCode: consumeCode, newSession: newSession, validSession: validSession,
  cookie: cookie, CODE_MS: CODE_MS
};
