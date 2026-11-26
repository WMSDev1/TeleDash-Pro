"use strict";
// The sound the TV is playing, measured for the Music view's visualizers (CONTRACT.md "Playing on
// the TV"). A webOS app cannot read its own sound, but the TV's mixer offers a copy of what it is
// about to send to the speakers as a recording device named "MixerCapture". This file records from
// that device only (found by name: never a microphone), turns each 1/30 s into 64 loudness values
// and a short waveform, and hands those lines to whoever subscribed. Nothing is stored and nothing
// leaves the TV; recording runs only while someone is subscribed (the Music view is open).
// Zero dependencies, Node 8 compatible.
var fs = require("fs");
var childProcess = require("child_process");
var log = require("./util").log;

// The mixer's copy is always 32-bit stereo at 48 kHz. It accepts a request for 16-bit and then
// delivers 32-bit all the same (measured: twice the bytes, and noise where the music should be),
// so 32-bit is asked for and read.
var RATE = 48000, CHANNELS = 2, FORMAT = "S32_LE", FRAME_BYTES = 8;
var FFT = 4096, HOP = 1600;                                  // 1600 samples: 30 lines a second
var BANDS = 64, WAVE = 256, STRIDE = 4, F_MIN = 40, F_MAX = 16000;
var MIN_DB = -90, RANGE_DB = 72;                             // the scale app/viz.js works on
var SILENT = 0.0002;                                         // below this a stretch counts as silence
var LIFT_MAX = 0.4, LIFT_TO = 0.95, LIFT_FALL = 0.03 / 30;   // quiet playback is lifted by up to 29 dB
var DEVICE_NAME = "MixerCapture";
var PCM_LIST = "/proc/asound/pcm";
var MAX_LISTENERS = 4;

// ---------- finding the device ----------

// text: the kernel's list of sound devices, one per line, such as
//   "01-02: MixerCapture snd-soc-dummy-dai-2 :  : capture 1"
// Returns the ALSA name of the mixer's copy ("hw:1,2"), or null when this TV has none.
function findDevice(text) {
  var lines = String(text || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var m = /^(\d+)-(\d+):\s*(\S+)[^:]*:[^:]*:.*\bcapture\b/.exec(lines[i]);
    if (m && m[3] === DEVICE_NAME) return "hw:" + parseInt(m[1], 10) + "," + parseInt(m[2], 10);
  }
  return null;
}

// ---------- measuring ----------

// n + 1 band edges in Hz from fMin to fMax, each band the same musical width (as in app/viz.js).
function bandBins(n, bins, sampleRate, fMin, fMax) {
  var hz = sampleRate / 2 / bins, r = Math.pow(Math.min(fMax, sampleRate / 2) / fMin, 1 / n), out = [];
  for (var i = 0; i < n; i++) {
    var a = fMin * Math.pow(r, i), b = fMin * Math.pow(r, i + 1);
    var lo = Math.min(bins - 1, Math.max(1, Math.round(a / hz)));          // bin 0 is not sound
    var hi = Math.min(bins, Math.max(lo + 1, Math.round(b / hz)));
    out.push([lo, hi, Math.min(bins - 1, Math.sqrt(a * b) / hz)]);
  }
  return out;
}

// In-place radix-2 FFT of re/im (length a power of two), with tables made once per size.
function makeFft(n) {
  var bits = Math.round(Math.log(n) / Math.LN2), rev = new Uint32Array(n);
  var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), i;
  for (i = 0; i < n; i++) {
    var r = 0;
    for (var b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  for (i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  return function (re, im) {
    var j, k, t;
    for (j = 0; j < n; j++) {
      k = rev[j];
      if (k > j) { t = re[j]; re[j] = re[k]; re[k] = t; t = im[j]; im[j] = im[k]; im[k] = t; }
    }
    for (var size = 2; size <= n; size *= 2) {
      var half = size / 2, step = n / size;
      for (var start = 0; start < n; start += size) {
        for (j = 0, k = 0; j < half; j++, k += step) {
          var a = start + j, c = a + half;
          var xr = re[c] * cos[k] + im[c] * sin[k], xi = im[c] * cos[k] - re[c] * sin[k];
          re[c] = re[a] - xr; im[c] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  };
}

// Takes raw recorded sound (32-bit little-endian, two channels) in pieces of any size and calls
// emit(line) once per 1/30 s of it. A line is "-" for silence, otherwise 640 hex characters:
// 64 bytes of loudness (0 to 255 across MIN_DB to MIN_DB + RANGE_DB, low to high pitch), then
// 256 bytes of waveform (128 is the middle), scaled so loud and quiet songs both fill the trace.
function analyser(emit) {
  var fft = makeFft(FFT), bins = bandBins(BANDS, FFT / 2, RATE, F_MIN, F_MAX);
  var last = Math.min(FFT / 2 - 1, bins[BANDS - 1][1]);        // no bin above this is needed
  var windowFn = new Float32Array(FFT), recent = new Float32Array(FFT), fresh = new Float32Array(HOP);
  var re = new Float64Array(FFT), im = new Float64Array(FFT), level = new Float32Array(FFT / 2 + 1);
  var out = Buffer.alloc(BANDS + WAVE), filled = 0, carry = null, top = 0, waveTop = 0.005, i;
  for (i = 0; i < FFT; i++) {                                 // Blackman, as a browser's analyser uses
    var x = 2 * Math.PI * i / FFT;
    windowFn[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  }

  function line() {
    var j, peak = 0;
    for (j = FFT - HOP; j < FFT; j++) { var s = recent[j] < 0 ? -recent[j] : recent[j]; if (s > peak) peak = s; }
    if (peak < SILENT) return "-";
    for (j = 0; j < FFT; j++) { re[j] = recent[j] * windowFn[j]; im[j] = 0; }
    fft(re, im);
    for (j = 1; j <= last; j++) {
      var mag = Math.sqrt(re[j] * re[j] + im[j] * im[j]) / FFT;
      var v = mag > 0 ? (20 * Math.log(mag) / Math.LN10 - MIN_DB) / RANGE_DB : 0;
      level[j] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    // Each band: its loudest bin, or between two bins where a bass band is narrower than one.
    var loudest = 0, heights = [];
    for (j = 0; j < BANDS; j++) {
      var b = bins[j], h = 0;
      if (b[1] - b[0] <= 1) {
        var f = Math.floor(b[2]), k = b[2] - f;
        h = level[f] * (1 - k) + (level[f + 1] || 0) * k;
      } else {
        for (var q = b[0]; q < b[1]; q++) if (level[q] > h) h = level[q];
      }
      heights.push(h);
      if (h > loudest) loudest = h;
    }
    // The volume the music is played at should not decide how tall the picture is: follow the
    // loudest recent band and lift everything by the same amount, within limits.
    top = Math.max(loudest, top - LIFT_FALL);
    var lift = Math.max(0, Math.min(LIFT_MAX, LIFT_TO - top));
    for (j = 0; j < BANDS; j++) out[j] = Math.round(255 * Math.min(1, heights[j] > 0 ? heights[j] + lift : 0));
    // Waveform: the newest stretch, starting where it crosses upwards so the trace stands still.
    var span = WAVE * STRIDE, from = FFT - span, wp = 0;
    for (j = FFT - 2 * span + 1; j < FFT - span; j++) if (recent[j - 1] < 0 && recent[j] >= 0) { from = j; break; }
    for (j = 0; j < WAVE; j++) { var a = recent[from + j * STRIDE]; if (a < 0) a = -a; if (a > wp) wp = a; }
    waveTop = Math.max(wp, waveTop * 0.985, 0.005);
    var gain = 0.85 / waveTop;
    for (j = 0; j < WAVE; j++) {
      var w = recent[from + j * STRIDE] * gain;
      out[BANDS + j] = Math.round(128 + 127 * (w < -1 ? -1 : w > 1 ? 1 : w));
    }
    return out.toString("hex");
  }

  return {
    push: function (chunk) {
      if (carry) { chunk = Buffer.concat([carry, chunk]); carry = null; }
      var frames = Math.floor(chunk.length / FRAME_BYTES);
      if (chunk.length % FRAME_BYTES) carry = chunk.slice(frames * FRAME_BYTES);
      for (var n = 0, o = 0; n < frames; n++, o += FRAME_BYTES) {
        // The top 24 bits of each channel, read by hand (much faster than readInt32LE here).
        var l = chunk[o + 1] | (chunk[o + 2] << 8) | ((chunk[o + 3] << 24) >> 8);
        var r = chunk[o + 5] | (chunk[o + 6] << 8) | ((chunk[o + 7] << 24) >> 8);
        fresh[filled++] = (l + r) / 16777216;
        if (filled < HOP) continue;
        filled = 0;
        recent.copyWithin(0, HOP);
        recent.set(fresh, FFT - HOP);
        // A backlog (the TV was busy) is skipped rather than measured: only the newest sound matters.
        if (frames - n <= 2 * HOP) emit(line());
      }
    }
  };
}

// ---------- recording, shared by everyone listening ----------

var spawn = childProcess.spawn;
var readList = function () { return fs.readFileSync(PCM_LIST, "utf8"); };
var listeners = [], recorder = null;

function device() {
  try { return findDevice(readList()); } catch (e) { return null; }
}

function stopRecorder() {
  var r = recorder;
  recorder = null;
  if (r) { try { r.kill(); } catch (e) { /* already gone */ } }
}

function ended(r, why) {
  if (recorder !== r) return;
  recorder = null;
  if (why) log("sound: the recorder stopped (" + why + ")");
  var gone = listeners;
  listeners = [];
  gone.forEach(function (l) { try { l.onEnd(); } catch (e) { /* their problem */ } });
}

function startRecorder(dev) {
  var an = analyser(function (text) {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i].onLine(text); } catch (e) { /* their problem */ } }
  });
  var r;
  try {
    r = spawn("arecord", ["-q", "-D", dev, "-f", FORMAT, "-r", String(RATE), "-c", String(CHANNELS), "-t", "raw",
      "--period-time=20000", "--buffer-time=200000"], { stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) { return false; }
  recorder = r;
  r.stdout.on("data", function (chunk) { if (recorder === r) an.push(chunk); });
  r.on("error", function (e) { ended(r, e && e.code ? e.code : "could not start"); });
  r.on("exit", function (code) { ended(r, "exit " + code); });
  return true;
}

// Starts handing sound lines to onLine(text) (see analyser). onEnd() is called if the recording
// stops by itself. Returns a function that stops listening, or null when this TV offers no sound
// to record (or too many are listening already).
function subscribe(onLine, onEnd) {
  if (listeners.length >= MAX_LISTENERS) return null;
  if (!recorder) {
    var dev = device();
    if (!dev || !startRecorder(dev)) return null;
  }
  var me = { onLine: onLine, onEnd: onEnd || function () {} };
  listeners.push(me);
  return function () {
    var i = listeners.indexOf(me);
    if (i < 0) return;
    listeners.splice(i, 1);
    if (!listeners.length) stopRecorder();
  };
}

module.exports = {
  subscribe: subscribe, device: device, findDevice: findDevice, analyser: analyser,
  RATE: RATE, HOP: HOP, BANDS: BANDS, WAVE: WAVE, DEVICE_NAME: DEVICE_NAME,
  _bandBins: bandBins, _makeFft: makeFft,
  _stub: function (spawnFn, listFn) { spawn = spawnFn || childProcess.spawn; if (listFn) readList = listFn; listeners = []; recorder = null; }
};
