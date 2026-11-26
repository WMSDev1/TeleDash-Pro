// Pure logic of the visualizers (app/viz.js): how a measured spectrum becomes 64 bar heights, how
// the bars move, the colours taken from artwork, and the made-up beat.
const assert = require("assert");
const V = require("../app/viz.js");

// Band edges: evenly spaced in pitch, from the lowest to the highest frequency.
const e = V._bandEdges(64, 40, 16000);
assert.strictEqual(e.length, 65);
assert.ok(Math.abs(e[0] - 40) < 1e-9 && Math.abs(e[64] - 16000) < 1e-6);
assert.ok(Math.abs(e[1] / e[0] - e[64] / e[63]) < 1e-9, "each band is the same musical width");

// Bins: every band covers at least one bin, in order, never bin 0, never past the end.
[[2048, 48000], [2048, 44100], [1024, 44100]].forEach(function (c) {
  const bins = V._bandBins(64, c[0], c[1], 40, 16000);
  assert.strictEqual(bins.length, 64);
  bins.forEach(function (b, i) {
    assert.ok(b[0] >= 1 && b[1] > b[0] && b[1] <= c[0], "band " + i + " " + b);
    assert.ok(b[2] > 0 && b[2] <= c[0] - 1);
    if (i) assert.ok(b[0] >= bins[i - 1][0] && b[2] > bins[i - 1][2], "bands rise in order");
  });
  const hz = c[1] / 2 / c[0];
  assert.ok(bins[63][1] * hz <= 16000 + hz, "nothing above the top frequency");
});

// Levels: silence is zero, full scale is one, and the treble is lifted over the bass.
const bins = V._bandBins(64, 2048, 48000, 40, 16000);
const out = new Float32Array(64);
V._bandLevels(new Uint8Array(2048), bins, out);
assert.ok(Array.prototype.every.call(out, function (v) { return v === 0; }));
V._bandLevels(new Uint8Array(2048).fill(255), bins, out);
assert.ok(out[40] === 1 && out[63] === 1);
V._bandLevels(new Uint8Array(2048).fill(128), bins, out);
assert.ok(out[0] < out[32] && out[32] < out[63], "an even spectrum tilts up towards the treble");
assert.ok(Array.prototype.every.call(out, function (v) { return v >= 0 && v <= 1; }));
// One loud bin lights its own band and leaves the far ones dark.
const one = new Uint8Array(2048); one[bins[50][0]] = 255;
V._bandLevels(one, bins, out);
assert.ok(out[50] > 0.9 && out[10] === 0 && out[63] === 0);
assert.strictEqual(V._shape(0, 63, 64), 0, "silence stays silent in the treble too");

// Movement: up almost at once, down slowly, and never past the target.
assert.ok(V._smooth(0, 1, 1 / 60) > 0.4);
assert.strictEqual(V._smooth(0, 1, 1), 1);
const fall = V._smooth(1, 0, 1 / 60);
assert.ok(fall < 1 && fall > 0.9);
assert.strictEqual(V._smooth(0.5, 0.49, 1), 0.49);

// Colours from artwork: strong colours win, greys are ignored, and three always come back.
function px(list) { const a = []; list.forEach(function (c) { for (let i = 0; i < c[3]; i++) a.push(c[0], c[1], c[2], 255); }); return a; }
assert.strictEqual(V._pickPalette(px([[128, 128, 128, 50], [0, 0, 0, 50], [255, 255, 255, 50]])), null);
const p = V._pickPalette(px([[200, 20, 20, 60], [20, 40, 220, 30], [30, 200, 60, 10], [120, 120, 120, 200]]));
assert.strictEqual(p.length, 3);
assert.ok(p[0][0] === 255 && p[0][1] < 80, "red first: " + p[0]);
assert.ok(p[1][2] === 255, "then blue: " + p[1]);
assert.ok(p[2][1] === 255, "then green: " + p[2]);
const single = V._pickPalette(px([[200, 20, 20, 60]]));
assert.ok(single[1][1] > single[0][1] && single[2][1] > single[1][1], "one colour is lightened twice");

// The made-up beat: silent while paused, within range while playing.
const raw = new Float32Array(64), wave = new Float32Array(256);
V._synth(raw, wave, 12.3, true);
assert.ok(Array.prototype.every.call(raw, function (v) { return v >= 0 && v <= 1; }));
assert.ok(Array.prototype.some.call(raw, function (v) { return v > 0.2; }));
V._synth(raw, wave, 12.3, false);
assert.ok(Array.prototype.every.call(raw, function (v) { return v === 0; }) && Array.prototype.every.call(wave, function (v) { return v === 0; }));

// The helper's sound stream: one line is 64 loudness bytes then 256 waveform bytes, as hex.
(function () {
  const levels = new Float32Array(V.BANDS), wave = new Float32Array(V.WAVE);
  const bytes = Buffer.alloc(V.BANDS + V.WAVE, 128);
  bytes[0] = 0; bytes[1] = 255; bytes[63] = 51;
  bytes[V.BANDS] = 255; bytes[V.BANDS + 1] = 1; bytes[V.BANDS + 255] = 128;
  assert.strictEqual(V._readLine(bytes.toString("hex"), levels, wave), "loud");
  assert.strictEqual(levels[0], 0);
  assert.strictEqual(levels[1], 1);
  assert.ok(Math.abs(levels[63] - 0.2) < 1e-6);
  assert.strictEqual(wave[0], 1);
  assert.strictEqual(wave[1], -1);
  assert.strictEqual(wave[255], 0);
  // Silence empties both; anything else is ignored and leaves the last picture alone.
  assert.strictEqual(V._readLine("-", levels, wave), "silent");
  assert.ok(Array.prototype.every.call(levels, function (v) { return v === 0; }) && Array.prototype.every.call(wave, function (v) { return v === 0; }));
  levels[3] = 0.5;
  ["", "abc", bytes.toString("hex").slice(2), bytes.toString("hex") + "00", bytes.toString("hex").replace(/^../, "zz"), null, 7].forEach(function (bad) {
    assert.strictEqual(V._readLine(bad, levels, wave), "", String(bad).slice(0, 12));
  });
  assert.strictEqual(levels[3], 0.5);
  assert.strictEqual(typeof V.sound, "function");
  V.sound("not a line");                                        // never throws
})();

// Waterfall colours: black for silence, then the palette's three colours in turn.
(function () {
  const p = [[10, 20, 30], [100, 110, 120], [200, 210, 220]], c = [0, 0, 0];
  assert.deepStrictEqual(Array.from(V._heat(0, p, c)), [0, 0, 0]);
  assert.deepStrictEqual(Array.from(V._heat(1 / 3, p, c)).map(Math.round), [10, 20, 30]);
  assert.deepStrictEqual(Array.from(V._heat(2 / 3, p, c)).map(Math.round), [100, 110, 120]);
  assert.deepStrictEqual(Array.from(V._heat(1, p, c)).map(Math.round), [200, 210, 220]);
  assert.deepStrictEqual(Array.from(V._heat(7, p, c)).map(Math.round), [200, 210, 220], "never past the last colour");
  assert.deepStrictEqual(Array.from(V._heat(1 / 6, p, c)), [5, 10, 15]);
})();

// A meter needle: it reaches the level, overshoots a little on the way, and stays inside its stops.
(function () {
  const n = { p: 0, v: 0 };
  let top = 0;
  for (let i = 0; i < 120; i++) { V._swing(n, 0.6, 1 / 60); top = Math.max(top, n.p); }
  assert.ok(Math.abs(n.p - 0.6) < 0.01, "settles on the level: " + n.p);
  assert.ok(top > 0.6 && top < 0.72, "a small overshoot: " + top);
  for (let i = 0; i < 60; i++) V._swing(n, 5, 0.1);             // a wild level and slow frames
  assert.ok(n.p <= 1.06 && isFinite(n.v), "held by the end stop");
  for (let i = 0; i < 60; i++) V._swing(n, -5, 0.1);
  assert.ok(n.p >= -0.04);
})();

// Every visualizer draws without error, with sound and in silence, on a normal and a slow screen.
// The canvas is a stand-in that accepts any drawing call.
(function () {
  let calls = 0;
  function context() {
    const state = {};
    return new Proxy(state, {
      get: function (t, k) {
        if (k in t) return t[k];
        if (k === "createImageData") return function (w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; };
        if (k === "getImageData") return function (x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; };
        if (k === "createLinearGradient") return function () { return { addColorStop: function () {} }; };
        return function () { calls++; };
      },
      set: function (t, k, v) { t[k] = v; return true; }
    });
  }
  function canvas() { const cx = context(); return { width: 1920, height: 1080, getContext: function () { return cx; } }; }
  let frameFn = null, clock = 1000;
  global.document = { createElement: canvas, hidden: false };
  global.requestAnimationFrame = function (fn) { frameFn = fn; };
  function run(frames, ms) { for (let i = 0; i < frames; i++) { clock += ms; frameFn(clock); } }
  assert.deepStrictEqual(V.KINDS, ["bars", "scope", "radial", "particles", "plasma", "waterfall", "tunnel", "ripples", "meters", "off"]);
  const names = [];
  V.setPlaying(true);
  V.start(canvas());
  for (let k = 0; k < V.KINDS.length; k++) {
    const before = calls;
    run(40, 16);                                                // the made-up beat
    V.setPlaying(false); run(240, 16); V.setPlaying(true);     // four seconds of silence, then sound again
    run(20, 16);
    if (V.stats().kind !== "off") assert.ok(calls > before, V.stats().kind + " drew something");
    names.push(V.next());
  }
  assert.strictEqual(new Set(names).size, V.KINDS.length, "each has its own name");
  assert.strictEqual(V.stats().low, false);
  run(260, 60);                                                 // 17 frames a second: the slow-screen settings
  assert.strictEqual(V.stats().low, true);
  for (let k = 0; k < V.KINDS.length; k++) { run(30, 60); V.next(); }
  V.stop();
  delete global.document; delete global.requestAnimationFrame;
})();

console.log("viz checks passed");
