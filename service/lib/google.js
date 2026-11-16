"use strict";
// Google Calendar sign-in (web-application client + PKCE; CONTRACT.md "Google sign-in") and reads.
// The user brings their own OAuth client; Google sends the phone back through the project's
// GitHub Pages site (<pagesBase>/oauth/), which forwards to this service's /oauth/return.
var util = require("./util");
var http = require("./http");
var secrets = require("./secrets");
var settings = require("./settings");

var AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
var TOKEN = "https://oauth2.googleapis.com/token";
var API = "https://www.googleapis.com/calendar/v3";
var SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
var STATE_MS = 10 * 60 * 1000;

var pending = new Map();                       // nonce -> { verifier, expires }

function redirectUri(pagesBase) { return pagesBase.replace(/\/+$/, "") + "/oauth/"; }

function prune() {
  var now = Date.now();
  pending.forEach(function (v, k) { if (v.expires <= now) pending.delete(k); });
  while (pending.size > 5) pending.delete(pending.keys().next().value);   // oldest first
}

// origin: "http://<lan-ip>:<port>" — where the Pages site should send the phone back to.
function start(origin, pagesBase) {
  if (!pagesBase) throw util.httpError(400, "Google sign-in is not available in this build of TeleDash Pro (it has no sign-in web page). Use an iCal link, or install a release build.");
  if (!origin) throw util.httpError(500, "The TV has no network address to return to. Check its network connection.");
  var g = secrets.load().google || {};
  if (!g.clientId || !g.clientSecret) throw util.httpError(400, "Paste your Google client ID and client secret first, then sign in.");
  var nonce = util.randomToken(16);
  var verifier = util.randomToken(32);                           // 43 characters, as PKCE wants
  var challenge = util.b64url(util.sha256(verifier));
  pending.set(nonce, { verifier: verifier, expires: Date.now() + STATE_MS });
  prune();
  var state = util.b64url(Buffer.from(JSON.stringify({ t: origin, n: nonce })));
  var q = {
    client_id: g.clientId, redirect_uri: redirectUri(pagesBase), response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", state: state, code_challenge: challenge, code_challenge_method: "S256"
  };
  return { authUrl: AUTH + "?" + http.form(q), state: state };
}

// Completes sign-in from /oauth/return?code&state. The state's nonce is single use.
function finish(query, pagesBase) {
  var nonce = null;
  try { nonce = JSON.parse(util.fromB64url(query.state || "").toString("utf8")).n; } catch (e) { nonce = null; }
  var entry = typeof nonce === "string" ? pending.get(nonce) : null;
  if (typeof nonce === "string") pending.delete(nonce);
  if (!entry || entry.expires <= Date.now()) return Promise.reject(util.httpError(400, "This sign-in link has expired or was already used. Start again from the setup page."));
  if (query.error) return Promise.reject(util.httpError(400, query.error === "access_denied" ? "Google sign-in was cancelled." : "Google reported a problem with the sign-in."));
  if (!query.code) return Promise.reject(util.httpError(400, "Google did not send a sign-in code."));
  var g = secrets.load().google || {};
  if (!g.clientId || !g.clientSecret) return Promise.reject(util.httpError(400, "The Google client ID and secret were removed during sign-in."));
  return http.json({
    url: TOKEN, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: http.form({
      code: query.code, client_id: g.clientId, client_secret: g.clientSecret,
      redirect_uri: redirectUri(pagesBase), grant_type: "authorization_code", code_verifier: entry.verifier
    })
  }).catch(function (e) {
    throw util.httpError(502, e.data && e.data.error === "invalid_client"
      ? "Google did not accept the client ID or secret. Check them and try again."
      : "Google did not complete the sign-in. " + e.message);
  }).then(function (t) {
    if (!t.refresh_token) throw util.httpError(502, "Google did not grant lasting access. Remove TeleDash from your Google account's third-party access and sign in again.");
    secrets.saveGoogle({
      refreshToken: t.refresh_token, accessToken: t.access_token,
      expiry: Date.now() + (Number(t.expires_in) || 3600) * 1000
    });
    var cal = settings.load().calendar;
    settings.save({ calendar: { source: "google", calendars: cal.calendars && cal.calendars.length ? cal.calendars : ["primary"] } });
  });
}

// A current access token, refreshed when it is within a minute of expiring.
function accessToken() {
  var g = secrets.load().google || {};
  if (!g.refreshToken) return Promise.reject(util.httpError(409, "Google Calendar is not connected. Sign in on the setup page."));
  if (g.accessToken && g.expiry > Date.now() + 60000) return Promise.resolve(g.accessToken);
  return http.json({
    url: TOKEN, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: http.form({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: g.refreshToken, grant_type: "refresh_token" })
  }).then(function (t) {
    var fields = { accessToken: t.access_token, expiry: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
    if (t.refresh_token) fields.refreshToken = t.refresh_token;
    secrets.saveGoogle(fields);
    return t.access_token;
  }, function (e) {
    if (e.data && e.data.error === "invalid_grant") {
      // Revoked or expired for good: forget the tokens so the setup page shows "not connected".
      secrets.saveGoogle({ refreshToken: undefined, accessToken: undefined, expiry: undefined });
      throw util.httpError(401, "Google access has expired or was revoked. Sign in again on the setup page.");
    }
    throw e;
  });
}

function get(path) {
  return accessToken().then(function (token) {
    return http.json({ url: API + path, headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  });
}

function calendars() {
  return get("/users/me/calendarList?minAccessRole=reader&maxResults=250").then(function (r) {
    return (r.items || []).map(function (c) {
      return { id: c.id, summary: c.summaryOverride || c.summary || c.id, primary: !!c.primary };
    });
  });
}

// The window from local midnight today to local midnight `days` days later. tzOffset (minutes,
// as the app's Date#getTimezoneOffset gives it) overrides the service's own clock zone, which on
// a TV may not match the zone the TV shows.
function windowFor(days, tzOffset, now) {
  now = now || Date.now();
  if (typeof tzOffset === "number" && isFinite(tzOffset)) {
    var shifted = new Date(now - tzOffset * 60000);
    var start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + tzOffset * 60000;
    // +2 h: a fixed offset cannot see a daylight-saving change inside the window (a 25-hour day
    // would end at 23:00). The app sorts events into local days itself, so a little extra is harmless.
    return { min: new Date(start), max: new Date(start + days * 86400000 + 2 * 3600000) };
  }
  var d = new Date(now);
  return { min: new Date(d.getFullYear(), d.getMonth(), d.getDate()), max: new Date(d.getFullYear(), d.getMonth(), d.getDate() + days) };
}

function normalise(ev) {
  var s = ev.start || {}, e = ev.end || {};
  var allDay = !!s.date;
  return {
    summary: ev.summary || "(No title)",
    start: allDay ? String(s.date).slice(0, 10) : s.dateTime,
    end: allDay ? String(e.date || s.date).slice(0, 10) : (e.dateTime || s.dateTime),
    allDay: allDay
  };
}

function events(days, tzOffset) {
  var w = windowFor(days, tzOffset);
  var ids = settings.load().calendar.calendars;
  if (!ids || !ids.length) ids = ["primary"];
  var q = "?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=" + encodeURIComponent(w.min.toISOString()) +
    "&timeMax=" + encodeURIComponent(w.max.toISOString());
  // One failing calendar (for example one that was unshared) should not hide the others.
  var errors = [];
  return Promise.all(ids.map(function (id) {
    return get("/calendars/" + encodeURIComponent(id) + "/events" + q).then(function (r) { return r.items || []; },
      function (e) { errors.push(e); return []; });
  })).then(function (lists) {
    if (errors.length === ids.length) throw errors[0];
    var all = [];
    lists.forEach(function (l) { l.forEach(function (ev) { if (ev.status !== "cancelled") all.push(normalise(ev)); }); });
    all.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    return all;
  });
}

module.exports = {
  start: start, finish: finish, calendars: calendars, events: events, accessToken: accessToken,
  redirectUri: redirectUri, windowFor: windowFor, normalise: normalise, _pending: pending
};
