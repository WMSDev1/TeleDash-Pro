// Daily tile order from the kiosk script's usage log on the TV (/home/root/teledash/usage.log).
// Each log line is "<unix seconds> <appId>" written when that app comes to the front, or
// "<unix seconds> boot" at power-on. Time in front = gap to the next line, capped at 4 hours so a
// TV switched off mid-app does not count the whole night.
// Usage.minutes(text, now, days) -> {appId: minutes}; Usage.order(apps, minutes, pinned) -> apps re-sorted.
var Usage = (function () {
  var CAP = 4 * 3600;
  function minutes(text, now, days) {
    var since = now / 1000 - days * 86400, out = {}, prev = null;
    String(text || "").split("\n").forEach(function (line) {
      var m = /^(\d{9,11}) (\S+)/.exec(line);
      if (!m) return;
      var t = +m[1];
      if (t < 1700000000) { prev = null; return; }               // clock not set yet at boot
      if (prev && prev.t >= since && t > prev.t && prev.id !== "boot")
        out[prev.id] = (out[prev.id] || 0) + Math.min(t - prev.t, CAP) / 60;
      prev = { t: t, id: m[2] };
    });
    return out;
  }
  // Pinned tiles keep their place; the others are sorted by use into the remaining places.
  function order(apps, mins, pinned) {
    pinned = pinned || [];
    var free = [], out = apps.slice(), k = 0;
    apps.forEach(function (a, i) { if (pinned.indexOf(a.id) < 0) free.push({ a: a, i: i }); });
    free.sort(function (x, y) { return ((mins[y.a.id] || 0) - (mins[x.a.id] || 0)) || (x.i - y.i); });
    apps.forEach(function (a, i) { if (pinned.indexOf(a.id) < 0) out[i] = free[k++].a; });
    return out;
  }
  return { minutes: minutes, order: order };
})();
if (typeof module !== "undefined") module.exports = Usage;
