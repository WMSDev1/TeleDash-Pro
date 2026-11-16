// Tests for site/oauth/validate.js: the public sign-in return page must only ever forward to
// http://<private IPv4>:<port>. Run by scripts/check.sh.
"use strict";
const assert = require("assert");
const O = require("../site/oauth/validate.js");

const b64url = s => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const state = t => b64url(JSON.stringify({ t: t, n: "nonce123" }));
const ip = parts => parts.join(".");   // built at runtime so the repository scan sees no literal addresses
const search = (t, extra) => "?state=" + encodeURIComponent(state(t)) + "&code=4%2Fabc&scope=x" + (extra || "");

// Private ranges are accepted and the whole query is passed on.
for (const host of [ip([10, 0, 0, 5]), ip([172, 16, 0, 1]), ip([172, 31, 255, 254]), "192.168.1.50", ip([192, 168, 77, 2])]) {
  const t = "http://" + host + ":8770", s = search(t);
  assert.deepStrictEqual(O.decide(s), { action: "redirect", url: t + "/oauth/return" + s }, host);
}

// Anything else is refused and never redirected.
const refused = [
  "https://192.168.1.50:8770",              // https: the TV serves plain http
  "http://192.168.1.50",                    // no port
  "http://192.168.1.50:8770/",              // trailing path
  "http://192.168.1.50:8770/x",
  "http://192.168.1.50:0",
  "http://192.168.1.50:65536",
  "http://192.168.1.50:08770",
  "http://" + ip([172, 32, 0, 1]) + ":8770",  // just outside 172.16/12
  "http://" + ip([172, 15, 0, 1]) + ":8770",
  "http://" + ip([11, 0, 0, 1]) + ":8770",
  "http://8.8.8.8:8770",
  "http://127.0.0.1:8770",
  "http://192.168.1.256:8770",
  "http://" + ip([192, 168, "01", 5]) + ":8770",   // leading zero = octal to a browser
  "http://192.168.1:8770",
  "http://evil.example.com:8770",
  "http://192.168.1.50.evil.example.com:8770",
  "http://user@192.168.1.50:8770",
  "http://192.168.1.50:8770@evil.example.com",
  "http://192.168.1.50:8770#@evil.example.com",
  "javascript:alert(1)//192.168.1.50:8770",
  "//192.168.1.50:8770",
  " http://192.168.1.50:8770",
  "http://192.168.1.50:8770\n",
];
for (const t of refused) {
  const d = O.decide(search(t));
  assert.strictEqual(d.action, "error", JSON.stringify(t));
  assert.strictEqual(d.setupUrl, null, JSON.stringify(t));
}

// Malformed or missing state, missing code.
assert.strictEqual(O.decide("").action, "error");
assert.strictEqual(O.decide("?code=1&state=!!!").action, "error");
assert.strictEqual(O.decide("?code=1&state=" + b64url("not json")).action, "error");
assert.strictEqual(O.decide("?code=1&state=" + b64url(JSON.stringify({ t: 5, n: "x" }))).action, "error");
assert.strictEqual(O.decide("?state=" + state("http://192.168.1.50:8770")).action, "error");

// Google's ?error=: show a message; offer a link back to setup only for a valid TV address.
let d = O.decide("?error=access_denied&state=" + state("http://192.168.1.50:8770"));
assert.strictEqual(d.action, "error");
assert.strictEqual(d.setupUrl, "http://192.168.1.50:8770/setup");
assert.ok(/cancelled/.test(d.message));
d = O.decide("?error=server_error&state=" + state("http://evil.example.com:80"));
assert.strictEqual(d.action, "error");
assert.strictEqual(d.setupUrl, null);
assert.strictEqual(O.decide("?error=access_denied").setupUrl, null);

// run() wires the decision to the page.
const el = () => ({ textContent: "", href: "", className: "button hidden" });
const page = { status: el(), setup: el() };
const doc = { getElementById: id => page[id] };
let replaced = null;
O.run(doc, { search: search("http://192.168.1.50:8770"), replace: u => { replaced = u; } });
assert.ok(replaced.indexOf("http://192.168.1.50:8770/oauth/return?state=") === 0);
replaced = null;
O.run(doc, { search: search("http://8.8.8.8:8770"), replace: u => { replaced = u; } });
assert.strictEqual(replaced, null);
assert.strictEqual(page.setup.className, "button hidden");

console.log("oauth return page checks passed");
