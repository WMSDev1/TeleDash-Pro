"use strict";
// Small shared helpers. Node 12 has no "base64url" Buffer encoding, so it is done by hand.
var crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function randomToken(bytes) { return b64url(crypto.randomBytes(bytes)); }

function sha256(x) { return crypto.createHash("sha256").update(x).digest(); }

// Constant-time comparison of two secrets of any length: compare their hashes, which are
// always 32 bytes, so neither the content nor the length leaks through timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

// An Error carrying an HTTP status and a message that is safe to show to the user.
function httpError(status, message) {
  var e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function log() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(new Date().toISOString());
  console.log.apply(console, args);
}

module.exports = {
  b64url: b64url, fromB64url: fromB64url, randomToken: randomToken, sha256: sha256,
  safeEqual: safeEqual, httpError: httpError, isObject: isObject, log: log
};
