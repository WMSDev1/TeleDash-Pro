"use strict";
// End-to-end checks against a real server process on this machine. The service is copied into a
// temporary package (project.json with a placeholder pagesBase, a stub system/start.sh), started
// on a free port with a private data dir, and driven over HTTP. Nothing outside this machine is
// contacted; the "LAN" requests go to this machine's own network address.
var t = require("./harness");
var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var http = require("http");
var net = require("net");
var path = require("path");
var util = require("../lib/util");
var tv = require("../lib/tv");

var PKG = path.join(t.dir, "pkg");
var DATA = process.env.TELEDASH_DATA;
var LAN = tv.lanAddress();
var port, proc, cookie;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(function (f) {
    var a = path.join(from, f), b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  });
}

function freePort() {
  return new Promise(function (resolve) {
    var s = net.createServer().listen(0, "127.0.0.1", function () { var p = s.address().port; s.close(function () { resolve(p); }); });
  });
}

// The dashboard's key for /api/local (the server writes it at start).
function localKey() { return fs.readFileSync(path.join(DATA, "local.token"), "utf8").trim(); }

// -> { status, headers, text, json }. /api/local calls carry the key unless opts.noKey.
function req(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var headers = Object.assign({}, opts.headers || {});
    if (p.indexOf("/api/local/") === 0 && !opts.noKey && method !== "OPTIONS") headers["X-TeleDash-Local"] = localKey();
    if (opts.cookie) headers.Cookie = "td_session=" + opts.cookie;
    if (opts.write) headers["X-TeleDash"] = "1";
    var body = opts.body === undefined ? null : JSON.stringify(opts.body);
    if (body) headers["Content-Type"] = "application/json";
    var r = http.request({ host: opts.host || "127.0.0.1", port: port, path: p, method: method, headers: headers }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8"), json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text: text, json: json });
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function pair() {
  return req("POST", "/api/local/pair").then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    return r.json;
  });
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

t.test("start the server from a temporary package", function () {
  copyDir(path.join(__dirname, ".."), path.join(PKG, "server"));
  fs.writeFileSync(path.join(PKG, "project.json"), JSON.stringify({ name: "TeleDash Pro", appId: "com.teledashpro.dashboard", port: 8770, pagesBase: "https://example.github.io/teledash-pro" }));
  fs.writeFileSync(path.join(PKG, "appinfo.json"), JSON.stringify({ id: "com.teledashpro.dashboard", version: "1.2.3" }));
  fs.mkdirSync(path.join(PKG, "system"));
  // Stub: records that the service asked for a restart (the real script restarts service + kiosk).
  fs.writeFileSync(path.join(PKG, "system", "start.sh"), 'echo "$1" > "$TELEDASH_DATA/restart-called"\n');
  return freePort().then(function (p) {
    port = p;
    proc = childProcess.spawn(process.execPath, [path.join(PKG, "server", "server.js")], {
      env: Object.assign({}, process.env, { TELEDASH_DATA: DATA, TELEDASH_PORT: String(port) }), stdio: ["ignore", "pipe", "pipe"]
    });
    proc.output = "";
    proc.stdout.on("data", function (d) { proc.output += d; });
    proc.stderr.on("data", function (d) { proc.output += d; });
    function ready(n) {
      return req("GET", "/favicon.ico").catch(function () { if (n <= 0) throw new Error("server did not start: " + proc.output); return wait(100).then(function () { return ready(n - 1); }); });
    }
    return ready(50);
  }).then(function () {
    assert.strictEqual(fs.readFileSync(path.join(DATA, "kiosk.conf"), "utf8"), "ENABLED=0\nDELAY=1\n");
    assert.strictEqual(fs.statSync(DATA).mode & 511, 448);
    assert.ok(/^[A-Za-z0-9_-]{32,}$/.test(localKey()));
    assert.strictEqual(fs.statSync(path.join(DATA, "local.token")).mode & 511, 384);
  });
});

t.test("local endpoints answer loopback with CORS", function () {
  return req("GET", "/api/local/state").then(function (r) {
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    assert.strictEqual(r.json.version, "1.2.3");
    assert.strictEqual(r.json.settings.rev, 0);
    assert.deepStrictEqual(r.json.connected, { ical: false, google: false, spotify: false, feed: false });
    assert.deepStrictEqual(r.json.update, { current: "1.2.3", latest: null, available: false, auto: false });
    return req("OPTIONS", "/api/local/pair");
  }).then(function (r) {
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    assert.ok(/X-TeleDash-Local/.test(r.headers["access-control-allow-headers"]));
    return req("GET", "/api/local/calendar?days=2");
  }).then(function (r) {
    assert.deepStrictEqual(r.json, { source: "none" });
    return req("GET", "/api/local/feed");
  }).then(function (r) {
    assert.strictEqual(r.status, 404);
    assert.ok(/No data feed/.test(r.json.error));
  });
});

t.test("night mode's picture endpoint", function () {
  return req("POST", "/api/local/night", { body: { on: "yes" } }).then(function (r) {
    assert.strictEqual(r.status, 400);
    return req("POST", "/api/local/night", { body: { on: false } });
  }).then(function (r) {
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { night: false, changed: false });    // nothing dimmed, nothing to undo
    return req("POST", "/api/local/night", { noKey: true, body: { on: true } });
  }).then(function (r) {
    assert.strictEqual(r.status, 403);
    assert.ok(!fs.existsSync(path.join(DATA, "picture-day.json")));
  });
});

t.test("local endpoints refuse loopback callers without the key (web pages, other apps)", function () {
  return req("GET", "/api/local/state", { noKey: true }).then(function (r) {
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    assert.ok(r.text.indexOf("settings") < 0);
    return req("POST", "/api/local/pair", { noKey: true, headers: { "X-TeleDash-Local": "wrong" } });
  }).then(function (r) {
    assert.strictEqual(r.status, 403);
    return req("GET", "/api/local/calendar?days=2&tz=99999");
  }).then(function (r) {
    assert.strictEqual(r.status, 400, "absurd tz refused");
  });
});

t.test("requests addressed to a host name are refused (DNS rebinding)", function () {
  var evil = { headers: { Host: "rebind.example:" + port } };
  return req("GET", "/api/local/state", evil).then(function (r) {
    assert.strictEqual(r.status, 403);
    return req("GET", "/setup", evil);
  }).then(function (r) {
    assert.strictEqual(r.status, 403);
    return req("GET", "/api/local/state", { headers: { Host: "localhost:" + port } });
  }).then(function (r) {
    assert.strictEqual(r.status, 200, "localhost is fine");
    return req("GET", "/api/local/state", { headers: { Host: "[::1]:" + port } });
  }).then(function (r) { assert.strictEqual(r.status, 200, "IPv6 literal is fine"); });
});

t.test("local endpoints refuse non-loopback connections (this Mac's own LAN address)", function () {
  if (!LAN) { console.log("     skip: no LAN IPv4 address on this machine"); return; }
  return req("GET", "/api/local/state", { host: LAN }).then(function (r) {
    assert.strictEqual(r.status, 403);
    assert.ok(/Only the TV itself/.test(r.json.error));
    return req("POST", "/api/local/pair", { host: LAN });
  }).then(function (r) { assert.strictEqual(r.status, 403); });
});

t.test("pairing: codes are single use and replace each other", function () {
  if (!LAN) { console.log("     skip: no LAN IPv4 address on this machine"); return; }
  var first;
  return req("GET", "/setup").then(function (r) {
    assert.strictEqual(r.status, 401);
    assert.ok(r.text.indexOf("This code has expired") >= 0);
    return pair();
  }).then(function (p) {
    first = p;
    assert.ok(/^[A-Za-z0-9_-]{8,}$/.test(p.code));
    assert.strictEqual(p.url, "http://" + LAN + ":" + port + "/s/" + p.code);
    assert.ok(p.expires > Date.now() + 9 * 60000 && p.expires <= Date.now() + 10 * 60000);
    return pair();
  }).then(function (second) {
    return req("GET", "/s/" + first.code).then(function (r) {
      assert.strictEqual(r.status, 403, "replaced code no longer works");
      assert.ok(r.text.indexOf("press OK on the TV for a new one") >= 0);
      return req("GET", "/s/" + second.code, { host: LAN });
    }).then(function (r) {
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.location, "/setup");
      var c = r.headers["set-cookie"][0];
      assert.ok(/HttpOnly/.test(c) && /SameSite=Lax/.test(c) && /Max-Age=43200/.test(c) && /Path=\//.test(c), c);
      cookie = /td_session=([^;]+)/.exec(c)[1];
      return req("GET", "/s/" + second.code, { host: LAN });
    }).then(function (r) {
      assert.strictEqual(r.status, 403, "single use");
      return req("GET", "/setup", { host: LAN, cookie: cookie });
    }).then(function (r) {
      assert.strictEqual(r.status, 200);
      assert.ok(/<title>TeleDash Pro setup<\/title>/.test(r.text));
      assert.ok(/default-src 'self'/.test(r.headers["content-security-policy"]));
    });
  });
});

t.test("setup API: session required, X-TeleDash required for writes", function () {
  if (!cookie) return;
  return req("GET", "/api/settings", { host: LAN }).then(function (r) {
    assert.strictEqual(r.status, 401);
    return req("GET", "/api/settings", { host: LAN, cookie: "not-a-real-session-token" });
  }).then(function (r) {
    assert.strictEqual(r.status, 401);
    return req("PUT", "/api/settings", { host: LAN, cookie: cookie, body: { columns: 5 } });
  }).then(function (r) {
    assert.strictEqual(r.status, 403, "missing X-TeleDash");
    return req("PUT", "/api/settings", { host: LAN, write: true, body: { columns: 5 } });
  }).then(function (r) {
    assert.strictEqual(r.status, 401, "missing session");
    assert.strictEqual(r.headers["access-control-allow-origin"], undefined, "no CORS outside /api/local");
  });
});

t.test("settings: validated, rounded, rev bumped", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie, write: true };
  return req("PUT", "/api/settings", Object.assign({ body: { columns: 5, mystery: true } }, o)).then(function (r) {
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, "Unknown setting: mystery");
    return req("PUT", "/api/settings", Object.assign({ body: "not an object" }, o));
  }).then(function (r) {
    assert.strictEqual(r.status, 400);
    return req("PUT", "/api/settings", Object.assign({ body: { weather: { latitude: 51.50735, longitude: -0.12776, label: "Example", fahrenheit: false } } }, o));
  }).then(function (r) {
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.json.weather.latitude, r.json.weather.longitude], [51.5, -0.1]);
    assert.strictEqual(r.json.rev, 1);
    return req("GET", "/api/local/state");
  }).then(function (r) { assert.strictEqual(r.json.settings.rev, 1); });
});

t.test("home settings write kiosk.conf and ask start.sh to restart", function () {
  if (!cookie) return;
  return req("PUT", "/api/settings", { host: LAN, cookie: cookie, write: true, body: { home: { opensDashboard: true, delaySeconds: 3 } } }).then(function (r) {
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(DATA, "kiosk.conf"), "utf8"), "ENABLED=1\nDELAY=3\n");
    assert.strictEqual(fs.statSync(path.join(DATA, "kiosk.conf")).mode & 511, 384);
    return wait(1500);
  }).then(function () {
    assert.strictEqual(fs.readFileSync(path.join(DATA, "restart-called"), "utf8").trim(), "restart");
  });
});

t.test("secrets are write-only and never echoed", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie, write: true };
  var SECRET = "example-secret-path-xyz", TOKEN = "tok_example_xyz";
  return req("POST", "/api/secrets", Object.assign({ body: { icalUrl: "webcal://calendar.example.com/" + SECRET + "/basic.ics", feedToken: TOKEN } }, o)).then(function (r) {
    assert.deepStrictEqual(r.json, { ok: true });
    assert.strictEqual(fs.statSync(path.join(DATA, "secrets.json")).mode & 511, 384);
    return Promise.all([req("GET", "/api/settings", o), req("GET", "/api/status", o), req("GET", "/api/local/state")]);
  }).then(function (rs) {
    rs.forEach(function (r) {
      assert.ok(r.text.indexOf(SECRET) < 0 && r.text.indexOf(TOKEN) < 0, "secret leaked in " + r.text.slice(0, 80));
    });
    assert.deepStrictEqual(rs[1].json.stored, { icalUrl: true, googleClient: false, googleSignedIn: false, spotifyClient: false, spotifySignedIn: false, feedToken: true });
    assert.strictEqual(rs[2].json.connected.ical, true);
    assert.ok(proc.output.indexOf(SECRET) < 0 && proc.output.indexOf(TOKEN) < 0, "secret in the log");
    return req("POST", "/api/secrets", Object.assign({ body: { icalUrl: "http://calendar.example.com/x.ics" } }, o));
  }).then(function (r) {
    assert.strictEqual(r.status, 400);
    assert.ok(r.text.indexOf("calendar.example.com/x.ics") < 0, "bad value not echoed either");
    return req("PUT", "/api/settings", Object.assign({ body: { calendar: { source: "ical" } } }, o));
  }).then(function () {
    return req("DELETE", "/api/secrets/icalUrl", o);
  }).then(function (r) {
    assert.deepStrictEqual(r.json, { ok: true });
    return Promise.all([req("GET", "/api/status", o), req("GET", "/api/settings", o)]);
  }).then(function (rs) {
    assert.strictEqual(rs[0].json.stored.icalUrl, false);
    assert.strictEqual(rs[1].json.calendar.source, "none", "source switched off with its secret");
    return req("DELETE", "/api/secrets/feedToken", o);
  }).then(function () { return req("DELETE", "/api/secrets/nothing", o); })
    .then(function (r) { assert.strictEqual(r.status, 404); });
});

t.test("moving the feed to another site deletes its token", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie, write: true };
  return req("PUT", "/api/settings", Object.assign({ body: { feed: { url: "github:example/feeds/f.json" } } }, o)).then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    return req("POST", "/api/secrets", Object.assign({ body: { feedToken: "tok_example_feed" } }, o));
  }).then(function () {
    return req("PUT", "/api/settings", Object.assign({ body: { feed: { url: "github:example/other/g.json" } } }, o));
  }).then(function () { return req("GET", "/api/status", o); }).then(function (r) {
    assert.strictEqual(r.json.stored.feedToken, true, "same site (api.github.com): kept");
    return req("PUT", "/api/settings", Object.assign({ body: { feed: { url: "https://feeds.example.com/f.json" } } }, o));
  }).then(function () { return req("GET", "/api/status", o); }).then(function (r) {
    assert.strictEqual(r.json.stored.feedToken, false, "other site: deleted");
    return req("PUT", "/api/settings", Object.assign({ body: { feed: { url: "" } } }, o));
  });
});

t.test("google start and return: state is single use (no Google call made)", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie, write: true };
  return req("POST", "/api/google/start", o).then(function (r) {
    assert.strictEqual(r.status, 400);
    assert.ok(/no Google sign-in built in/.test(r.json.error));
    return req("POST", "/api/secrets", Object.assign({ body: { google: { clientId: "123-example.apps.googleusercontent.com", clientSecret: "example-client-secret" } } }, o));
  }).then(function () {
    return req("POST", "/api/google/start", o);
  }).then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    var u = new URL(r.json.authUrl);
    assert.strictEqual(u.searchParams.get("redirect_uri"), "https://example.github.io/teledash-pro/oauth/");
    var state = u.searchParams.get("state");
    var st = JSON.parse(util.fromB64url(state).toString("utf8"));
    assert.strictEqual(st.t, "http://" + LAN + ":" + port);
    assert.ok(r.text.indexOf("example-client-secret") < 0);
    // The user cancels on Google's page: the nonce is used up without any token request.
    return req("GET", "/oauth/return?error=access_denied&state=" + encodeURIComponent(state), { host: LAN }).then(function (r2) {
      assert.strictEqual(r2.status, 302);
      assert.strictEqual(r2.headers.location, "/setup?google=error");
      return req("GET", "/oauth/return?code=x&state=" + encodeURIComponent(state), { host: LAN });
    });
  }).then(function (r) {
    assert.strictEqual(r.headers.location, "/setup?google=error", "reused state refused");
    return req("GET", "/api/status", o);
  }).then(function (r) {
    assert.ok(/expired or was already used/.test(r.json.google.lastError));
    assert.strictEqual(r.json.google.redirectUri, "https://example.github.io/teledash-pro/oauth/");
  });
});

t.test("usage log: plain text, last 6000 lines", function () {
  var lines = [];
  for (var i = 0; i < 7000; i++) lines.push((1700000000 + i) + " app" + i);
  fs.writeFileSync(path.join(DATA, "usage.log"), lines.join("\n") + "\n");
  return req("GET", "/api/local/usage").then(function (r) {
    assert.ok(/^text\/plain/.test(r.headers["content-type"]));
    var got = r.text.trim().split("\n");
    assert.strictEqual(got.length, 6000);
    assert.strictEqual(got[0], "1700001000 app1000");
    assert.strictEqual(got[5999], "1700006999 app6999");
  });
});

t.test("apps list is empty off the TV; update refuses off the TV", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie };
  return req("GET", "/api/apps", o).then(function (r) {
    assert.deepStrictEqual(r.json, []);
    return req("POST", "/api/local/update");
  }).then(function (r) {
    assert.strictEqual(r.status, 409);
    assert.ok(/only be installed on the TV/.test(r.json.error));
  });
});

t.test("app icons: TV only, valid ids only, 404 when the app has no icon", function () {
  return req("GET", "/icons/netflix", { host: LAN }).then(function (r) {
    assert.strictEqual(r.status, 403);                       // not from the LAN
    return req("GET", "/icons/..%2F..%2Fetc%2Fpasswd");
  }).then(function (r) {
    assert.strictEqual(r.status, 404);                       // not an app id
    return req("GET", "/icons/no.such.app");
  }).then(function (r) { assert.strictEqual(r.status, 404); });   // no luna-send here: no apps
});

t.test("sessions survive a service restart", function () {
  if (!cookie) return;
  proc.kill();
  var p2 = childProcess.spawn(process.execPath, [path.join(PKG, "server", "server.js")], {
    env: Object.assign({}, process.env, { TELEDASH_DATA: DATA, TELEDASH_PORT: String(port) }), stdio: "ignore"
  });
  proc = p2;
  function ready(n) {
    return req("GET", "/api/settings", { host: LAN, cookie: cookie }).catch(function () {
      if (n <= 0) throw new Error("restart failed"); return wait(100).then(function () { return ready(n - 1); });
    });
  }
  return wait(200).then(function () { return ready(50); }).then(function (r) { assert.strictEqual(r.status, 200); });
});

t.test("stop the server", function () { proc.kill(); });

// ---------- Spotify routes ----------
// The spotify module is replaced function by function, so these run the server in this process
// (same data dir, so the session cookie from above still works) instead of the child above.
// Nothing reaches Spotify.
var PAGES = "https://example.github.io/teledash-pro";
var SPOTIFY_ID = "0123456789abcdef0123456789abcdef";
var spotify, config, inproc, calls = [], realSpotify = {};
function stub(fns) {
  Object.keys(fns).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(realSpotify, k)) realSpotify[k] = spotify[k];
    spotify[k] = fns[k];
  });
}
function unstub() { Object.keys(realSpotify).forEach(function (k) { spotify[k] = realSpotify[k]; }); realSpotify = {}; calls = []; }

t.test("spotify: start an in-process server", function () {
  spotify = require("../lib/spotify");
  config = require("../lib/config");
  config.pagesBase = PAGES;
  var handle = require("../server").handle;
  return freePort().then(function (p) {
    port = p;
    return new Promise(function (resolve) { inproc = http.createServer(handle).listen(port, resolve); });
  });
});

t.test("spotify: local music routes call the module and answer with CORS", function () {
  stub({
    state: function () { calls.push(["state"]); return Promise.resolve({ connected: false }); },
    command: function (b) { calls.push(["command", b]); return Promise.resolve({ ok: true }); },
    list: function (kind, opts) { calls.push(["list", kind, opts]); return Promise.resolve({ items: [], next: null }); }
  });
  return req("GET", "/api/local/music").then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    assert.deepStrictEqual(r.json, { connected: false });
    return req("POST", "/api/local/music", { body: { do: "pause" } });
  }).then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    assert.deepStrictEqual(r.json, { ok: true });
    return req("GET", "/api/local/music/list?kind=playlist&id=abc&offset=50&q=x%20y");
  }).then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    assert.deepStrictEqual(r.json, { items: [], next: null });
    return req("GET", "/api/local/music/list?kind=playlists");
  }).then(function () {
    assert.deepStrictEqual(calls, [
      ["state"], ["command", { do: "pause" }],
      ["list", "playlist", { id: "abc", offset: 50, q: "x y" }],
      ["list", "playlists", { id: undefined, offset: undefined, q: undefined }]
    ]);
    assert.strictEqual(typeof calls[2][2].offset, "number");
    return req("OPTIONS", "/api/local/music");
  }).then(function (r) {
    assert.strictEqual(r.status, 204);
    assert.ok(/POST/.test(r.headers["access-control-allow-methods"]));
    assert.ok(/X-TeleDash-Local/.test(r.headers["access-control-allow-headers"]));
  }).then(unstub, function (e) { unstub(); throw e; });
});

t.test("spotify: local music routes refuse bad input before the module sees it", function () {
  stub({
    command: function (b) { calls.push(["command", b]); return Promise.resolve({ ok: true }); },
    list: function (kind) { calls.push(["list", kind]); return Promise.resolve({ items: [], next: null }); }
  });
  var bad = ["kind=liked&offset=-1", "kind=liked&offset=1.5", "kind=liked&offset=abc", "kind=liked&offset=100001", "kind=liked&offset=", "offset=0"];
  return Promise.all(bad.map(function (qs) { return req("GET", "/api/local/music/list?" + qs); })).then(function (rs) {
    rs.forEach(function (r, i) {
      assert.strictEqual(r.status, 400, bad[i]);
      assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    });
    assert.ok(/Say which list: kind=/.test(rs[5].json.error));
    return Promise.all([
      req("POST", "/api/local/music", { body: "pause" }),
      req("POST", "/api/local/music", { body: ["pause"] }),
      req("GET", "/api/local/music/list?kind=liked&offset=100000")
    ]);
  }).then(function (rs) {
    assert.strictEqual(rs[0].status, 400);
    assert.strictEqual(rs[1].status, 400);
    assert.strictEqual(rs[2].status, 200, "100000 is allowed");
    assert.deepStrictEqual(calls, [["list", "liked"]]);
  }).then(unstub, function (e) { unstub(); throw e; });
});

t.test("spotify: local music routes need the key and loopback", function () {
  stub({ state: function () { calls.push(["state"]); return Promise.resolve({ connected: true }); } });
  return req("GET", "/api/local/music", { noKey: true }).then(function (r) {
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    return req("POST", "/api/local/music", { noKey: true, headers: { "X-TeleDash-Local": "wrong" }, body: { do: "pause" } });
  }).then(function (r) {
    assert.strictEqual(r.status, 403);
    return req("GET", "/api/local/music/list?kind=liked", { headers: { Host: "rebind.example:" + port } });
  }).then(function (r) {
    assert.strictEqual(r.status, 403, "host allow-list still applies");
    if (!LAN) return;
    return req("GET", "/api/local/music", { host: LAN }).then(function (r2) {
      assert.strictEqual(r2.status, 403);
      assert.ok(/Only the TV itself/.test(r2.json.error));
    });
  }).then(function () { assert.deepStrictEqual(calls, []); })
    .then(unstub, function (e) { unstub(); throw e; });
});

t.test("spotify: module errors reach the app with their status and message", function () {
  stub({
    state: function () { return Promise.reject(util.httpError(409, "No Spotify device is active.")); },
    command: function () { return Promise.reject(util.httpError(403, "Spotify Premium is needed.")); },
    list: function () { return Promise.reject(util.httpError(400, "Unknown list: nope.")); }
  });
  return Promise.all([
    req("GET", "/api/local/music"),
    req("POST", "/api/local/music", { body: { do: "play" } }),
    req("GET", "/api/local/music/list?kind=nope")
  ]).then(function (rs) {
    assert.deepStrictEqual(rs.map(function (r) { return [r.status, r.json.error, r.headers["access-control-allow-origin"]]; }), [
      [409, "No Spotify device is active.", "*"], [403, "Spotify Premium is needed.", "*"], [400, "Unknown list: nope.", "*"]
    ]);
  }).then(unstub, function (e) { unstub(); throw e; });
});

t.test("spotify: status, state and start", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie, write: true };
  stub({
    start: function (origin, pagesBase) {
      calls.push(["start", origin, pagesBase]);
      return { authUrl: "https://accounts.spotify.com/authorize?client_id=" + SPOTIFY_ID, state: "example-state" };
    }
  });
  return req("GET", "/api/status", o).then(function (r) {
    assert.deepStrictEqual(r.json.spotify, { available: true, redirectUri: PAGES + "/oauth/", lastError: null });
    assert.strictEqual(r.json.stored.spotifyClient, false);
    assert.strictEqual(r.json.stored.spotifySignedIn, false);
    assert.strictEqual(r.json.connected.spotify, false);
    return req("POST", "/api/spotify/start", { host: LAN, cookie: cookie });
  }).then(function (r) {
    assert.strictEqual(r.status, 403, "X-TeleDash still required");
    return req("POST", "/api/spotify/start", o);
  }).then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    assert.deepStrictEqual(r.json, { authUrl: "https://accounts.spotify.com/authorize?client_id=" + SPOTIFY_ID });
    assert.deepStrictEqual(calls, [["start", "http://" + LAN + ":" + config.port, PAGES]]);
    spotify.start = function () { throw util.httpError(400, "Save your Spotify client ID first."); };
    return req("POST", "/api/spotify/start", o);
  }).then(function (r) {
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, "Save your Spotify client ID first.");
    // A signed-in account (tokens written the way spotify.finish would) shows in both views.
    require("../lib/secrets").saveSpotify({ clientId: SPOTIFY_ID, refreshToken: "example-refresh" });
    return Promise.all([req("GET", "/api/status", o), req("GET", "/api/local/state")]);
  }).then(function (rs) {
    assert.strictEqual(rs[0].json.stored.spotifyClient, true);
    assert.strictEqual(rs[0].json.stored.spotifySignedIn, true);
    assert.strictEqual(rs[0].json.connected.spotify, true);
    assert.strictEqual(rs[1].json.connected.spotify, true);
    assert.ok(rs[0].text.indexOf("example-refresh") < 0 && rs[1].text.indexOf("example-refresh") < 0, "token leaked");
    config.pagesBase = "";
    return req("GET", "/api/status", o);
  }).then(function (r) {
    assert.deepStrictEqual(r.json.spotify, { available: false, redirectUri: null, lastError: null });
  }).then(function () { config.pagesBase = PAGES; unstub(); }, function (e) { config.pagesBase = PAGES; unstub(); throw e; });
});

t.test("spotify: /oauth/return goes to Spotify only when it owns the state", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie, write: true };
  var outcome = Promise.resolve();
  stub({
    owns: function (state) { calls.push(["owns", state]); return state === "sp-state"; },
    finish: function (q, pagesBase) { calls.push(["finish", q, pagesBase]); return outcome; }
  });
  return req("GET", "/oauth/return?code=c1&state=sp-state", { host: LAN }).then(function (r) {
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, "/setup?spotify=ok");
    assert.deepStrictEqual(calls, [["owns", "sp-state"], ["finish", { code: "c1", state: "sp-state", error: null }, PAGES]]);
    outcome = Promise.reject(util.httpError(400, "Spotify sign-in was cancelled."));
    outcome.catch(function () {});
    return req("GET", "/oauth/return?error=access_denied&state=sp-state", { host: LAN });
  }).then(function (r) {
    assert.strictEqual(r.headers.location, "/setup?spotify=error");
    return req("GET", "/api/status", o);
  }).then(function (r) {
    assert.strictEqual(r.json.spotify.lastError, "Spotify sign-in was cancelled.");
    assert.strictEqual(r.json.google.lastError === "Spotify sign-in was cancelled.", false, "Google's error untouched");
    outcome = Promise.reject(new Error("socket hang up"));
    outcome.catch(function () {});
    return req("GET", "/oauth/return?code=c2&state=sp-state", { host: LAN });
  }).then(function (r) {
    assert.strictEqual(r.headers.location, "/setup?spotify=error");
    return req("GET", "/api/status", o);
  }).then(function (r) {
    assert.strictEqual(r.json.spotify.lastError, "Spotify sign-in did not complete.", "internal errors are not shown");
    // Saving a client ID clears the last error, as for Google.
    return req("POST", "/api/secrets", Object.assign({ body: { spotify: { clientId: SPOTIFY_ID } } }, o));
  }).then(function (r) {
    assert.deepStrictEqual(r.json, { ok: true });
    return req("GET", "/api/status", o);
  }).then(function (r) {
    assert.strictEqual(r.json.spotify.lastError, null);
    calls = [];
    // Not Spotify's state: Google's path, unchanged (an unknown state is refused there).
    return req("GET", "/oauth/return?code=c3&state=not-ours", { host: LAN });
  }).then(function (r) {
    assert.strictEqual(r.headers.location, "/setup?google=error");
    assert.deepStrictEqual(calls, [["owns", "not-ours"]], "spotify.finish not called");
    return req("GET", "/api/status", o);
  }).then(function (r) {
    assert.ok(/expired or was already used/.test(r.json.google.lastError));
    assert.strictEqual(r.json.spotify.lastError, null);
  }).then(unstub, function (e) { unstub(); throw e; });
});

t.test("spotify: removing the secret turns the Music tile off", function () {
  if (!cookie) return;
  var o = { host: LAN, cookie: cookie, write: true };
  return req("PUT", "/api/settings", Object.assign({ body: { music: { tile: true, fadeSeconds: 20 } } }, o)).then(function (r) {
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.music.tile, true);
    return req("POST", "/api/secrets", Object.assign({ body: { spotify: { clientId: SPOTIFY_ID } } }, o));
  }).then(function () {
    return req("DELETE", "/api/secrets/spotify", o);
  }).then(function (r) {
    assert.deepStrictEqual(r.json, { ok: true });
    return Promise.all([req("GET", "/api/settings", o), req("GET", "/api/status", o)]);
  }).then(function (rs) {
    assert.deepStrictEqual(rs[0].json.music, { tile: false, fadeSeconds: 20, fadeTo: 0, skin: "retro" });
    assert.strictEqual(rs[1].json.stored.spotifyClient, false);
    assert.strictEqual(rs[1].json.stored.spotifySignedIn, false);
  });
});

t.test("spotify: stop the in-process server", function () {
  return new Promise(function (resolve) { inproc.close(resolve); });
});

process.on("exit", function () { if (proc) try { proc.kill(); } catch (e) { /* gone */ } });
t.run();
