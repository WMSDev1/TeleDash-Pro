"use strict";
// The TV's sound, measured for the visualizers (lib/sound.js): which device is recorded from, what
// a line of the stream holds, and when the recorder runs. No sound device is touched: the list of
// devices and the recorder are stand-ins.
var t = require("./harness");
var assert = require("assert");
var EventEmitter = require("events").EventEmitter;
var sound = require("../lib/sound");

var TV_LIST = [
  "00-00: lg115x.0 lg115x-codec-dai.0-0 :  : playback 1",
  "00-12: Capture for dsnoop snd-soc-dummy-dai-12 :  : capture 1",
  "01-00: WoV PDM Mic snd-soc-dummy-dai-0 :  : capture 1",
  "01-02: MixerCapture snd-soc-dummy-dai-2 :  : capture 1",
  "01-03: SoundEngineCapture snd-soc-dummy-dai-3 :  : capture 1"
].join("\n") + "\n";

// secs of a sine wave as the TV delivers sound: 32-bit little-endian, two channels, 48 kHz.
function tone(hz, amplitude, secs, from) {
  var n = Math.round(sound.RATE * secs), b = Buffer.alloc(n * 8);
  for (var i = 0; i < n; i++) {
    var v = Math.round(amplitude * Math.sin(2 * Math.PI * hz * ((from || 0) + i) / sound.RATE) * 2147483647);
    b.writeInt32LE(v, i * 8);
    b.writeInt32LE(v, i * 8 + 4);
  }
  return b;
}
function loudest(line) {
  var b = Buffer.from(line, "hex"), at = 0;
  for (var i = 1; i < sound.BANDS; i++) if (b[i] > b[at]) at = i;
  return { band: at, value: b[at], bytes: b };
}
// Feeds sound a 1/30 s at a time, as a recorder would, and returns the lines.
function measure(pcm, pieceBytes) {
  var lines = [], an = sound.analyser(function (l) { lines.push(l); });
  for (var o = 0; o < pcm.length; o += pieceBytes) an.push(pcm.slice(o, o + pieceBytes));
  return lines;
}

t.test("device: the mixer's copy is found by name, and nothing else ever is", function () {
  assert.strictEqual(sound.findDevice(TV_LIST), "hw:1,2");
  assert.strictEqual(sound.findDevice(TV_LIST.replace("MixerCapture", "SomethingElse")), null, "never a microphone or another device");
  assert.strictEqual(sound.findDevice("01-02: MixerCapture snd-soc-dummy-dai-2 :  : playback 1\n"), null, "a playback device is not a recording");
  assert.strictEqual(sound.findDevice("00-07: MixerCapture x :  : capture 1\n"), "hw:0,7");
  assert.strictEqual(sound.findDevice(""), null);
  assert.strictEqual(sound.findDevice(undefined), null);
});

t.test("lines: thirty a second, each 64 loudness bytes and 256 waveform bytes", function () {
  var lines = measure(tone(1000, 0.25, 1), sound.HOP * 8);
  assert.strictEqual(lines.length, 30);
  lines.forEach(function (l) { assert.ok(/^[0-9a-f]{640}$/.test(l), "640 hex characters"); });
  var top = loudest(lines[29]);
  // Band i starts at 40 Hz x 400^(i/64): 1000 Hz falls in band 34.
  assert.strictEqual(top.band, 34);
  assert.ok(top.value > 230, "a clear tone stands near the top: " + top.value);
  assert.strictEqual(top.bytes[5], 0, "nothing in the bass");
  assert.strictEqual(top.bytes[60], 0, "nothing in the treble");
  var wave = top.bytes.slice(sound.BANDS), hi = Math.max.apply(null, wave), lo = Math.min.apply(null, wave);
  assert.ok(hi > 225 && lo < 31, "the waveform fills the trace: " + lo + " to " + hi);
  assert.ok(Math.abs(wave[0] - 128) < 20 && wave[1] > wave[0], "it starts where the sound crosses upwards");
});

t.test("lines: pitch lands in the right band from bass to treble", function () {
  [[60, 5], [250, 19], [4000, 49], [12000, 60]].forEach(function (c) {
    var lines = measure(tone(c[0], 0.25, 0.5), sound.HOP * 8);
    assert.ok(Math.abs(loudest(lines[lines.length - 1]).band - c[1]) <= 1, c[0] + " Hz in band " + loudest(lines[lines.length - 1]).band);
  });
});

t.test("lines: quiet playback is lifted, silence is a dash", function () {
  var quiet = loudest(measure(tone(1000, 0.005, 1), sound.HOP * 8)[29]);   // 34 dB quieter
  assert.strictEqual(quiet.band, 34);
  assert.ok(quiet.value > 190 && quiet.value < 230, "lifted most of the way: " + quiet.value);
  var wave = quiet.bytes.slice(sound.BANDS);
  assert.ok(Math.max.apply(null, wave) > 225, "and its waveform still fills the trace");
  var lines = measure(Buffer.alloc(sound.HOP * 8 * 6), sound.HOP * 8);
  assert.deepStrictEqual(lines, ["-", "-", "-", "-", "-", "-"]);
});

t.test("lines: the size of the pieces does not matter, and a backlog is skipped", function () {
  var pcm = tone(440, 0.2, 0.5);
  assert.deepStrictEqual(measure(pcm, 4099), measure(pcm, sound.HOP * 8), "odd pieces, same lines");
  assert.deepStrictEqual(measure(pcm, 4096), measure(pcm, sound.HOP * 8));
  var late = measure(tone(440, 0.2, 2), sound.RATE * 8 * 2);                  // two seconds at once
  assert.ok(late.length <= 2, "only the newest sound is measured: " + late.length);
});

// ---------- the recorder ----------

function fakeRecorder() {
  var made = [];
  function spawn(cmd, args, opts) {
    var p = new EventEmitter();
    p.cmd = cmd; p.args = args; p.opts = opts; p.killed = 0;
    p.stdout = new EventEmitter();
    p.kill = function () { p.killed++; };
    made.push(p);
    return p;
  }
  return { spawn: spawn, made: made };
}

t.test("recorder: runs only while someone listens, and is shared", function () {
  var f = fakeRecorder();
  sound._stub(f.spawn, function () { return TV_LIST; });
  var a = [], b = [];
  var stopA = sound.subscribe(function (l) { a.push(l); });
  assert.strictEqual(typeof stopA, "function");
  assert.strictEqual(f.made.length, 1);
  assert.strictEqual(f.made[0].cmd, "arecord");
  var args = f.made[0].args.join(" ");
  assert.ok(/-D hw:1,2 /.test(args), args);
  assert.ok(/-f S32_LE -r 48000 -c 2 -t raw/.test(args), "32-bit, as the TV really delivers it: " + args);
  assert.strictEqual(f.made[0].opts.stdio[0], "ignore");
  var stopB = sound.subscribe(function (l) { b.push(l); });
  assert.strictEqual(f.made.length, 1, "one recorder for both");
  f.made[0].stdout.emit("data", Buffer.alloc(sound.HOP * 8));
  assert.deepStrictEqual([a, b], [["-"], ["-"]]);
  stopA(); stopA();                                            // twice is harmless
  assert.strictEqual(f.made[0].killed, 0, "still one listener");
  f.made[0].stdout.emit("data", Buffer.alloc(sound.HOP * 8));
  assert.deepStrictEqual([a, b], [["-"], ["-", "-"]]);
  stopB();
  assert.strictEqual(f.made[0].killed, 1, "nobody listening: recording stops");
  f.made[0].emit("exit", null);                                // its exit after being stopped is not news
  var stopC = sound.subscribe(function () {});
  assert.strictEqual(f.made.length, 2, "a new listener starts a new recorder");
  stopC();
});

t.test("recorder: tells listeners when it stops by itself", function () {
  var f = fakeRecorder(), ended = 0;
  sound._stub(f.spawn, function () { return TV_LIST; });
  var stop = sound.subscribe(function () {}, function () { ended++; });
  f.made[0].emit("exit", 1);
  assert.strictEqual(ended, 1);
  stop();                                                      // nothing left to stop
  assert.strictEqual(f.made[0].killed, 0);
  assert.strictEqual(typeof sound.subscribe(function () {}), "function", "and the next listener starts afresh");
  assert.strictEqual(f.made.length, 2);
});

t.test("recorder: no mixer copy on this machine means no recording at all", function () {
  var f = fakeRecorder();
  sound._stub(f.spawn, function () { return "01-00: WoV PDM Mic snd-soc-dummy-dai-0 :  : capture 1\n"; });
  assert.strictEqual(sound.subscribe(function () {}), null);
  sound._stub(f.spawn, function () { throw new Error("no such file"); });
  assert.strictEqual(sound.subscribe(function () {}), null);
  assert.strictEqual(sound.device(), null);
  assert.strictEqual(f.made.length, 0, "nothing was started");
});

t.test("recorder: at most four listeners", function () {
  var f = fakeRecorder(), stops = [];
  sound._stub(f.spawn, function () { return TV_LIST; });
  for (var i = 0; i < 4; i++) stops.push(sound.subscribe(function () {}));
  assert.ok(stops.every(function (s) { return typeof s === "function"; }));
  assert.strictEqual(sound.subscribe(function () {}), null);
  stops.forEach(function (s) { s(); });
  sound._stub();
});

t.run();
