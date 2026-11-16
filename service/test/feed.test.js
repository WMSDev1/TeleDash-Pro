"use strict";
// Data feed parsing (fixture text only; no network) and update helpers.
var t = require("./harness");
var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var feed = require("../lib/feed");
var http = require("../lib/http");
var updates = require("../lib/updates");
var secrets = require("../lib/secrets");

var COLS = { date: "date", value: "value", flows: "", time: "" };

t.test("github: addresses become GitHub contents API calls", function () {
  var r = feed.resolve("github:example/feeds/data/account.csv@main", "tok");
  assert.strictEqual(r.url, "https://api.github.com/repos/example/feeds/contents/data/account.csv?ref=main");
  assert.strictEqual(r.headers.Accept, "application/vnd.github.raw");
  assert.strictEqual(r.headers.Authorization, "Bearer tok");
  assert.strictEqual(feed.resolve("github:example/feeds/a b.json").url, "https://api.github.com/repos/example/feeds/contents/a%20b.json");
  var plain = feed.resolve("https://example.com/feed.json", "");
  assert.strictEqual(plain.url, "https://example.com/feed.json");
  assert.strictEqual(plain.headers.Authorization, undefined);
  assert.strictEqual(feed.resolve("https://example.com/f.json", "t2").headers.Authorization, "Bearer t2");
});

t.test("JSON feed v1 is cleaned to the documented fields", function () {
  var f = feed.parseJson(JSON.stringify({
    title: "Account", asOf: "2026-01-02 15:00",
    items: [{ label: "Value", value: 1234.5, change: 12.3, format: "usd", extra: "dropped" },
            { label: "Yield", value: "4.1", format: "percent" }, { label: "Bad", value: "n/a" }, "junk"]
  }), "");
  assert.deepStrictEqual(f, { title: "Account", asOf: "2026-01-02 15:00", items: [
    { label: "Value", value: 1234.5, change: 12.3, format: "usd" }, { label: "Yield", value: 4.1, format: "percent" }] });
  assert.strictEqual(feed.parseJson('{"title":"A","items":[{"value":1}]}', "Mine").title, "Mine");
  assert.throws(function () { feed.parseJson("not json"); }, /not valid JSON/);
  assert.throws(function () { feed.parseJson("{}"); }, /no "items" list/);
});

t.test("CSV: last row with a value, change against the last earlier date", function () {
  var csv = "date,time,value,deposits\n" +
    "2026-01-01,16:00,1000.00,0\n" +
    "2026-01-02,10:00,1010.00,0\n" +
    "2026-01-02,16:00,1050.50,0\n" +
    "2026-01-03,10:00,\"1,170.25\",100\n" +
    "2026-01-03,11:00,,100\n";
  var f = feed.parseCsv(csv, { date: "date", value: "value", flows: "deposits", time: "time" }, "Account");
  // 1170.25 - 1050.50 = 119.75, minus 100 deposited = 19.75
  assert.deepStrictEqual(f, { title: "Account", asOf: "2026-01-03 10:00", items: [{ label: "Account", value: 1170.25, change: 19.75, format: "usd" }] });
  var g = feed.parseCsv("Date,Value\r\n2026-01-01,5\r\n", COLS, "");
  assert.deepStrictEqual(g, { title: "", asOf: "2026-01-01", items: [{ label: "Value", value: 5, format: "usd" }] });
});

t.test("CSV parser handles quotes, commas and line breaks in fields", function () {
  assert.deepStrictEqual(feed.csvRows('a,b\n"x, ""y""","line\nbreak"\n\n'), [["a", "b"], ['x, "y"', "line\nbreak"]]);
  assert.throws(function () { feed.parseCsv("date,amount\n2026-01-01,5\n", COLS, ""); }, /no column called "value"/);
  assert.throws(function () { feed.parseCsv("date,value\n", COLS, ""); }, /header row and at least one row/);
  assert.throws(function () { feed.parseCsv("date,value\n2026-01-01,abc\n", COLS, ""); }, /not a number/);
});

t.test("feed fetch reports plain-English errors (mocked transport)", function () {
  var real = http.request;
  http.request = function () { return Promise.resolve({ status: 404, headers: {}, body: Buffer.from("") }); };
  var cfg = { enabled: true, url: "github:example/private/feed.json", format: "json", title: "", csv: COLS };
  return t.rejects(function () { return feed.fetchFeed(cfg, ""); }, /not found.*private repository/)
    .then(function () { return t.rejects(function () { return feed.fetchFeed({ enabled: false, url: "" }); }, /No data feed/, 404); })
    .then(function () {
      var sent = null;
      http.request = function (o) { sent = o; return Promise.resolve({ status: 200, headers: {}, body: Buffer.from("date,value\n2026-01-01,7\n") }); };
      return feed.fetchFeed({ enabled: true, url: "https://example.com/a.csv", format: "csv", title: "T", csv: COLS }, "tok");
    }).then(function (f) {
      assert.strictEqual(f.items[0].value, 7);
    }).then(function () { http.request = real; }, function (e) { http.request = real; throw e; });
});

t.test("the feed token is sent only to the origin it was saved for", function () {
  var real = http.request, sent = [];
  http.request = function (o) { sent.push(o); return Promise.resolve({ status: 200, headers: {}, body: Buffer.from('{"items":[{"value":1}]}') }); };
  var gh = { enabled: true, url: "github:example/feeds/f.json", format: "json", title: "", csv: COLS };
  var other = { enabled: true, url: "https://attacker.example/f.json", format: "json", title: "", csv: COLS };
  assert.strictEqual(feed.originOf(gh.url), "https://api.github.com");
  assert.strictEqual(feed.originOf("https://example.com:8443/a?b"), "https://example.com:8443");
  assert.strictEqual(feed.originOf(""), "");
  return feed.fetchFeed(gh, "tok", "https://api.github.com").then(function () {
    return feed.fetchFeed(other, "tok", "https://api.github.com");
  }).then(function () {
    return feed.fetchFeed(other, "tok", undefined);
  }).then(function () {
    assert.strictEqual(sent[0].headers.Authorization, "Bearer tok");
    assert.strictEqual(sent[1].headers.Authorization, undefined, "other origin: no token");
    assert.strictEqual(sent[2].headers.Authorization, undefined, "unbound token: not sent");
  }).then(function () { http.request = real; }, function (e) { http.request = real; throw e; });
});

t.test("secrets: a feed token is bound to its origin and dropped when the feed moves", function () {
  secrets.save({ feedToken: "tok1" }, "https://api.github.com");
  assert.strictEqual(secrets.load().feedTokenOrigin, "https://api.github.com");
  assert.strictEqual(secrets.feedUrlChanged("https://api.github.com"), false, "same site: kept");
  assert.strictEqual(secrets.load().feedToken, "tok1");
  assert.strictEqual(secrets.feedUrlChanged("https://attacker.example"), true, "other site: dropped");
  assert.strictEqual(secrets.load().feedToken, undefined);
  assert.strictEqual(secrets.load().feedTokenOrigin, undefined);
  // Saved before any address: tied to the first address saved afterwards.
  secrets.save({ feedToken: "tok2" }, "");
  assert.strictEqual(secrets.load().feedTokenOrigin, undefined);
  assert.strictEqual(secrets.feedUrlChanged(""), false);
  assert.strictEqual(secrets.feedUrlChanged("https://example.com"), false);
  assert.strictEqual(secrets.load().feedTokenOrigin, "https://example.com");
  assert.strictEqual(secrets.load().feedToken, "tok2");
  secrets.remove("feedToken");
  assert.strictEqual(secrets.load().feedTokenOrigin, undefined);
});

t.test("version comparison", function () {
  assert.strictEqual(updates.compareVersions("1.10.0", "1.9.3"), 1);
  assert.strictEqual(updates.compareVersions("1.0", "1.0.0"), 0);
  assert.strictEqual(updates.compareVersions("0.9.9", "1.0.0"), -1);
});

t.test("update download is refused unless the SHA-256 matches", function () {
  var real = http.request;
  var ipk = Buffer.from("pretend package");
  var good = crypto.createHash("sha256").update(ipk).digest("hex");
  var dest = path.join(t.dir, "update.ipk");
  http.request = function () { return Promise.resolve({ status: 200, headers: {}, body: ipk }); };
  function restore(e) { http.request = real; if (e) throw e; }
  return t.rejects(function () { return updates.download({ ipkUrl: "https://example.com/x.ipk", ipkHash: { sha256: "0".repeat(64) } }, dest); }, /did not match its checksum/)
    .then(function () { assert.strictEqual(fs.existsSync(dest), false); })
    .then(function () { return t.rejects(function () { return updates.download({ ipkUrl: "https://example.com/x.ipk" }, dest); }, /no checksum/); })
    .then(function () { return t.rejects(function () { return updates.download({ ipkUrl: "http://example.com/x.ipk", ipkHash: { sha256: good } }, dest); }, /not over https/); })
    .then(function () { return updates.download({ ipkUrl: "https://example.com/x.ipk", ipkHash: { sha256: good.toUpperCase() } }, dest); })
    .then(function (file) {
      assert.strictEqual(file, dest);
      assert.strictEqual(fs.readFileSync(dest, "utf8"), "pretend package");
      // An existing file (or a planted symlink) is never written into.
      return t.rejects(function () { return updates.download({ ipkUrl: "https://example.com/x.ipk", ipkHash: { sha256: good } }, dest); }, /EEXIST/);
    }).then(function () {
      // Default: a fresh private directory (711) holding a public file (644).
      return updates.download({ ipkUrl: "https://example.com/x.ipk", ipkHash: { sha256: good } });
    }).then(function (file) {
      var dir = path.dirname(file);
      assert.ok(/teledash-update-/.test(path.basename(dir)), dir);
      assert.strictEqual(fs.statSync(dir).mode & 511, 457);
      assert.strictEqual(fs.statSync(file).mode & 511, 420);
      fs.unlinkSync(file); fs.rmdirSync(dir);
    }).then(function () { restore(); }, restore);
});

t.run();
