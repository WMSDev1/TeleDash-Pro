// The visualizers behind the Music view (CONTRACT.md "Music view"). Everything drawn here reads one
// small "frame": 64 loudness values spaced evenly in pitch, a short waveform, and a beat pulse.
// Where the frame comes from is a separate matter:
//   - Viz.feed({ bands, wave })   real sound, measured elsewhere (the helper on a TV)
//   - Viz.capture("tab" | "mic")  real sound from this computer, for previewing in a browser
//   - otherwise a made-up beat, so there is something to look at; frame.live says which
//   Viz.start(canvas) / stop()    draw while the Music view is open
//   Viz.next()                    switch to the next visualizer; returns its name
var Viz = (function () {
  var BANDS = 64, WAVE = 256, F_MIN = 40, F_MAX = 16000, FFT = 4096;
  // How a measured spectrum becomes bar heights. Music carries less energy the higher you go
  // (about 3 dB less per octave), so TILT lifts the treble and eases the bass until an even mix
  // draws level; FLOOR hides hiss; GAMMA spreads loud and quiet apart.
  var RANGE_DB = 72, TILT = 3 / RANGE_DB, FLOOR = 0.1, GAMMA = 1.4;
  // Movement: bars jump up at once and sink slowly; a peak marker hangs, then falls.
  var ATTACK = 28, FALL = 1.1, FALL_REL = 2.2, PEAK_HOLD = 0.45, PEAK_FALL = 0.9;
  var KINDS = [["bars", "Spectrum bars"], ["scope", "Oscilloscope"], ["radial", "Radial"],
    ["particles", "Particles"], ["plasma", "Plasma"], ["off", "Off"]];
  var OCTAVES = Math.log(F_MAX / F_MIN) / Math.LN2;

  // ---- pure helpers (also used by test/viz.test.js) ----

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  // n + 1 band edges in Hz from fMin to fMax, each band the same musical width.
  function bandEdges(n, fMin, fMax) {
    var e = [], r = Math.pow(fMax / fMin, 1 / n);
    for (var i = 0; i <= n; i++) e.push(fMin * Math.pow(r, i));
    return e;
  }
  // For each band, the slice of FFT bins it covers: [first, end, centre]. Bass bands are
  // narrower than one bin, so those are read at their centre, between two bins.
  function bandBins(n, bins, sampleRate, fMin, fMax) {
    var hz = sampleRate / 2 / bins, e = bandEdges(n, fMin, Math.min(fMax, sampleRate / 2)), out = [];
    for (var i = 0; i < n; i++) {
      var lo = Math.min(bins - 1, Math.max(1, Math.round(e[i] / hz)));       // bin 0 is not sound
      var hi = Math.min(bins, Math.max(lo + 1, Math.round(e[i + 1] / hz)));
      out.push([lo, hi, Math.min(bins - 1, Math.sqrt(e[i] * e[i + 1]) / hz)]);
    }
    return out;
  }
  // One band's height (0 to 1) from its loudness on the analyser's scale (0 to 1, in decibels).
  function shape(v, i, n) {
    if (v <= 0) return 0;
    v += TILT * OCTAVES * ((i + 0.5) / n - 0.5);
    return Math.pow(clamp01((v - FLOOR) / (1 - FLOOR)), GAMMA);
  }
  // bytes: the analyser's spectrum (0 to 255 per bin). Fills out[] with band heights.
  function bandLevels(bytes, bins, out) {
    for (var i = 0; i < bins.length; i++) {
      var b = bins[i], v = 0;
      if (b[1] - b[0] <= 1) {
        var f = Math.floor(b[2]), k = b[2] - f;
        v = (bytes[f] || 0) * (1 - k) + (bytes[f + 1] || 0) * k;
      } else {
        for (var j = b[0]; j < b[1]; j++) if (bytes[j] > v) v = bytes[j];
      }
      out[i] = shape(v / 255, i, bins.length);
    }
    return out;
  }
  // Where a bar is one frame later: up fast, down slowly (faster from high up).
  function smooth(cur, target, dt) {
    if (target > cur) return cur + (target - cur) * Math.min(1, dt * ATTACK);
    return Math.max(target, cur - dt * (FALL + cur * FALL_REL));
  }
  // Three strong colours from a picture's pixels (RGBA bytes), or null when it is all grey.
  function pickPalette(px) {
    var B = 12, w = [], r = [], g = [], b = [], i;
    for (i = 0; i < B; i++) { w.push(0); r.push(0); g.push(0); b.push(0); }
    for (i = 0; i + 3 < px.length; i += 4) {
      var R = px[i], G = px[i + 1], Bl = px[i + 2], mx = Math.max(R, G, Bl), mn = Math.min(R, G, Bl);
      if (!mx || px[i + 3] < 128) continue;
      var sat = (mx - mn) / mx, wt = sat * sat * (mx / 255);
      if (wt < 0.03) continue;
      var d = mx - mn, h = mx === R ? ((G - Bl) / d + 6) % 6 : mx === G ? (Bl - R) / d + 2 : (R - G) / d + 4;
      var k = Math.floor(h / 6 * B) % B;
      w[k] += wt; r[k] += R * wt; g[k] += G * wt; b[k] += Bl * wt;
    }
    var order = [];
    for (i = 0; i < B; i++) if (w[i] > 0) order.push(i);
    order.sort(function (x, y) { return w[y] - w[x]; });
    if (!order.length) return null;
    var out = [];
    for (i = 0; i < 3; i++) {
      var q = order[Math.min(i, order.length - 1)];
      var c = [r[q] / w[q], g[q] / w[q], b[q] / w[q]], top = Math.max(c[0], c[1], c[2], 1), s = 255 / top;
      c = [Math.max(0, top + (c[0] - top) * 1.4), Math.max(0, top + (c[1] - top) * 1.4), Math.max(0, top + (c[2] - top) * 1.4)];
      // A second or third pick from the same colour is lightened, so the three still differ.
      var lift = i >= order.length ? 0.35 * (i - order.length + 1) : 0;
      out.push([Math.round(c[0] * s + (255 - c[0] * s) * lift), Math.round(c[1] * s + (255 - c[1] * s) * lift),
        Math.round(c[2] * s + (255 - c[2] * s) * lift)]);
    }
    return out;
  }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function rgb(c, a) {
    var s = Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]);
    return a == null ? "rgb(" + s + ")" : "rgba(" + s + "," + a + ")";
  }
  // A made-up beat for when no real sound is available: a kick, a bass line, drifting mids, hats.
  function synth(out, wave, t, on) {
    var i;
    if (!on) { for (i = 0; i < out.length; i++) out[i] = 0; for (i = 0; i < wave.length; i++) wave[i] = 0; return; }
    var beat = t * 118 / 60, kick = Math.exp(-(beat % 1) * 7), hat = Math.exp(-((beat * 2 + 0.5) % 1) * 9);
    var note = [5, 5, 8, 6][Math.floor(beat / 4) % 4], pluck = Math.exp(-((beat * 2) % 1) * 3);
    var n = out.length;
    for (i = 0; i < n; i++) {
      var x = i / n, v = 0.34 + 0.26 * Math.sin(t * 0.9 + i * 0.37) * Math.sin(t * 0.23 + i * 0.11);
      if (i < 7) v = Math.max(v, kick * (1 - i * 0.09));
      v = Math.max(v, pluck * 0.8 * Math.exp(-Math.abs(i - note - 6) * 0.9));
      v += 0.4 * Math.exp(-Math.pow((x - 0.45 - 0.18 * Math.sin(t * 0.31)) * 9, 2));
      if (i > n * 0.72) v = Math.max(v, hat * (0.5 + 0.3 * Math.random()));
      out[i] = clamp01(v * (1 - 0.35 * x) + (Math.random() - 0.5) * 0.06);
    }
    for (i = 0; i < wave.length; i++) {
      var p = i / wave.length * 6.2832;
      wave[i] = kick * 0.6 * Math.sin(p * 2 + t * 9) + 0.25 * Math.sin(p * 7 + t * 13) + hat * 0.12 * (Math.random() - 0.5);
    }
  }

  // ---- state ----
  var computer = typeof window !== "undefined" && !window.WebOSServiceBridge && !window.PalmServiceBridge;
  var cv = null, cx = null, W = 1920, H = 1080, running = false, last = 0, drawn = "";
  var kind = 0, retro = true, playing = false, low = false, frames = 0, pace = 0.016;
  var raw = new Float32Array(BANDS), rawWave = new Float32Array(WAVE), hold = new Float32Array(BANDS);
  var frame = { bands: new Float32Array(BANDS), peaks: new Float32Array(BANDS), wave: new Float32Array(WAVE),
    level: 0, bass: 0, beat: 0, hit: false, live: false };
  var bassAvg = 0, cool = 0, agc = 0.5, wagc = 0.3, cap = null, fed = null;
  var artUrl = "", artPal = null, palKey = "", ramp = [], lut = null;

  function store(v) {
    try { if (v === undefined) return localStorage.getItem("teledash.viz"); localStorage.setItem("teledash.viz", v); } catch (e) { return null; }
  }
  function pal() { return artPal || (retro ? [[60, 255, 112], [255, 225, 74], [255, 74, 58]] : [[80, 200, 255], [150, 110, 255], [255, 90, 170]]); }
  // Colours that depend on the palette are rebuilt only when it changes.
  function colours() {
    var p = pal(), key = p.join("|"), i;
    if (key === palKey) return;
    palKey = key; ramp = []; lut = new Uint8Array(256 * 3); sprite = null; grad = null;
    for (i = 0; i < BANDS; i++) { var k = i / (BANDS - 1) * 2; ramp.push(rgb(k < 1 ? mix(p[0], p[1], k) : mix(p[1], p[2], k - 1))); }
    for (i = 0; i < 256; i++) {                                   // plasma: the three colours in turn, black between
      var x = i / 256 * 3, c = p[Math.floor(x) % 3], glow = Math.pow(Math.sin((x % 1) * Math.PI), 1.6);
      lut[i * 3] = c[0] * glow; lut[i * 3 + 1] = c[1] * glow; lut[i * 3 + 2] = c[2] * glow;
    }
  }

  // ---- real sound from this computer (browser preview only) ----
  function release() {
    if (!cap) return;
    try { cap.stream.getTracks().forEach(function (t) { t.stop(); }); cap.ctx.close(); } catch (e) {}
    cap = null;
  }
  function capture(how, cb) {
    var md = typeof navigator !== "undefined" && navigator.mediaDevices, AC = window.AudioContext || window.webkitAudioContext, p;
    if (!md || !AC) { cb("This browser cannot share sound with the page."); return; }
    try {
      p = how === "mic" ? md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }) :
        md.getDisplayMedia({ video: true, audio: true });
    } catch (e) { cb("This browser cannot share sound with the page."); return; }
    p.then(function (stream) {
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        cb("No sound came with that. Choose a Chrome tab and tick \"Also share tab audio\".");
        return;
      }
      release();
      var ctx = new AC(), an = ctx.createAnalyser();
      an.fftSize = FFT; an.smoothingTimeConstant = 0.35; an.minDecibels = -90; an.maxDecibels = -90 + RANGE_DB;
      ctx.createMediaStreamSource(stream).connect(an);            // not connected to the speakers: no echo
      cap = { stream: stream, ctx: ctx, an: an, freq: new Uint8Array(an.frequencyBinCount), time: new Uint8Array(FFT),
        bins: bandBins(BANDS, an.frequencyBinCount, ctx.sampleRate, F_MIN, F_MAX) };
      stream.getAudioTracks()[0].addEventListener("ended", release);
      agc = 0.5; wagc = 0.3;
      cb(null);
    }, function () { cb("Sound sharing was cancelled."); });
  }
  function readCapture(dt) {
    var i, peak = 0;
    cap.an.getByteFrequencyData(cap.freq);
    bandLevels(cap.freq, cap.bins, raw);
    // Quiet and loud sources should both fill the screen: follow the loudest recent band.
    for (i = 0; i < BANDS; i++) if (raw[i] > peak) peak = raw[i];
    agc = Math.max(peak, agc - dt * 0.04);
    var gain = 0.92 / Math.max(0.3, agc);
    for (i = 0; i < BANDS; i++) raw[i] = clamp01(raw[i] * gain);
    // Waveform: start at an upward crossing so the trace stands still rather than sliding.
    cap.an.getByteTimeDomainData(cap.time);
    var stride = 4, start = 0, wp = 0;
    for (i = 1; i < FFT - WAVE * stride; i++) if (cap.time[i - 1] < 128 && cap.time[i] >= 128) { start = i; break; }
    for (i = 0; i < WAVE; i++) { rawWave[i] = (cap.time[start + i * stride] - 128) / 128; if (Math.abs(rawWave[i]) > wp) wp = Math.abs(rawWave[i]); }
    wagc = Math.max(wp, wagc - dt * 0.05);
    var wg = 0.85 / Math.max(0.08, wagc);
    for (i = 0; i < WAVE; i++) rawWave[i] *= wg;
  }

  // ---- one frame of sound ----
  function advance(dt, t) {
    var i, sum = 0, bass = 0, rb = 0;
    frame.live = true;
    if (cap) readCapture(dt);
    else if (fed && Date.now() - fed.at < 600) {
      for (i = 0; i < BANDS; i++) raw[i] = clamp01(+fed.bands[i] || 0);
      for (i = 0; i < WAVE; i++) rawWave[i] = fed.wave ? +fed.wave[i] || 0 : 0;
    } else { synth(raw, rawWave, t, playing); frame.live = false; }
    for (i = 0; i < BANDS; i++) {
      var v = frame.bands[i] = smooth(frame.bands[i], raw[i], dt);
      if (v >= frame.peaks[i]) { frame.peaks[i] = v; hold[i] = PEAK_HOLD; }
      else if ((hold[i] -= dt) <= 0) frame.peaks[i] = Math.max(v, frame.peaks[i] - dt * PEAK_FALL);
      sum += v;
      if (i < 12) { bass += v; rb += raw[i]; }                    // up to about 120 Hz: the kick drum
    }
    for (i = 0; i < WAVE; i++) frame.wave[i] = rawWave[i];
    frame.level = sum / BANDS; frame.bass = bass / 12;
    // A beat: the bass jumps well above its own recent average.
    rb /= 12; cool -= dt; frame.hit = false;
    if (rb > bassAvg * 1.3 + 0.06 && cool <= 0) { frame.beat = 1; frame.hit = true; cool = 0.18; }
    else frame.beat *= Math.exp(-dt * 6);
    bassAvg += (rb - bassAvg) * Math.min(1, dt * 1.2);
  }

  // ---- the visualizers ----
  var sprite = null, grad = null, parts = [], emit = 0, pl = null, pt = 0, SIN = null;
  var BAR_H = 720, SEG = 16;                                      // tallest bar; one retro block and its gap

  function clear() { cx.globalAlpha = 1; cx.clearRect(0, 0, W, H); }
  function dim(rate, dt) {                                        // fade what is there, leaving trails
    if (frame.level < 0.003 && !parts.length) { clear(); return; }     // silence: true black, nothing left behind
    cx.fillStyle = "rgba(0,0,0," + Math.min(1, dt * rate).toFixed(3) + ")";
    cx.fillRect(0, 0, W, H);
  }
  // Retro bars are stacks of lit blocks, green to yellow to red: drawn once, then cut to height.
  function ledColumn(w) {
    var c = document.createElement("canvas"), g, y;
    c.width = w; c.height = BAR_H; g = c.getContext("2d");
    for (y = 0; y < BAR_H; y += SEG) {
      var k = y / BAR_H;
      g.fillStyle = k < 0.6 ? "#2dff5a" : k < 0.84 ? "#ffe14a" : "#ff4a3a";
      g.fillRect(0, BAR_H - y - (SEG - 4), w, SEG - 4);
    }
    return c;
  }
  function bars() {
    clear();
    var m = 70, bw = (W - 2 * m) / BANDS, w = Math.floor(bw * 0.78), base = H - 64, i, x, h, p;
    if (retro) {
      if (!sprite || sprite.width !== w) sprite = ledColumn(w);
      for (i = 0; i < BANDS; i++) {
        x = Math.round(m + i * bw);
        h = Math.round(frame.bands[i] * BAR_H / SEG) * SEG;
        if (h > 0) cx.drawImage(sprite, 0, BAR_H - h, w, h, x, base - h, w, h);
        p = Math.round(frame.peaks[i] * BAR_H / SEG) * SEG;
        if (p > 0) { cx.fillStyle = "#d8ffe0"; cx.fillRect(x, base - p - 8, w, 4); }
      }
      return;
    }
    if (!grad) {
      var c = pal();
      grad = cx.createLinearGradient(0, base, 0, base - BAR_H);
      grad.addColorStop(0, rgb(c[0])); grad.addColorStop(0.55, rgb(c[1])); grad.addColorStop(1, rgb(c[2]));
    }
    for (i = 0; i < BANDS; i++) {
      x = Math.round(m + i * bw); h = frame.bands[i] * BAR_H;
      if (h >= 1) {
        cx.globalAlpha = 1; cx.fillStyle = grad; cx.fillRect(x, base - h, w, h);
        cx.globalAlpha = 0.14; cx.fillStyle = ramp[i]; cx.fillRect(x, base + 8, w, h * 0.2);   // a faint reflection
      }
      p = frame.peaks[i] * BAR_H;
      if (p >= 2) { cx.globalAlpha = 0.9; cx.fillStyle = ramp[i]; cx.fillRect(x, base - p - 9, w, 4); }
    }
    cx.globalAlpha = 1;
  }
  function scope(dt) {
    dim(14, dt);
    var mid = H * 0.42, amp = H * 0.3, i, c = pal()[0];
    cx.lineJoin = "round"; cx.lineCap = "round";
    cx.beginPath();
    for (i = 0; i < WAVE; i++) {
      var x = i / (WAVE - 1) * W, y = mid + Math.max(-1, Math.min(1, frame.wave[i])) * amp;
      if (i) cx.lineTo(x, y); else cx.moveTo(x, y);
    }
    if (frame.level < 0.003) return;
    cx.strokeStyle = rgb(c, 0.22); cx.lineWidth = 16; cx.stroke();          // the glow, then the trace
    cx.strokeStyle = rgb(mix(c, [255, 255, 255], 0.35)); cx.lineWidth = 4; cx.stroke();
  }
  function radial(dt, t) {
    clear();
    if (frame.level < 0.003) return;
    var X = W / 2, Y = H * 0.48, r0 = 130 + frame.bass * 60 + frame.beat * 26, rot = t * 0.12, i, s;
    cx.lineCap = "round"; cx.lineWidth = 7;
    for (i = 0; i < BANDS; i++) {                                  // bass at the top, treble at the bottom, mirrored
      var len = 6 + frame.bands[i] * 330;
      cx.strokeStyle = ramp[i];
      cx.beginPath();
      for (s = -1; s <= 1; s += 2) {
        var a = rot - Math.PI / 2 + s * (i + 0.5) / BANDS * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
        cx.moveTo(X + ca * r0, Y + sa * r0); cx.lineTo(X + ca * (r0 + len), Y + sa * (r0 + len));
      }
      cx.stroke();
    }
    cx.beginPath(); cx.arc(X, Y, Math.max(8, r0 - 24), 0, 6.2832);
    cx.fillStyle = rgb(pal()[0], (0.08 + frame.beat * 0.25).toFixed(3)); cx.fill();
  }
  function particles(dt, t) {
    dim(9, dt);
    var max = low ? 140 : 320, X = W / 2 + Math.sin(t * 0.21) * 260, Y = H * 0.46 + Math.cos(t * 0.17) * 120, i, p;
    if (frame.level > 0.01) emit += dt * (10 + frame.level * 170) + (frame.hit ? 26 : 0);
    while (emit >= 1 && parts.length < max) {
      emit--;
      var a = Math.random() * 6.2832, sp = (90 + Math.random() * 380) * (0.5 + frame.level * 1.6);
      parts.push({ x: X, y: Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, rate: 1 / (1.4 + Math.random() * 2),
        size: 2 + Math.random() * 4 + frame.bass * 5, c: Math.floor(Math.random() * BANDS) });
    }
    if (emit > 4) emit = 4;
    var boost = 1 + frame.bass * 1.5;
    for (i = parts.length - 1; i >= 0; i--) {
      p = parts[i];
      p.life -= dt * p.rate;
      if (p.life <= 0 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      var sx = -p.vy * dt * 0.25, sy = p.vx * dt * 0.25;           // a slow swirl
      p.vx += sx; p.vy += sy;
      p.x += p.vx * dt * boost; p.y += p.vy * dt * boost;
      cx.globalAlpha = p.life; cx.fillStyle = ramp[p.c];
      cx.beginPath(); cx.arc(p.x, p.y, p.size, 0, 6.2832); cx.fill();
    }
    cx.globalAlpha = 1;
  }
  // Plasma is worked out on a small grid and stretched over the screen, which is what blurs it.
  function plasma(dt) {
    var w = low ? 64 : 128, h = low ? 36 : 72, k = 96 / w, x, y, i;   // k keeps the pattern's size on either grid
    if (!SIN) { SIN = new Float32Array(1024); for (i = 0; i < 1024; i++) SIN[i] = Math.sin(i / 1024 * 6.2832); }
    if (!pl || pl.w !== w) {
      pl = { w: w, h: h, cv: document.createElement("canvas"), dist: new Float32Array(w * h), col: new Float32Array(w), row: new Float32Array(h), dia: new Float32Array(w + h) };
      pl.cv.width = w; pl.cv.height = h; pl.cx = pl.cv.getContext("2d"); pl.img = pl.cx.createImageData(w, h);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) pl.dist[y * w + x] = Math.sqrt(Math.pow(x - w * 0.5, 2) + Math.pow((y - h * 0.45) * 1.6, 2));
    }
    var bright = frame.level < 0.003 ? 0 : clamp01(0.3 + frame.level * 1.1 + frame.beat * 0.15);
    if (bright < 0.004) { clear(); return; }
    pt += dt * (0.25 + frame.level * 1.6);
    for (x = 0; x < w; x++) pl.col[x] = Math.sin(x * 0.09 * k + pt * 1.3);
    for (y = 0; y < h; y++) pl.row[y] = Math.sin(y * 0.13 * k - pt * 0.9);
    for (i = 0; i < w + h; i++) pl.dia[i] = Math.sin(i * 0.07 * k + pt * 0.6);
    var d = pl.img.data, o = 0, q = 0, ph = pt * 190, lift = frame.bass * 1.3;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var v = pl.col[x] + pl.row[y] + pl.dia[x + y] + SIN[((pl.dist[q++] * 26 * k - ph) | 0) & 1023] + lift;
        var li = (((v + 8) * 44) & 255) * 3;                      // the palette wraps, so the bands repeat
        d[o++] = lut[li] * bright; d[o++] = lut[li + 1] * bright; d[o++] = lut[li + 2] * bright; d[o++] = 255;
      }
    }
    pl.cx.putImageData(pl.img, 0, 0);
    cx.imageSmoothingEnabled = true;
    cx.drawImage(pl.cv, 0, 0, W, H);
  }
  var DRAW = { bars: bars, scope: scope, radial: radial, particles: particles, plasma: plasma, off: function () {} };

  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    var dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000 || 0.016));
    last = now;
    if (document.hidden) return;
    // A screen that cannot keep up (frames slower than 25 a second) gets fewer particles and a coarser plasma.
    pace += (dt - pace) * 0.05;
    if (++frames === 120 && pace > 0.04) low = true;
    colours();
    advance(dt, now / 1000);
    var k = KINDS[kind][0];
    if (k !== drawn) { clear(); parts = []; drawn = k; }
    DRAW[k](dt, now / 1000);
  }
  function start(canvas) {
    if (running || !canvas) return;
    cv = canvas; cx = cv.getContext("2d"); W = cv.width; H = cv.height;
    var saved = store(), i;
    for (i = 0; i < KINDS.length; i++) if (KINDS[i][0] === saved) kind = i;
    running = true; drawn = ""; frames = 0; pace = 0.016; last = 0;
    requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (cx) clear();
    parts = [];
  }
  function next() {
    kind = (kind + 1) % KINDS.length;
    store(KINDS[kind][0]);
    return KINDS[kind][1];
  }
  // The artwork colours the visualizers. A picture the browser will not let us read keeps the defaults.
  function setArt(url) {
    url = url || "";
    if (url === artUrl) return;
    artUrl = url; artPal = null;
    if (!url || typeof Image === "undefined") return;
    var im = new Image();
    if (!/^data:/.test(url)) im.crossOrigin = "anonymous";
    im.onload = function () {
      if (url !== artUrl) return;
      try {
        var c = document.createElement("canvas"), g;
        c.width = c.height = 24; g = c.getContext("2d");
        g.drawImage(im, 0, 0, 24, 24);
        artPal = pickPalette(g.getImageData(0, 0, 24, 24).data);
      } catch (e) { artPal = null; }
    };
    im.src = url;
  }

  return {
    start: start, stop: stop, next: next, capture: capture, setArt: setArt,
    name: function () { return KINDS[kind][1]; },
    setSkin: function (r) { retro = !!r; },
    setPlaying: function (p) { playing = !!p; },
    // Real sound measured elsewhere: { bands: 64 numbers 0 to 1, wave: 256 numbers -1 to 1 (optional) }.
    feed: function (f) { if (f && f.bands && f.bands.length >= BANDS) fed = { bands: f.bands, wave: f.wave && f.wave.length >= WAVE ? f.wave : null, at: Date.now() }; },
    live: function () { return frame.live; },
    stats: function () { return { fps: Math.round(1 / pace), low: low, kind: KINDS[kind][0], live: frame.live, capturing: !!cap, palette: artPal ? "artwork" : "default" }; },
    computer: computer, BANDS: BANDS, WAVE: WAVE, F_MIN: F_MIN, F_MAX: F_MAX, FFT: FFT,
    _bandEdges: bandEdges, _bandBins: bandBins, _bandLevels: bandLevels, _shape: shape, _smooth: smooth,
    _pickPalette: pickPalette, _synth: synth
  };
})();
if (typeof module !== "undefined") module.exports = Viz;
