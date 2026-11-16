"use strict";
// Night mode's picture: saved, dimmed, restored. A fake luna-send on PATH stands in for the TV.
var t = require("./harness");
var assert = require("assert");
var fs = require("fs");
var path = require("path");

var bin = path.join(t.dir, "bin"), calls = path.join(t.dir, "luna-calls");
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(process.env.TELEDASH_DATA, { recursive: true });
// Answers getSystemSettings with the owner's picture, everything else with success.
fs.writeFileSync(path.join(bin, "luna-send"), [
  "#!/bin/sh",
  'echo "$3 $4" >> "' + calls + '"',
  'case "$3" in *getSystemSettings) echo \'{"returnValue":true,"settings":{"backlight":65,"contrast":95,"brightness":50,"energySaving":"min"}}\' ;;',
  '  *) echo \'{"returnValue":true}\' ;; esac', ""].join("\n"), { mode: 493 });
process.env.PATH = bin + ":" + process.env.PATH;

var tv = require("../lib/tv");
var saved = path.join(process.env.TELEDASH_DATA, "picture-day.json");
function log() { try { return fs.readFileSync(calls, "utf8").trim().split("\n"); } catch (e) { return []; } }
function sets() { return log().filter(function (l) { return /setSystemSettings/.test(l); }).map(function (l) { return JSON.parse(l.slice(l.indexOf("{"))).settings; }); }

t.test("off with nothing saved leaves the picture alone", function () {
  return tv.nightPicture(false).then(function (r) {
    assert.deepStrictEqual(r, { night: false, changed: false });
    assert.strictEqual(log().length, 0);
  });
});

t.test("on saves the owner's picture once and dims", function () {
  return tv.nightPicture(true).then(function (r) {
    assert.deepStrictEqual(r, { night: true, changed: true });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(saved, "utf8")), { backlight: 65, contrast: 95, brightness: 50, energySaving: "min" });
    assert.deepStrictEqual(sets()[0], tv.NIGHT_PICTURE);
    return tv.nightPicture(true);                       // again: the saved values are kept, not re-read
  }).then(function () {
    assert.strictEqual(log().filter(function (l) { return /getSystemSettings/.test(l); }).length, 1);
  });
});

t.test("off restores the saved picture and forgets it", function () {
  return tv.nightPicture(false).then(function (r) {
    assert.deepStrictEqual(r, { night: false, changed: true });
    var s = sets();
    assert.deepStrictEqual(s[s.length - 1], { backlight: 65, contrast: 95, brightness: 50, energySaving: "min" });
    assert.ok(!fs.existsSync(saved));
  });
});

t.test("calls run in the order they came", function () {
  fs.writeFileSync(calls, "");
  return Promise.all([tv.nightPicture(true), tv.nightPicture(false)]).then(function (r) {
    assert.strictEqual(r[0].night, true); assert.strictEqual(r[1].night, false);
    var s = sets();
    assert.strictEqual(s[0].backlight, 0); assert.strictEqual(s[1].backlight, 65);
  });
});

t.run();
