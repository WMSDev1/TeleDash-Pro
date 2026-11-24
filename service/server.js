"use strict";
// TeleDash Pro helper service (runs as root on the TV; CONTRACT.md "Service HTTP API").
// Two audiences on one port:
//   /api/local/*  the dashboard app on the TV itself (loopback connections only)
//   everything else  the setup page on a phone, after pairing with the code shown on the TV
// Zero dependencies, Node 12-compatible CommonJS.
var http = require("http");
var fs = require("fs");
var path = require("path");
var URL = require("url").URL;               // a global only from Node 10

var config = require("./lib/config");
var util = require("./lib/util");
var store = require("./lib/store");
var settings = require("./lib/settings");
var secrets = require("./lib/secrets");
var session = require("./lib/session");
var google = require("./lib/google");
var spotify = require("./lib/spotify");
var feed = require("./lib/feed");
var tv = require("./lib/tv");
var updates = require("./lib/updates");
var client = require("./lib/http");

var WWW = path.join(__dirname, "www");
var LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
var CACHE_MS = 5 * 60 * 1000;
var log = util.log;
var lastGoogleError = null;
var lastSpotifyError = null;

// ---------- responses ----------

function send(res, status, body, type, headers) {
  var h = Object.assign({
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  }, headers || {});
  res.writeHead(status, h);
  res.end(body);
}

function json(res, status, obj, headers) { send(res, status, JSON.stringify(obj), "application/json; charset=utf-8", headers); }

function redirect(res, location, headers) {
  res.writeHead(302, Object.assign({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }, headers || {}));
  res.end();
}

var PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self' https://geocoding-api.open-meteo.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function page(res, status, title, message) {
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  send(res, status, "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<title>" + esc(title) + "</title><link rel=\"stylesheet\" href=\"/setup.css\"></head><body><main class=\"notice\"><h1>" + esc(title) +
    "</h1><p>" + esc(message) + "</p></main></body></html>", "text/html; charset=utf-8", { "Content-Security-Policy": PAGE_CSP, "X-Frame-Options": "DENY" });
}

function expiredPage(res, status) {
  page(res, status || 403, "TeleDash Pro setup", "This code has expired — press OK on the TV for a new one");
}

function fail(res, e, headers) {
  var status = e && e.status ? e.status : 500;
  var message = e && e.expose ? e.message : "Something went wrong on the TV. Try again in a moment.";
  if (!e || !e.expose) log("error: " + (e && e.stack ? e.stack : e));
  json(res, status, { error: message }, headers);
}

// ---------- requests ----------

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > limit) { reject(util.httpError(413, "That request is too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function readJsonBody(req) {
  return readBody(req, 64 * 1024).then(function (text) {
    if (!text.trim()) return {};
    try { return JSON.parse(text); } catch (e) { throw util.httpError(400, "The request was not valid JSON."); }
  });
}

function isLoopback(req) { return LOOPBACK.indexOf(req.socket.remoteAddress) >= 0; }

// DNS rebinding: a web page can point a host name of its own at this TV and then talk to this
// server as its "own" site. Real clients always use an IP address (the QR code, the app's
// 127.0.0.1) or localhost, so any other Host is refused. Browsers always send Host.
function hostAllowed(req) {
  var h = req.headers.host;
  if (!h) return true;
  var name = String(h).toLowerCase().replace(/:\d+$/, "");
  return name === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || /^\[[0-9a-f:.]+\]$/.test(name);
}

// The per-install key the dashboard sends as X-TeleDash-Local. Loopback alone does not prove the
// caller is the dashboard: web pages in the TV's browser and other apps also connect from
// 127.0.0.1. The app reads $DATA/local.token as root through Homebrew Channel; nothing else on the
// TV can (the data dir is 700). Kept across restarts so a running app keeps working.
var localKey = null;
function localToken() {
  if (localKey) return localKey;
  var t = "";
  try { t = fs.readFileSync(store.file("local.token"), "utf8").trim(); } catch (e) { /* first start */ }
  if (!/^[A-Za-z0-9_-]{32,}$/.test(t)) { t = util.randomToken(24); store.writeText("local.token", t + "\n"); }
  localKey = t;
  return t;
}

function origin() {
  var ip = tv.lanAddress();
  return ip ? "http://" + ip + ":" + config.port : null;
}

// ---------- shared state views ----------

function connected(s) {
  var st = secrets.stored();
  return { ical: st.icalUrl, google: st.googleSignedIn, spotify: st.spotifySignedIn, feed: !!(s.feed.enabled && s.feed.url) };
}

// Short-lived caches for upstream reads; any settings or secrets change empties them.
var cache = {};
function invalidate() { cache = {}; }
function cached(key, fn) {
  var c = cache[key], now = Date.now();
  if (c && now - c.at < CACHE_MS) return c.promise;
  Object.keys(cache).forEach(function (k) { if (now - cache[k].at >= CACHE_MS) delete cache[k]; });   // never grows
  var p = fn();
  var entry = { at: Date.now(), promise: p };
  cache[key] = entry;
  p.catch(function () { if (cache[key] === entry) delete cache[key]; });   // retry failures next time
  return p;
}

function icalText(url) {
  return client.request({ url: url, timeout: 20000, maxBytes: 5 * 1024 * 1024 }).then(function (r) {
    if (r.status < 200 || r.status > 299) throw util.httpError(502, "Calendar link: " + client.describeStatus(r.status, url));
    var text = r.body.toString("utf8");
    if (text.indexOf("BEGIN:VCALENDAR") < 0) throw util.httpError(502, "The calendar link did not return a calendar. Check that it is the secret iCal address.");
    return text;
  });
}

function calendar(query) {
  var s = settings.load();
  var days = Math.max(1, Math.min(14, parseInt(query.get("days"), 10) || 2));
  var tz = query.get("tz") === null ? NaN : parseInt(query.get("tz"), 10);
  // Real offsets are within -14 h..+12 h; anything else is refused (it would only fill the cache).
  if (!isNaN(tz) && (tz < -840 || tz > 840)) return Promise.reject(util.httpError(400, "tz must be minutes between -840 and 840."));
  var source = s.calendar.source;
  if (source === "ical") {
    var url = secrets.load().icalUrl;
    if (!url) return Promise.resolve({ source: "none" });
    return cached("ical", function () { return icalText(url); }).then(function (ics) { return { source: "ical", ics: ics }; });
  }
  if (source === "google") {
    return cached("google:" + days + ":" + tz, function () { return google.events(days, isNaN(tz) ? undefined : tz); })
      .then(function (events) { return { source: "google", events: events }; });
  }
  return Promise.resolve({ source: "none" });
}

function usageLog() {
  var file = store.file("usage.log");
  var fd;
  try { fd = fs.openSync(file, "r"); } catch (e) { return ""; }
  try {
    var size = fs.fstatSync(fd).size;
    var len = Math.min(size, 1024 * 1024);                  // 6000 lines are far below 1 MB
    var buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    var lines = buf.toString("utf8").split("\n");
    if (len < size) lines.shift();                          // first line may be cut in half
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-6000).join("\n") + (lines.length ? "\n" : "");
  } finally { fs.closeSync(fd); }
}

// ---------- local endpoints (the TV's own dashboard app) ----------

var CORS = { "Access-Control-Allow-Origin": "*" };

function local(req, res, route, query) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, Object.assign({ "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, X-TeleDash-Local", "Access-Control-Max-Age": "600" }, CORS));
    return res.end();
  }
  if (!isLoopback(req)) return json(res, 403, { error: "Only the TV itself can use this." }, CORS);
  if (!util.safeEqual(String(req.headers["x-teledash-local"] || ""), localToken())) return json(res, 403, { error: "Only the TeleDash Pro app can use this." }, CORS);
  var key = req.method + " " + route;

  if (key === "GET /api/local/state") {
    var s = settings.load();
    var u = updates.status();
    return json(res, 200, {
      version: config.version, settings: s, connected: connected(s),
      update: { current: u.current, latest: u.latest, available: u.available, auto: u.auto }
    }, CORS);
  }
  if (key === "POST /api/local/pair") {
    var ip = tv.lanAddress();
    if (!ip) return json(res, 503, { error: "The TV is not connected to a network." }, CORS);
    var c = session.newCode();
    return json(res, 200, { url: "http://" + ip + ":" + config.port + "/s/" + c.code, code: c.code, expires: c.expires }, CORS);
  }
  if (key === "GET /api/local/calendar") {
    return calendar(query).then(function (r) { json(res, 200, r, CORS); }, function (e) { fail(res, e, CORS); });
  }
  if (key === "GET /api/local/feed") {
    var f = settings.load().feed, sec = secrets.load();
    return cached("feed", function () { return feed.fetchFeed(f, sec.feedToken, sec.feedTokenOrigin); })
      .then(function (r) { json(res, 200, r, CORS); }, function (e) { fail(res, e, CORS); });
  }
  if (key === "POST /api/local/night") {
    return readJsonBody(req).then(function (b) {
      if (!util.isObject(b) || typeof b.on !== "boolean") throw util.httpError(400, "Send {\"on\": true} or {\"on\": false}.");
      return tv.nightPicture(b.on);
    }).then(function (r) { json(res, 200, r, CORS); }, function (e) { fail(res, e, CORS); });
  }
  // Spotify (CONTRACT.md "Spotify"). Called through the module object so tests can stand in for it.
  if (key === "GET /api/local/music") {
    return Promise.resolve().then(function () { return spotify.state(); })
      .then(function (r) { json(res, 200, r, CORS); }, function (e) { fail(res, e, CORS); });
  }
  if (key === "POST /api/local/music") {
    return readJsonBody(req).then(function (b) {
      if (!util.isObject(b)) throw util.httpError(400, "Send a command such as {\"do\": \"pause\"}.");
      return spotify.command(b);
    }).then(function (r) { json(res, 200, r, CORS); }, function (e) { fail(res, e, CORS); });
  }
  if (key === "GET /api/local/music/list") {
    return Promise.resolve().then(function () {
      var kind = query.get("kind");
      if (!kind) throw util.httpError(400, "Say which list: kind=playlists, albums, liked, recent, playlist, album, queue, devices or search.");
      var opts = { id: undefined, offset: undefined, q: undefined };
      var off = query.get("offset");
      if (off !== null) {
        if (!/^\d{1,6}$/.test(off) || parseInt(off, 10) > 100000) throw util.httpError(400, "offset must be a whole number from 0 to 100000.");
        opts.offset = parseInt(off, 10);
      }
      if (query.get("id") !== null) opts.id = query.get("id");
      if (query.get("q") !== null) opts.q = query.get("q");
      return spotify.list(kind, opts);
    }).then(function (r) { json(res, 200, r, CORS); }, function (e) { fail(res, e, CORS); });
  }
  if (key === "GET /api/local/usage") return send(res, 200, usageLog(), "text/plain; charset=utf-8", CORS);
  if (key === "POST /api/local/update") {
    return updates.startUpdate().then(function (r) { json(res, 200, r, CORS); }, function (e) { fail(res, e, CORS); });
  }
  return json(res, 404, { error: "Not found." }, CORS);
}

// ---------- setup endpoints (a paired phone) ----------

function statusView() {
  var s = settings.load();
  return {
    version: config.version, connected: connected(s), stored: secrets.stored(), update: updates.status(),
    google: { available: !!config.pagesBase, builtIn: !!config.googleClient, redirectUri: config.pagesBase ? google.redirectUri(config.pagesBase) : null, lastError: lastGoogleError },
    spotify: { available: !!config.pagesBase, redirectUri: config.pagesBase ? spotify.redirectUri(config.pagesBase) : null, lastError: lastSpotifyError }
  };
}

function afterSettingsSaved(result) {
  invalidate();
  // A feed token only ever goes to the site it was saved for (see secrets.feedUrlChanged).
  if (result.before.feed.url !== result.settings.feed.url && secrets.feedUrlChanged(feed.originOf(result.settings.feed.url))) {
    log("feed address moved to another site: the saved feed token was removed");
  }
  if (JSON.stringify(result.before.home) !== JSON.stringify(result.settings.home)) {
    tv.writeKiosk(result.settings.home);
    tv.restartSystem();
  }
}

function setup(req, res, route) {
  var m = req.method;
  var token = session.cookie(req, "td_session");
  if (!session.validSession(token)) return json(res, 401, { error: "Your setup session has ended. Press OK on the TV for a new code." });
  var changing = m !== "GET" && m !== "HEAD";
  // A custom header cannot be added by a cross-site form post or image load, so requiring it
  // blocks other web pages from changing settings through the phone's session cookie.
  if (changing && req.headers["x-teledash"] !== "1") return json(res, 403, { error: "This request is missing the X-TeleDash header." });

  var key = m + " " + route;
  if (key === "GET /api/settings") return json(res, 200, settings.load());
  if (key === "GET /api/status") return json(res, 200, statusView());
  if (key === "GET /api/apps") return tv.listApps().then(function (a) {
    json(res, 200, a.map(function (x) { return { id: x.id, title: x.title }; }));
  }, function (e) { fail(res, e); });
  if (key === "GET /api/google/calendars") return google.calendars().then(function (c) { json(res, 200, c); }, function (e) { fail(res, e); });

  if (key === "PUT /api/settings") {
    return readJsonBody(req).then(function (patch) {
      var r = settings.save(patch);
      afterSettingsSaved(r);
      json(res, 200, r.settings);
    }).catch(function (e) { fail(res, e); });
  }
  if (key === "POST /api/secrets") {
    return readJsonBody(req).then(function (patch) {
      secrets.save(patch, feed.originOf(settings.load().feed.url));
      if (patch.google) lastGoogleError = null;
      if (patch.spotify) lastSpotifyError = null;
      invalidate();
      json(res, 200, { ok: true });
    }).catch(function (e) { fail(res, e); });
  }
  var del = /^\/api\/secrets\/([A-Za-z]+)$/.exec(route);
  if (m === "DELETE" && del) {
    try {
      secrets.remove(del[1]);
      // A calendar source without its secret would only show errors: switch it off.
      var src = settings.load().calendar.source;
      if ((del[1] === "icalUrl" && src === "ical") || (del[1] === "google" && src === "google")) {
        afterSettingsSaved(settings.save({ calendar: { source: "none" } }));
      }
      // Without its sign-in the Music tile could only show an error: hide it.
      if (del[1] === "spotify") afterSettingsSaved(settings.save({ music: { tile: false } }));
      invalidate();
      return json(res, 200, { ok: true });
    } catch (e) { return fail(res, e); }
  }
  if (key === "POST /api/google/start") {
    try {
      var r = google.start(origin(), config.pagesBase);
      return json(res, 200, { authUrl: r.authUrl });
    } catch (e) { return fail(res, e); }
  }
  if (key === "POST /api/spotify/start") {
    try {
      var sr = spotify.start(origin(), config.pagesBase);
      return json(res, 200, { authUrl: sr.authUrl });
    } catch (e) { return fail(res, e); }
  }
  // Not in the contract's table: the phone cannot reach /api/local/update, so "Update now" on
  // the setup page uses this session-protected twin.
  if (key === "POST /api/update") {
    return updates.startUpdate().then(function (r) { json(res, 200, r); }, function (e) { fail(res, e); });
  }
  return json(res, 404, { error: "Not found." });
}

// ---------- static files ----------

var STATIC = {
  "/setup.js": ["setup.js", "text/javascript; charset=utf-8"],
  "/setup.css": ["setup.css", "text/css; charset=utf-8"]
};

function serveFile(res, name, type, headers) {
  fs.readFile(path.join(WWW, name), function (err, data) {
    if (err) return json(res, 404, { error: "Not found." });
    send(res, 200, data, type, headers);
  });
}

// ---------- router ----------

// App icons for the dashboard's tiles. The web app cannot read other apps' folders itself, so
// the helper (root) serves them, to the TV only. No key is needed: an <img> cannot send headers,
// and an app's logo reveals nothing a web page on the TV could not already guess.
function icon(req, res, route) {
  if (req.method !== "GET" || !isLoopback(req)) return json(res, 403, { error: "Only the TV itself can use this." });
  var id;
  try { id = decodeURIComponent(route.slice(7)); } catch (e) { id = ""; }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) return json(res, 404, { error: "No such app." });
  tv.appIcon(id).then(function (file) {
    if (!file) return json(res, 404, { error: "That app has no icon." });
    fs.readFile(file, function (err, data) {
      if (err) return json(res, 404, { error: "That app has no icon." });
      send(res, 200, data, /\.png$/i.test(file) ? "image/png" : "image/jpeg",
        { "Cache-Control": "max-age=86400", "Access-Control-Allow-Origin": "*" });
    });
  }, function () { json(res, 404, { error: "That app has no icon." }); });
}

function handle(req, res) {
  var u;
  try { u = new URL(req.url, "http://localhost"); } catch (e) { return json(res, 400, { error: "Bad request." }); }
  var route = u.pathname;
  if (!hostAllowed(req)) return json(res, 403, { error: "Use the TV's address (as in the QR code), not a host name." });

  if (route.indexOf("/api/local/") === 0) return local(req, res, route, u.searchParams);
  if (route.indexOf("/icons/") === 0) return icon(req, res, route);

  if (req.method === "GET") {
    var pair = /^\/s\/([A-Za-z0-9_-]{1,64})$/.exec(route);
    if (pair) {
      if (!session.consumeCode(pair[1])) return expiredPage(res, 403);
      var s = session.newSession();
      return redirect(res, "/setup", { "Set-Cookie": "td_session=" + s.token + "; Max-Age=" + s.maxAge + "; Path=/; HttpOnly; SameSite=Lax" });
    }
    if (route.indexOf("/s/") === 0) return expiredPage(res, 403);
    if (route === "/" ) return redirect(res, "/setup");
    if (route === "/setup") {
      if (!session.validSession(session.cookie(req, "td_session"))) return expiredPage(res, 401);
      return serveFile(res, "setup.html", "text/html; charset=utf-8", { "Content-Security-Policy": PAGE_CSP, "X-Frame-Options": "DENY" });
    }
    if (STATIC[route]) return serveFile(res, STATIC[route][0], STATIC[route][1]);
    if (route === "/oauth/return") {
      var q = { code: u.searchParams.get("code"), state: u.searchParams.get("state"), error: u.searchParams.get("error") };
      // Both sign-ins come back through the same Pages relay; the state's nonce says whose it is.
      if (spotify.owns(q.state)) {
        return Promise.resolve().then(function () { return spotify.finish(q, config.pagesBase); }).then(function () {
          lastSpotifyError = null;
          invalidate();
          redirect(res, "/setup?spotify=ok");
        }, function (e) {
          lastSpotifyError = e && e.expose ? e.message : "Spotify sign-in did not complete.";
          if (!e || !e.expose) log("spotify sign-in: " + (e && e.message));
          redirect(res, "/setup?spotify=error");
        });
      }
      return google.finish(q, config.pagesBase).then(function () {
        lastGoogleError = null;
        invalidate();
        redirect(res, "/setup?google=ok");
      }, function (e) {
        lastGoogleError = e.expose ? e.message : "Google sign-in did not complete.";
        if (!e.expose) log("google sign-in: " + e.message);
        redirect(res, "/setup?google=error");
      });
    }
    if (route === "/favicon.ico") { res.writeHead(204); return res.end(); }
  }
  if (route.indexOf("/api/") === 0) return setup(req, res, route);
  return json(res, 404, { error: "Not found." });
}

// ---------- start ----------

function main() {
  tv.ensureKiosk(settings.load().home);
  localToken();                                           // the app reads it from $DATA at launch
  var server = http.createServer(function (req, res) {
    try { handle(req, res); } catch (e) { fail(res, e); }
  });
  server.headersTimeout = 20000;
  server.on("error", function (e) {
    log(e.code === "EADDRINUSE" ? "port " + config.port + " is already in use; is another copy running?" : "server error: " + e.message);
    process.exit(1);
  });
  server.listen(config.port, function () {
    log(config.name + " helper " + config.version + " listening on port " + config.port + " (data: " + config.DATA + ")");
  });
  updates.schedule();
  process.on("unhandledRejection", function (e) { log("unhandled: " + (e && e.message)); });
}

if (require.main === module) main();

module.exports = { handle: handle, main: main };
