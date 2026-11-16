// Tests for the check and release helpers (scan.js, es5.js, manifest.js). Run by scripts/check.sh.
// Fixtures are assembled at runtime so this file itself passes the scan.
"use strict";
const assert = require("assert");
const { scanText } = require("./scan.js");
const { checkFallback } = require("./es5.js");
const { buildManifest, buildIndex } = require("./manifest.js");

const rules = (name, text, deny) => scanText(name, text, deny || []).map(h => h.rule);
const j = parts => parts.join("");

// Private IPv4: documentation examples pass, other private addresses fail, public ones are not our business.
assert.deepStrictEqual(rules("a.md", "TV at 192.168.1.50 or 192.168.0.2, local 127.0.0.1, any 0.0.0.0"), []);
assert.strictEqual(rules("a.md", "TV at " + ["192", "168", "7", "20"].join(".")).length, 1);
assert.strictEqual(rules("a.md", "x " + ["10", "1", "2", "3"].join(".") + " y").length, 1);
assert.strictEqual(rules("a.md", ["172", "20", "0", "1"].join(".")).length, 1);
assert.deepStrictEqual(rules("a.md", "version 10.1.2.3.4 and 1.2.3"), []);

// Email: example.com and noreply are fine.
assert.deepStrictEqual(rules("a.md", "mail name@example.com or noreply@" + "github.com, icon@2x.png, git@github.com:x/y"), []);
assert.strictEqual(rules("a.md", j(["someone", "@", "mail", ".", "net"])).length, 1);

// Calendar private addresses, tokens, keys.
assert.strictEqual(rules("a.js", j(["calendar/ical/abc", "%40", "group.example/private", "-0123456789abcdef0/basic.ics"])).length, 1);
assert.strictEqual(rules("a.js", j(["gh", "p_", "a".repeat(36)])).length, 1);
assert.strictEqual(rules("a.js", j(["github", "_pat_", "A".repeat(30)])).length, 1);
assert.strictEqual(rules("a.js", j(["GOCSPX", "-", "abcdefghijkl"])).length, 1);
assert.strictEqual(rules("a.pem", j(["-----BEGIN ", "OPENSSH PRIVATE KEY-----"])).length, 1);

// Coordinates: only in config/defaults files.
const coord = j(["latitude: 12", ".3456, longitude: -65", ".4321"]);
assert.strictEqual(rules("app/config.js", coord).length, 1);
assert.strictEqual(rules("service/defaults.json", j(['"latitude": 12', ".34"])).length, 1);
assert.deepStrictEqual(rules("app/config.js", "latitude: 12.3, longitude: -65.4"), []);
assert.deepStrictEqual(rules("docs/weather.md", coord), []);

// Denylist: case-insensitive, never echoes the term.
assert.deepStrictEqual(rules("a.md", "Hello from ZQXJVILLE", ["zqxjville"]), ["denylist entry 1"]);

// ES5 fallback: violations in code fail, words in comments and strings do not.
assert.deepStrictEqual(checkFallback("var a = 1; // let the user decide\nvar s = \"const x\";\n/* => */"), []);
assert.strictEqual(checkFallback("var f = x => x;").length, 1);
assert.strictEqual(checkFallback("let a = 1;\nconst b = 2;").length, 2);
assert.strictEqual(checkFallback("var s = `t`;").length, 1);

// Manifest and repository index.
const m = buildManifest({
  appinfo: { id: "com.example.app", version: "1.2.3", type: "web", title: "Home" },
  title: "Example", ipk: Buffer.from("abc"), base: "https://owner.github.io/repo",
  ipkUrl: "https://github.com/owner/repo/releases/download/v1.2.3/com.example.app_1.2.3_all.ipk",
  sourceUrl: "https://github.com/owner/repo",
});
assert.strictEqual(m.ipkHash.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
assert.strictEqual(m.ipkSize, 3);
assert.strictEqual(m.rootRequired, "optional");
assert.strictEqual(m.title, "Example");
const idx = buildIndex(m, "https://owner.github.io/repo");
assert.strictEqual(idx.packages[0].manifestUrl, "https://owner.github.io/repo/repo/com.example.app.manifest.json");
assert.deepStrictEqual(idx.packages[0].manifest, m);

console.log("script helper checks passed");
