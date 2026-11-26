"use strict";
// Settings validation, defaults, rounding and the private file modes.
var t = require("./harness");
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var settings = require("../lib/settings");
var secrets = require("../lib/secrets");
var session = require("../lib/session");

var D = settings.DEFAULTS;
function apply(patch) { return settings.apply(settings.load(), patch); }

t.test("defaults match the contract", function () {
  var s = settings.load();
  assert.strictEqual(s.rev, 0);
  assert.strictEqual(s.apps, null);
  assert.strictEqual(s.updates.auto, false);
  assert.strictEqual(s.home.delaySeconds, 1);
  assert.deepStrictEqual(s.pinned, ["com.webos.app.hdmi1", "com.webos.app.home"]);
  assert.deepStrictEqual(s.feed.csv, { date: "date", value: "value", flows: "", time: "" });
});

t.test("unknown keys are rejected, top level and nested", function () {
  return Promise.all([
    t.rejects(function () { apply({ night: { from: "10pm" } }); }, /night.from must be a time/),
    t.rejects(function () { apply({ colour: 1 }); }, /Unknown setting: colour/, 400),
    t.rejects(function () { apply({ home: { opens: true } }); }, /Unknown setting: home.opens/),
    t.rejects(function () { apply({ feed: { csv: { extra: "x" } } }); }, /Unknown setting: feed.csv.extra/),
    t.rejects(function () { apply({ apps: [{ id: "netflix", title: "N", logo: "x.png" }] }); }, /Unknown setting: apps\[0\].logo/)
  ]);
});

t.test("field checks give plain-English messages", function () {
  return Promise.all([
    t.rejects(function () { apply({ columns: 6.5 }); }, /columns must be a whole number/),
    t.rejects(function () { apply({ home: { delaySeconds: 31 } }); }, /from 0 to 30/),
    t.rejects(function () { apply({ calendar: { source: "outlook" } }); }, /calendar.source must be one of/),
    t.rejects(function () { apply({ morning: { weekdays: { from: "25:00", to: "09:00" } } }); }, /time like/),
    t.rejects(function () { apply({ countdowns: { dates: [{ title: "x", date: "02-30" }] } }); }, /not a real date/),
    t.rejects(function () { apply({ countdowns: { dates: [{ title: "x", date: "2026-13-01" }] } }); }, /not a real date/),
    t.rejects(function () { apply({ feed: { url: "http://example.com/feed.json" } }); }, /https/),
    t.rejects(function () { apply({ feed: { url: "github:owner/repo/../x" } }); }, /invalid file path/),
    t.rejects(function () { apply({ feed: { enabled: true } }); }, /address/),
    t.rejects(function () { apply({ apps: [{ id: "bad id", title: "x" }] }); }, /not a valid app id/),
    t.rejects(function () { apply({ weather: { latitude: 91, longitude: 0 } }); }, /latitude/),
    t.rejects(function () { apply({ updates: { auto: "yes" } }); }, /true or false/),
    t.rejects(function () { apply([]); }, /object/)
  ]);
});

t.test("partial updates merge; rev is not client-settable", function () {
  var s = apply({ rev: 99, home: { delaySeconds: 5 }, feed: { csv: { flows: "deposits" } } });
  assert.strictEqual(s.rev, 0);
  assert.deepStrictEqual(s.home, { opensDashboard: false, delaySeconds: 5 });
  assert.deepStrictEqual(s.feed.csv, { date: "date", value: "value", flows: "deposits", time: "" });
  assert.strictEqual(apply({ morning: { weekends: null } }).morning.weekends, null);
  assert.deepStrictEqual(apply({}).night, { from: "22:00" });
  assert.deepStrictEqual(apply({ night: { from: "23:30" } }).night, { from: "23:30" });
  assert.strictEqual(apply({ night: null }).night, null);
  assert.deepStrictEqual(settings.apply(apply({ night: null }), { night: { from: "21:00" } }).night, { from: "21:00" });
  assert.deepStrictEqual(apply({ morning: { weekdays: { from: "05:00" } } }).morning.weekdays, { from: "05:00", to: "09:00" });
  assert.deepStrictEqual(apply({ calendar: { calendars: [] } }).calendar.calendars, ["primary"]);
  var ok = apply({ feed: { enabled: true, url: "github:example/feeds/data/account.csv@main", format: "csv" }, countdowns: { dates: [{ title: "Trip", date: "2027-02-12" }, { title: "Leap", date: "02-29" }] } });
  assert.strictEqual(ok.feed.enabled, true);
  assert.strictEqual(ok.countdowns.dates.length, 2);
  assert.deepStrictEqual(apply({ apps: [{ id: "com.webos.app.home", title: "All apps", exit: true, color: "#3d4450" }] }).apps[0],
    { id: "com.webos.app.home", title: "All apps", color: "#3d4450", exit: true });
});

t.test("weather coordinates are rounded to one decimal", function () {
  var w = apply({ weather: { latitude: 40.71284, longitude: -74.00597, label: " Example City ", fahrenheit: true } }).weather;
  assert.deepStrictEqual(w, { latitude: 40.7, longitude: -74, label: "Example City", fahrenheit: true });
});

t.test("save bumps rev and writes a mode-600 file in a mode-700 dir", function () {
  var r1 = settings.save({ columns: 5 });
  var r2 = settings.save({ columns: 7 });
  assert.strictEqual(r1.settings.rev, 1);
  assert.strictEqual(r2.settings.rev, 2);
  assert.strictEqual(r2.before.columns, 5);
  assert.strictEqual(settings.load().columns, 7);
  var data = process.env.TELEDASH_DATA;
  assert.strictEqual(fs.statSync(path.join(data, "settings.json")).mode & 511, 384);
  assert.strictEqual(fs.statSync(data).mode & 511, 448);
  assert.deepStrictEqual(fs.readdirSync(data).filter(function (f) { return /tmp/.test(f); }), []);   // no temp files left
});

t.test("secrets: validated, stored privately, reported only as booleans", function () {
  return Promise.all([
    t.rejects(function () { secrets.save({ icalUrl: "http://example.com/x.ics" }); }, /https/),
    t.rejects(function () { secrets.save({ google: { clientId: "abc", clientSecret: "x" } }); }, /googleusercontent/),
    t.rejects(function () { secrets.save({ mystery: "x" }); }, /Unknown secret/)
  ]).then(function () {
    secrets.save({ icalUrl: "webcal://calendar.example.com/example-secret-path/basic.ics", feedToken: "tok_example" });
    var raw = secrets.load();
    assert.strictEqual(raw.icalUrl, "https://calendar.example.com/example-secret-path/basic.ics");
    assert.deepStrictEqual(secrets.stored(), { icalUrl: true, googleClient: false, googleSignedIn: false, spotifyClient: false, spotifySignedIn: false, feedToken: true });
    assert.strictEqual(fs.statSync(path.join(process.env.TELEDASH_DATA, "secrets.json")).mode & 511, 384);
    secrets.remove("feedToken");
    assert.strictEqual(secrets.stored().feedToken, false);
    return t.rejects(function () { secrets.remove("settings"); }, /no secret/, 404);
  });
});

t.test("music settings: defaults, partial updates and limits", function () {
  assert.deepStrictEqual(settings.load().music, { tile: false, fadeSeconds: 8, fadeTo: 0, skin: "retro" });
  assert.deepStrictEqual(apply({ music: { fadeSeconds: 30 } }).music, { tile: false, fadeSeconds: 30, fadeTo: 0, skin: "retro" });
  assert.deepStrictEqual(apply({ music: { tile: true, fadeSeconds: 0, fadeTo: 100, skin: "modern" } }).music, { tile: true, fadeSeconds: 0, fadeTo: 100, skin: "modern" });
  return Promise.all([
    t.rejects(function () { apply({ music: { fadeSeconds: 601 } }); }, /music.fadeSeconds must be a whole number from 0 to 600/),
    t.rejects(function () { apply({ music: { fadeTo: 101 } }); }, /music.fadeTo/),
    t.rejects(function () { apply({ music: { tile: "yes" } }); }, /music.tile must be true or false/),
    t.rejects(function () { apply({ music: { skin: "neon" } }); }, /music.skin must be one of: retro, modern, slim/),
    t.rejects(function () { apply({ music: { visualizer: "bars" } }); }, /Unknown setting: music.visualizer/)
  ]);
});

t.test("spotify secret: a client ID only, and a new one forgets the old sign-in", function () {
  var ID = "0123456789abcdef0123456789abcdef", OTHER = "fedcba9876543210fedcba9876543210";
  return Promise.all([
    t.rejects(function () { secrets.save({ spotify: { clientId: "not-an-id" } }); }, /32 letters and digits/),
    t.rejects(function () { secrets.save({ spotify: { clientId: ID, clientSecret: "x" } }); }, /Unknown Spotify setting/),
    t.rejects(function () { secrets.save({ spotify: "x" }); }, /Spotify needs a client ID/)
  ]).then(function () {
    secrets.save({ spotify: { clientId: ID.toUpperCase() } });
    assert.strictEqual(secrets.load().spotify.clientId, ID, "stored in lower case");
    assert.strictEqual(secrets.stored().spotifyClient, true);
    assert.strictEqual(secrets.stored().spotifySignedIn, false);
    secrets.saveSpotify({ refreshToken: "rt", accessToken: "at", expiry: 1 });
    assert.strictEqual(secrets.stored().spotifySignedIn, true);
    secrets.save({ spotify: { clientId: ID } });
    assert.strictEqual(secrets.stored().spotifySignedIn, true, "the same client keeps its sign-in");
    secrets.saveSpotify({ accessToken: undefined });
    assert.ok(!("accessToken" in secrets.load().spotify), "undefined removes a field");
    secrets.save({ spotify: { clientId: OTHER } });
    assert.deepStrictEqual(secrets.load().spotify, { clientId: OTHER });
    secrets.remove("spotify");
    assert.strictEqual(secrets.stored().spotifyClient, false);
  });
});

t.test("pairing codes: one at a time, single use, URL-safe", function () {
  var a = session.newCode();
  assert.ok(/^[A-Za-z0-9_-]{8,}$/.test(a.code));
  var b = session.newCode();
  assert.strictEqual(session.consumeCode(a.code), false, "older code is invalidated");
  assert.strictEqual(session.consumeCode("wrong"), false);
  assert.strictEqual(session.consumeCode(b.code), true);
  assert.strictEqual(session.consumeCode(b.code), false, "single use");
  var s = session.newSession();
  assert.strictEqual(session.validSession(s.token), true);
  assert.strictEqual(session.validSession(s.token + "x"), false);
  assert.strictEqual(session.validSession(null), false);
  var stored = fs.readFileSync(path.join(process.env.TELEDASH_DATA, "sessions.json"), "utf8");
  assert.ok(stored.indexOf(s.token) < 0, "only hashes are stored");
});

t.run();
