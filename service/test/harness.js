"use strict";
// Tiny test harness: a fresh private data dir per test file, and async test cases run in order.
// Usage: var t = require("./harness"); t.test("name", function () { ... }); t.run();
var fs = require("fs");
var os = require("os");
var path = require("path");

// Must happen before any lib module is required: config.js reads TELEDASH_DATA once.
var dir = fs.mkdtempSync(path.join(os.tmpdir(), "teledash-test-"));
process.env.TELEDASH_DATA = path.join(dir, "data");

var cases = [];
function test(name, fn) { cases.push({ name: name, fn: fn }); }

function cleanup() {
  try { (fs.rmSync || fs.rmdirSync).call(fs, dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

function run() {
  var failed = 0, i = 0;
  function next() {
    if (i >= cases.length) {
      cleanup();
      console.log(failed ? failed + " failed" : "all " + cases.length + " passed");
      process.exit(failed ? 1 : 0);
    }
    var c = cases[i++];
    Promise.resolve().then(c.fn).then(function () { console.log("ok   " + c.name); }, function (e) {
      failed++;
      console.log("FAIL " + c.name + "\n     " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n     ") : e));
    }).then(next);
  }
  next();
}

// Expects fn (sync, or returning a promise) to fail with an error whose message matches re.
function rejects(fn, re, status) {
  return Promise.resolve().then(fn).then(function () { throw new Error("expected an error matching " + re); }, function (e) {
    if (!re.test(e.message)) throw new Error("error \"" + e.message + "\" does not match " + re);
    if (status && e.status !== status) throw new Error("status " + e.status + ", expected " + status);
  });
}

module.exports = { test: test, run: run, rejects: rejects, dir: dir };
