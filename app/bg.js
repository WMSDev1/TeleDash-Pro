// Animated weather background. Call setWeatherBackground(weatherCode, isDay).
// Kept dark and always moving on purpose: this is an OLED, so no bright static shapes.
(function () {
  var cv = document.getElementById("bg"), g = cv.getContext("2d"), W = 1920, H = 1080;
  var scene = null, parts = [], clouds = [], stars = [], flash = 0, t = 0;

  function kind(code) {
    if (code === 0 || code === 1) return "clear";
    if (code === 2) return "partly";
    if (code === 3) return "cloudy";
    if (code === 45 || code === 48) return "fog";
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 51) return "rain";
    return "cloudy";
  }
  var SKY = {   // [top colour, bottom colour] by scene, day then night
    clear:  [["#1d4f8f", "#16233a"], ["#070b18", "#101318"]],
    partly: [["#274f80", "#172234"], ["#090d19", "#101318"]],
    cloudy: [["#39465a", "#171b22"], ["#12161d", "#101318"]],
    fog:    [["#4a515b", "#1c2026"], ["#191c21", "#111318"]],
    rain:   [["#27313f", "#12151b"], ["#0d1016", "#0f1116"]],
    storm:  [["#1c222d", "#0e1015"], ["#0a0c11", "#0d0f13"]],
    snow:   [["#46536a", "#1a1f28"], ["#161b25", "#111419"]]
  };
  function rnd(a, b) { return a + Math.random() * (b - a); }

  window.setWeatherBackground = function (code, isDay) {
    var k = kind(code), i;
    scene = { k: k, day: !!isDay, sky: SKY[k][isDay ? 0 : 1] };
    parts = []; clouds = []; stars = [];
    var nCloud = { clear: 0, partly: 4, cloudy: 9, fog: 12, rain: 8, storm: 9, snow: 7 }[k];
    for (i = 0; i < nCloud; i++)
      clouds.push({ x: rnd(0, W), y: rnd(-40, k === "fog" ? H : 420), r: rnd(220, 480), v: rnd(4, 14) });
    if (!isDay && (k === "clear" || k === "partly"))
      for (i = 0; i < 140; i++) stars.push({ x: rnd(0, W), y: rnd(0, 620), r: rnd(0.6, 1.8), p: rnd(0, 6.3) });
    if (k === "rain" || k === "storm")
      for (i = 0; i < (k === "storm" ? 260 : 170); i++)
        parts.push({ x: rnd(0, W + 200), y: rnd(0, H), v: rnd(900, 1400), l: rnd(14, 30) });
    if (k === "snow")
      for (i = 0; i < 150; i++)
        parts.push({ x: rnd(0, W), y: rnd(0, H), v: rnd(40, 110), r: rnd(1.5, 4), p: rnd(0, 6.3) });
  };

  function blob(x, y, r, rgb, a) {
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(" + rgb + "," + a + ")"); gr.addColorStop(1, "rgba(" + rgb + ",0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  var paused = false, blacked = false;
  window.setWeatherBackgroundPaused = function (p) { paused = p; blacked = false; };

  var last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (paused) {                                       // idle view: plain black, nothing animating
      if (!blacked) { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); blacked = true; }
      last = now; return;
    }
    if (!scene || now - last < 33) return;             // ~30 frames a second is plenty
    var dt = Math.min((now - last) / 1000, 0.1), i, p; last = now; t += dt;
    var sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, scene.sky[0]); sky.addColorStop(0.75, scene.sky[1]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    for (i = 0; i < stars.length; i++) {
      p = stars[i];
      g.fillStyle = "rgba(255,255,255," + (0.35 + 0.35 * Math.sin(t * 0.8 + p.p)) + ")";
      g.fillRect(p.x, p.y, p.r, p.r);
    }
    if (scene.k === "clear" || scene.k === "partly") {  // sun or moon glow, slowly breathing, top centre
      var pulse = 1 + 0.04 * Math.sin(t * 0.5), sx = 1130, sy = 130;   // between the clock and the temperature, clear of both
      if (scene.day) { blob(sx, sy, 620 * pulse, "255,200,90", 0.38); blob(sx, sy, 190 * pulse, "255,236,170", 0.75); }
      else { blob(sx, sy, 380 * pulse, "150,175,230", 0.2); blob(sx, sy, 80, "225,232,250", 0.85); }
    }
    var crgb = scene.day ? (scene.k === "rain" || scene.k === "storm" ? "120,130,146" : "200,208,220") : "70,78,94";
    for (i = 0; i < clouds.length; i++) {
      p = clouds[i]; p.x += p.v * dt; if (p.x - p.r > W) p.x = -p.r;
      blob(p.x, p.y, p.r, crgb, scene.k === "fog" ? 0.16 : 0.22);
    }
    if (scene.k === "rain" || scene.k === "storm") {
      g.strokeStyle = "rgba(170,195,230,0.38)"; g.lineWidth = 2; g.beginPath();
      for (i = 0; i < parts.length; i++) {
        p = parts[i]; p.y += p.v * dt; p.x -= p.v * dt * 0.18;
        if (p.y > H) { p.y = -p.l; p.x = rnd(0, W + 200); }
        g.moveTo(p.x, p.y); g.lineTo(p.x + p.l * 0.18, p.y - p.l);
      }
      g.stroke();
    }
    if (scene.k === "snow") {
      g.fillStyle = "rgba(240,245,255,0.75)";
      for (i = 0; i < parts.length; i++) {
        p = parts[i]; p.y += p.v * dt; p.x += Math.sin(t + p.p) * 20 * dt;
        if (p.y > H) { p.y = -5; p.x = rnd(0, W); }
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.3); g.fill();
      }
    }
    if (scene.k === "storm") {                           // occasional lightning
      if (flash <= 0 && Math.random() < dt / 9) flash = 0.35;
      if (flash > 0) { g.fillStyle = "rgba(210,225,255," + flash + ")"; g.fillRect(0, 0, W, H); flash -= dt * 1.4; }
    }
    var shade = g.createLinearGradient(0, 380, 0, H);   // darken the lower half so text stays readable
    shade.addColorStop(0, "rgba(16,19,24,0)"); shade.addColorStop(1, "rgba(16,19,24,0.55)");
    g.fillStyle = shade; g.fillRect(0, 380, W, H - 380);
  }
  requestAnimationFrame(frame);
})();
