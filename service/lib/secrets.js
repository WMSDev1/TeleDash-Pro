"use strict";
// secrets.json (mode 600): the iCal link, Google keys and tokens, the Spotify client and tokens,
// and the feed token.
// Write-only from the setup page: nothing in here is ever returned to a client or logged.
var URL = require("url").URL;
var store = require("./store");
var util = require("./util");

var FILE = "secrets.json";
var NAMES = ["icalUrl", "google", "spotify", "feedToken"];

function load() {
  var s = store.readJson(FILE, null);
  return util.isObject(s) ? s : {};
}

function bad(msg) { throw util.httpError(400, msg); }

function cleanText(v, name, max) {
  if (typeof v !== "string") bad(name + " must be text.");
  v = v.trim();
  if (!v) bad(name + " cannot be empty.");
  if (v.length > max || /\s|[\u0000-\u001f\u007f]/.test(v)) bad(name + " does not look right (no spaces, at most " + max + " characters).");
  return v;
}

// A calendar's secret address. webcal:// is the same thing as https:// for our purposes. Plain
// http:// is refused because it would send the secret address over the network unencrypted.
function icalUrl(v) {
  v = cleanText(v, "The calendar link", 2000);
  if (/^webcals?:\/\//i.test(v)) v = "https://" + v.replace(/^webcals?:\/\//i, "");
  var u;
  try { u = new URL(v); } catch (e) { bad("The calendar link is not a web address."); }
  if (u.protocol !== "https:") bad("The calendar link must start with https:// or webcal://");
  return u.href;
}

// patch: { icalUrl?, google?: { clientId, clientSecret }, spotify?: { clientId }, feedToken? }
// feedOrigin: feed.originOf(the current feed address); a new feed token is tied to it.
function save(patch, feedOrigin) {
  if (!util.isObject(patch)) bad("Send the secrets as an object.");
  Object.keys(patch).forEach(function (k) {
    if (NAMES.indexOf(k) < 0) bad("Unknown secret: " + k);
  });
  var s = load();
  if (patch.icalUrl !== undefined) s.icalUrl = icalUrl(patch.icalUrl);
  if (patch.google !== undefined) {
    var g = patch.google;
    if (!util.isObject(g)) bad("Google needs a client ID and a client secret.");
    Object.keys(g).forEach(function (k) {
      if (k !== "clientId" && k !== "clientSecret") bad("Unknown Google setting: " + k);
    });
    var id = cleanText(g.clientId, "The Google client ID", 300);
    var secret = cleanText(g.clientSecret, "The Google client secret", 300);
    if (!/\.apps\.googleusercontent\.com$/.test(id)) bad("The Google client ID should end in .apps.googleusercontent.com");
    // New keys mean any earlier sign-in belongs to a different client: start over.
    s.google = { clientId: id, clientSecret: secret };
  }
  if (patch.spotify !== undefined) {
    var sp = patch.spotify;
    if (!util.isObject(sp)) bad("Spotify needs a client ID.");
    Object.keys(sp).forEach(function (k) {
      if (k !== "clientId") bad("Unknown Spotify setting: " + k);
    });
    // Sign-in uses PKCE, so there is no client secret to keep: the ID alone identifies the
    // owner's Spotify developer app.
    var sid = cleanText(sp.clientId, "The Spotify client ID", 64).toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(sid)) bad("The Spotify client ID is 32 letters and digits (0-9, a-f). Copy it from your app's page on developer.spotify.com.");
    // A different client means the earlier sign-in belongs to another app: start over.
    if (!s.spotify || s.spotify.clientId !== sid) s.spotify = { clientId: sid };
  }
  if (patch.feedToken !== undefined) {
    s.feedToken = cleanText(patch.feedToken, "The feed token", 500);
    if (feedOrigin) s.feedTokenOrigin = feedOrigin; else delete s.feedTokenOrigin;
  }
  store.writeJson(FILE, s);
}

// The feed address changed (origin: its new feed.originOf). A token saved before any address was
// set is tied to the first one; a token tied to a different site is deleted, so a changed address
// can never carry it elsewhere. Returns true when the token was deleted.
function feedUrlChanged(origin) {
  var s = load();
  if (!s.feedToken || s.feedTokenOrigin === origin || (!s.feedTokenOrigin && !origin)) return false;
  var dropped = !!s.feedTokenOrigin;
  if (dropped) { delete s.feedToken; delete s.feedTokenOrigin; } else s.feedTokenOrigin = origin;
  store.writeJson(FILE, s);
  return dropped;
}

// Merges token fields into one sign-in's entry (used by the sign-in code, never by a client).
// A field set to undefined is removed.
function mergeInto(name, fields) {
  var s = load();
  s[name] = Object.assign({}, s[name] || {}, fields);
  Object.keys(s[name]).forEach(function (k) { if (s[name][k] === undefined) delete s[name][k]; });
  store.writeJson(FILE, s);
}
function saveGoogle(fields) { mergeInto("google", fields); }
function saveSpotify(fields) { mergeInto("spotify", fields); }

function remove(name) {
  if (NAMES.indexOf(name) < 0) throw util.httpError(404, "There is no secret called " + name + ".");
  var s = load();
  delete s[name];
  if (name === "feedToken") delete s.feedTokenOrigin;
  store.writeJson(FILE, s);
}

// What is stored, as booleans only.
function stored() {
  var s = load(), g = s.google || {}, sp = s.spotify || {};
  return {
    icalUrl: !!s.icalUrl,
    googleClient: !!(g.clientId && g.clientSecret),
    googleSignedIn: !!g.refreshToken,
    spotifyClient: !!sp.clientId,
    spotifySignedIn: !!sp.refreshToken,
    feedToken: !!s.feedToken
  };
}

module.exports = {
  load: load, save: save, feedUrlChanged: feedUrlChanged, saveGoogle: saveGoogle, saveSpotify: saveSpotify,
  remove: remove, stored: stored
};
