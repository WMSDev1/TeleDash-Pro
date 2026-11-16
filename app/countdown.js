// Countdowns: common US holidays plus the dates in CONFIG.countdowns.dates.
// Countdown.upcoming(now, withinDays) -> [{title, days}] sorted, nearest first.
// Countdown.label(item) -> "Today: Thanksgiving" / "Tomorrow: …" / "11 days to Thanksgiving".
var Countdown = (function () {
  function nth(y, m, dow, n) {                 // nth weekday (0=Sun) of month m (0-based); n=-1 means last
    if (n > 0) {
      var d = new Date(y, m, 1), shift = (dow - d.getDay() + 7) % 7;
      return new Date(y, m, 1 + shift + (n - 1) * 7);
    }
    var last = new Date(y, m + 1, 0);
    return new Date(y, m, last.getDate() - ((last.getDay() - dow + 7) % 7));
  }
  function easter(y) {                         // Anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31),
      da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, da);
  }
  function holidays(y) {
    return [
      ["New Year's Day", new Date(y, 0, 1)],
      ["Valentine's Day", new Date(y, 1, 14)],
      ["Easter", easter(y)],
      ["Mother's Day", nth(y, 4, 0, 2)],
      ["Memorial Day", nth(y, 4, 1, -1)],
      ["Father's Day", nth(y, 5, 0, 3)],
      ["the Fourth of July", new Date(y, 6, 4)],
      ["Labor Day", nth(y, 8, 1, 1)],
      ["Halloween", new Date(y, 9, 31)],
      ["Thanksgiving", nth(y, 10, 4, 4)],
      ["Christmas", new Date(y, 11, 25)]
    ];
  }
  function days(from, to) {
    return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);
  }
  function upcoming(now, within) {
    var c = (typeof CONFIG !== "undefined" && CONFIG.countdowns) || {}, out = [], y = now.getFullYear();
    function add(title, d) { var n = days(now, d); if (n >= 0 && n <= within) out.push({ title: title, days: n }); }
    if (c.holidays !== false) [y, y + 1].forEach(function (yy) {
      holidays(yy).forEach(function (h) { add(h[0], h[1]); });
    });
    (c.dates || []).forEach(function (x) {
      var p = String(x.date).split("-").map(Number);
      if (p.length === 2) { add(x.title, new Date(y, p[0] - 1, p[1])); add(x.title, new Date(y + 1, p[0] - 1, p[1])); }
      else if (p.length === 3) add(x.title, new Date(p[0], p[1] - 1, p[2]));
    });
    out.sort(function (a, b) { return a.days - b.days; });
    return out;
  }
  function label(x) {
    if (x.days === 0) return "Today: " + x.title;
    if (x.days === 1) return "Tomorrow: " + x.title;
    return x.days + " days to " + x.title;
  }
  return { upcoming: upcoming, label: label, _nth: nth, _easter: easter };
})();
if (typeof module !== "undefined") module.exports = Countdown;
