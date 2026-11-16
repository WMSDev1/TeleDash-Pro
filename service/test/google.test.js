"use strict";
// Google sign-in state handling, PKCE, token refresh and event normalising, with the HTTP
// transport mocked: no request ever reaches Google.
var t = require("./harness");
var assert = require("assert");
var util = require("../lib/util");
var http = require("../lib/http");
var secrets = require("../lib/secrets");
var settings = require("../lib/settings");
var config = require("../lib/config");
var google = require("../lib/google");

var PAGES = "https://example.github.io/teledash-pro";
var ORIGIN = "http://192.168.1.50:8770";
var calls = [];
var replies = [];
var realJson = http.json;
http.json = function (o) {
  calls.push(o);
  var r = replies.shift();
  if (!r) return Promise.reject(new Error("unexpected request to " + o.url));
  return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
};
function query(url) { var u = new URL(url); var o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
function body(o) { return query("http://x/?" + o.body); }

t.test("start needs a Pages address and client keys", function () {
  return t.rejects(function () { google.start(ORIGIN, ""); }, /not available in this build/, 400)
    .then(function () { return t.rejects(function () { google.start(ORIGIN, PAGES); }, /no Google sign-in built in/, 400); });
});

t.test("start builds the contract's auth URL and state", function () {
  secrets.save({ google: { clientId: "123-example.apps.googleusercontent.com", clientSecret: "example-secret" } });
  var r = google.start(ORIGIN, PAGES);
  var q = query(r.authUrl);
  assert.ok(r.authUrl.indexOf("https://accounts.google.com/o/oauth2/v2/auth?") === 0);
  assert.strictEqual(q.redirect_uri, PAGES + "/oauth/");
  assert.strictEqual(q.scope, "https://www.googleapis.com/auth/calendar.readonly");
  assert.strictEqual(q.access_type, "offline");
  assert.strictEqual(q.prompt, "consent");
  assert.strictEqual(q.response_type, "code");
  assert.strictEqual(q.code_challenge_method, "S256");
  var st = JSON.parse(util.fromB64url(q.state).toString("utf8"));
  assert.strictEqual(st.t, ORIGIN);
  assert.ok(/^[A-Za-z0-9_-]{16,}$/.test(st.n));
  assert.ok(q.client_secret === undefined, "the secret never goes into the browser URL");
});

t.test("finish: bad, cancelled and reused states never call Google", function () {
  calls = [];
  var q = query(google.start(ORIGIN, PAGES).authUrl);
  return t.rejects(function () { return google.finish({ state: "garbage", code: "c" }, PAGES); }, /expired or was already used/)
    .then(function () { return t.rejects(function () { return google.finish({ state: q.state, error: "access_denied" }, PAGES); }, /cancelled/); })
    .then(function () { return t.rejects(function () { return google.finish({ state: q.state, code: "c" }, PAGES); }, /already used/); })
    .then(function () { assert.strictEqual(calls.length, 0); });
});

t.test("finish exchanges the code with the PKCE verifier and stores tokens", function () {
  calls = [];
  var q = query(google.start(ORIGIN, PAGES).authUrl);
  replies.push({ access_token: "at1", expires_in: 3600, refresh_token: "rt1" });
  return google.finish({ state: q.state, code: "the-code" }, PAGES).then(function () {
    assert.strictEqual(calls.length, 1);
    var b = body(calls[0]);
    assert.strictEqual(calls[0].url, "https://oauth2.googleapis.com/token");
    assert.strictEqual(b.grant_type, "authorization_code");
    assert.strictEqual(b.code, "the-code");
    assert.strictEqual(b.redirect_uri, PAGES + "/oauth/");
    assert.strictEqual(b.client_secret, "example-secret");
    assert.strictEqual(util.b64url(util.sha256(b.code_verifier)), q.code_challenge, "verifier matches the challenge");
    var g = secrets.load().google;
    assert.strictEqual(g.refreshToken, "rt1");
    assert.ok(g.expiry > Date.now());
    assert.strictEqual(settings.load().calendar.source, "google");
    assert.strictEqual(secrets.stored().googleSignedIn, true);
  });
});

t.test("access token is refreshed near expiry; revoked access forgets tokens", function () {
  calls = [];
  return google.accessToken().then(function (tok) {
    assert.strictEqual(tok, "at1");
    assert.strictEqual(calls.length, 0, "still valid: no refresh");
    secrets.saveGoogle({ expiry: Date.now() + 1000 });
    replies.push({ access_token: "at2", expires_in: 3600 });
    return google.accessToken();
  }).then(function (tok) {
    assert.strictEqual(tok, "at2");
    assert.strictEqual(body(calls[0]).grant_type, "refresh_token");
    assert.strictEqual(secrets.load().google.refreshToken, "rt1", "kept when Google does not rotate it");
    secrets.saveGoogle({ expiry: 0 });
    var e = util.httpError(502, "refused");
    e.data = { error: "invalid_grant" };
    replies.push(e);
    return t.rejects(function () { return google.accessToken(); }, /expired or was revoked/, 401);
  }).then(function () {
    assert.strictEqual(secrets.stored().googleSignedIn, false);
    assert.strictEqual(secrets.stored().googleClient, true, "client keys are kept");
  });
});

t.test("events: window, all-day normalising, cancelled dropped, sorted", function () {
  calls = [];
  secrets.saveGoogle({ refreshToken: "rt1", accessToken: "at3", expiry: Date.now() + 3600000 });
  settings.save({ calendar: { calendars: ["primary", "shared calendar/1"] } });
  replies.push({ items: [
    { summary: "Dentist", start: { dateTime: "2026-01-02T15:00:00-05:00" }, end: { dateTime: "2026-01-02T16:00:00-05:00" } },
    { summary: "Gone", status: "cancelled", start: { date: "2026-01-02" }, end: { date: "2026-01-03" } }
  ] });
  replies.push({ items: [{ start: { date: "2026-01-02" }, end: { date: "2026-01-03" } }] });
  return google.events(2, 300).then(function (ev) {
    assert.deepStrictEqual(ev, [
      { summary: "(No title)", start: "2026-01-02", end: "2026-01-03", allDay: true },
      { summary: "Dentist", start: "2026-01-02T15:00:00-05:00", end: "2026-01-02T16:00:00-05:00", allDay: false }
    ]);
    assert.ok(calls[1].url.indexOf("/calendars/shared%20calendar%2F1/events?singleEvents=true&orderBy=startTime") > 0);
    assert.strictEqual(calls[0].headers.Authorization, "Bearer at3");
  });
});

t.test("window covers local midnight to midnight N days later (plus 2 h for DST)", function () {
  // 2026-01-02 03:00 UTC is still 2026-01-01 in a UTC-5 zone (tz offset +300 minutes).
  var w = google.windowFor(2, 300, Date.UTC(2026, 0, 2, 3, 0));
  assert.strictEqual(w.min.toISOString(), "2026-01-01T05:00:00.000Z");
  assert.strictEqual(w.max.toISOString(), "2026-01-03T07:00:00.000Z");   // 2 h spare for a DST change
});

t.test("the client file: Google's download or plain fields; anything else is ignored", function () {
  var P = config.parseGoogleClient;
  assert.deepStrictEqual(P({ web: { client_id: "1-a.apps.googleusercontent.com", client_secret: "s" } }), { clientId: "1-a.apps.googleusercontent.com", clientSecret: "s" });
  assert.deepStrictEqual(P({ clientId: "1-a.apps.googleusercontent.com", clientSecret: "s" }), { clientId: "1-a.apps.googleusercontent.com", clientSecret: "s" });
  assert.strictEqual(P({ web: { client_id: "nope", client_secret: "s" } }), null);
  assert.strictEqual(P({ web: { client_id: "1-a.apps.googleusercontent.com" } }), null);
  assert.strictEqual(P(null), null);
});

t.test("built-in client: sign in without saving keys; tokens refresh with the client that issued them", function () {
  secrets.remove("google");
  config.googleClient = { clientId: "999-project.apps.googleusercontent.com", clientSecret: "project-secret" };
  calls = [];
  var q = query(google.start(ORIGIN, PAGES).authUrl);
  assert.strictEqual(q.client_id, "999-project.apps.googleusercontent.com");
  replies.push({ access_token: "p1", expires_in: 3600, refresh_token: "prt" });
  return google.finish({ state: q.state, code: "c2" }, PAGES).then(function () {
    assert.strictEqual(body(calls[0]).client_secret, "project-secret");
    var g = secrets.load().google;
    assert.strictEqual(g.tokenClientId, "999-project.apps.googleusercontent.com");
    assert.strictEqual(g.clientId, undefined, "nothing to paste, nothing saved");
    assert.strictEqual(secrets.stored().googleClient, false);
    assert.strictEqual(secrets.stored().googleSignedIn, true);
    secrets.saveGoogle({ expiry: 0 });
    replies.push({ access_token: "p2", expires_in: 3600 });
    return google.accessToken();
  }).then(function (tok) {
    assert.strictEqual(tok, "p2");
    assert.strictEqual(body(calls[1]).client_id, "999-project.apps.googleusercontent.com");
    // A sign-in started with one client cannot finish with another.
    var q2 = query(google.start(ORIGIN, PAGES).authUrl);
    secrets.save({ google: { clientId: "123-example.apps.googleusercontent.com", clientSecret: "example-secret" } });
    return t.rejects(function () { return google.finish({ state: q2.state, code: "c3" }, PAGES); }, /client changed/);
  }).then(function () {
    // The owner's own client wins for new sign-ins.
    assert.strictEqual(query(google.start(ORIGIN, PAGES).authUrl).client_id, "123-example.apps.googleusercontent.com");
    config.googleClient = null;
  });
});

t.test("restore transport", function () { http.json = realJson; });

t.run();
