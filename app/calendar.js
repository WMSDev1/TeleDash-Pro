// Reads an iCalendar (.ics) feed and answers "what is on this day". No libraries.
// Cal.parse(text) -> events; Cal.eventsOn(events, day) -> [{summary, start, end, allDay}] sorted.
// Known limits: repeating events are expanded in the TV's own time zone (an event created in
// another zone can be an hour off across a daylight-saving change); yearly "nth weekday of the
// year" rules and BYSETPOS outside monthly rules are not handled.
var Cal = (function () {
  var DAY = 86400000, DOWS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function dayKey(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  function dayNum(d) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); }
  function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

  // --- time zones: turn a wall-clock time in a named zone into a real instant ---
  var fmts = {};
  function zoneOffset(tz, utcMs) {
    var f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false,
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
    var p = {};
    f.formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - utcMs;
  }
  function zoned(y, mo, d, h, mi, s, tz) {
    if (tz) {
      try {
        var wall = Date.UTC(y, mo, d, h, mi, s), t = wall - zoneOffset(tz, wall);
        return new Date(wall - zoneOffset(tz, t));
      } catch (e) {}                                            // unknown zone name: treat as the TV's own
    }
    return new Date(y, mo, d, h, mi, s);
  }

  function parseDate(v, tz) {
    var m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z?))?$/.exec(v.trim());
    if (!m) return null;
    if (!m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
    if (m[7]) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), allDay: false };
    return { date: zoned(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], tz), allDay: false };
  }
  function parseDuration(v) {
    var m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
    if (!m) return 0;
    var ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 3600000 + (+m[5] || 0) * 60000 + (+m[6] || 0) * 1000;
    return m[1] === "-" ? 0 : ms;
  }
  function parseRule(v) {
    var r = { interval: 1, wkst: 1 };
    v.split(";").forEach(function (kv) {
      var i = kv.indexOf("="), k = kv.slice(0, i).toUpperCase(), x = kv.slice(i + 1);
      if (k === "FREQ") r.freq = x.toUpperCase();
      else if (k === "INTERVAL") r.interval = Math.max(1, parseInt(x, 10) || 1);
      else if (k === "COUNT") r.count = parseInt(x, 10);
      else if (k === "WKST") r.wkst = DOWS[x.toUpperCase()] == null ? 1 : DOWS[x.toUpperCase()];
      else if (k === "UNTIL") {
        var u = parseDate(x, null);
        if (u) r.until = u.allDay ? new Date(addDays(u.date, 1) - 1) : u.date;
      }
      else if (k === "BYDAY") r.byday = x.split(",").map(function (e) {
        var m = /^([+-]?\d+)?([A-Za-z]{2})$/.exec(e.trim());
        return m ? { n: m[1] ? parseInt(m[1], 10) : 0, d: DOWS[m[2].toUpperCase()] } : { n: 0, d: -1 };
      });
      else if (k === "BYMONTHDAY") r.bymonthday = x.split(",").map(Number);
      else if (k === "BYMONTH") r.bymonth = x.split(",").map(Number);
      else if (k === "BYSETPOS") r.bysetpos = x.split(",").map(Number);
    });
    return r.freq ? r : null;
  }

  function parse(text) {
    var lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    var events = [], ev = null, depth = 0, overrides = {};
    lines.forEach(function (line) {
      var m = /^([A-Za-z0-9-]+)((?:;[^=;:]+=(?:"[^"]*"|[^;:]*))*):(.*)$/.exec(line);
      if (!m) return;
      var name = m[1].toUpperCase(), val = m[3], tz = (/;TZID=("?)([^;:"]+)\1/i.exec(m[2]) || [])[2];
      if (name === "BEGIN") {
        if (ev) depth++;                                        // nested part (a reminder): skipped
        else if (val.toUpperCase() === "VEVENT") { ev = { exdates: [], summary: "" }; depth = 0; }
        return;
      }
      if (!ev) return;
      if (name === "END") {
        if (depth > 0) { depth--; return; }
        if (ev.start && !ev.cancelled) {
          if (!ev.end || ev.end < ev.start) ev.end = ev.allDay ? addDays(ev.start, 1) : new Date(ev.start.getTime() + (ev.duration || 0));
          if (ev.recurId) (overrides[ev.uid] || (overrides[ev.uid] = [])).push(ev.recurId);
          events.push(ev);
        } else if (ev.recurId) {                                // a cancelled single occurrence still hides the original
          (overrides[ev.uid] || (overrides[ev.uid] = [])).push(ev.recurId);
        }
        ev = null; return;
      }
      if (depth > 0) return;
      var d;
      if (name === "SUMMARY") ev.summary = val.replace(/\\(.)/g, function (x, c) { return c === "n" || c === "N" ? " " : c; });
      else if (name === "UID") ev.uid = val;
      else if (name === "STATUS") ev.cancelled = val.toUpperCase() === "CANCELLED";
      else if (name === "DTSTART") { d = parseDate(val, tz); if (d) { ev.start = d.date; ev.allDay = d.allDay; } }
      else if (name === "DTEND") { d = parseDate(val, tz); if (d) ev.end = d.date; }
      else if (name === "DURATION") ev.duration = parseDuration(val);
      else if (name === "RRULE") ev.rrule = parseRule(val);
      else if (name === "RECURRENCE-ID") { d = parseDate(val, tz); if (d) ev.recurId = d.date; }
      else if (name === "EXDATE") val.split(",").forEach(function (x) { d = parseDate(x, tz); if (d) ev.exdates.push(d.date); });
    });
    events.forEach(function (e) {                               // days on which a repeating event must not appear
      e.skip = {};
      e.exdates.forEach(function (x) { e.skip[dayKey(x)] = true; });
      if (e.rrule && !e.recurId) (overrides[e.uid] || []).forEach(function (x) { e.skip[dayKey(x)] = true; });
    });
    return events;
  }

  // --- repeating events ---
  function nth(D, n) {                                          // is D the nth (or nth-from-last) such weekday of its month?
    return n > 0 ? Math.ceil(D.getDate() / 7) === n : Math.ceil((daysInMonth(D) - D.getDate() + 1) / 7) === -n;
  }
  function dayRule(r, D, S0) {
    if (r.byday) return r.byday.some(function (b) { return b.d === D.getDay() && (b.n === 0 || nth(D, b.n)); });
    if (r.bymonthday) return r.bymonthday.some(function (v) { return v > 0 ? v === D.getDate() : D.getDate() === daysInMonth(D) + v + 1; });
    return D.getDate() === S0.getDate();
  }
  function matches(r, D, S0) {
    var iv = r.interval;
    if (r.bymonth && r.bymonth.indexOf(D.getMonth() + 1) < 0) return false;
    if (r.freq === "DAILY") return (dayNum(D) - dayNum(S0)) % iv === 0 && (!r.byday || dayRule(r, D, S0));
    if (r.freq === "WEEKLY") {
      var wk = function (x) { return Math.floor((dayNum(x) + 4 - r.wkst) / 7); };
      return (wk(D) - wk(S0)) % iv === 0 && (r.byday ? dayRule(r, D, S0) : D.getDay() === S0.getDay());
    }
    if (r.freq === "MONTHLY") {
      if (((D.getFullYear() - S0.getFullYear()) * 12 + D.getMonth() - S0.getMonth()) % iv !== 0) return false;
      if (!dayRule(r, D, S0)) return false;
      if (!r.bysetpos) return true;
      var hits = [], n = daysInMonth(D), i;                     // e.g. "last weekday of the month"
      for (i = 1; i <= n; i++) if (dayRule(r, new Date(D.getFullYear(), D.getMonth(), i), S0)) hits.push(i);
      return r.bysetpos.some(function (p) { return hits[p > 0 ? p - 1 : hits.length + p] === D.getDate(); });
    }
    if (r.freq === "YEARLY") {
      if ((D.getFullYear() - S0.getFullYear()) % iv !== 0) return false;
      if (!r.bymonth && D.getMonth() !== S0.getMonth()) return false;
      return dayRule(r, D, S0);
    }
    return false;
  }
  function lastCounted(ev, S0) {                                // the day of the final occurrence of a "repeat N times" event
    if (ev.countEnd) return ev.countEnd;
    var n = 1, d = S0, i;
    for (i = 1; n < ev.rrule.count && i < 40000; i++) {
      d = addDays(S0, i);
      if (matches(ev.rrule, d, S0)) n++;
    }
    return (ev.countEnd = n >= ev.rrule.count ? d : addDays(S0, 40000));
  }
  // The start of the occurrence of ev that begins on local day D, or null.
  function startOn(ev, D) {
    var S = ev.start, S0 = midnight(S), first = D.getTime() === S0.getTime();
    if (D < S0) return null;
    if (!ev.rrule || ev.recurId) return first ? S : null;
    if (ev.skip[dayKey(D)]) return null;
    if (first) return S;
    if (!matches(ev.rrule, D, S0)) return null;
    var occ = new Date(D.getFullYear(), D.getMonth(), D.getDate(), S.getHours(), S.getMinutes(), S.getSeconds());
    if (ev.rrule.until && occ > ev.rrule.until) return null;
    if (ev.rrule.count && D > lastCounted(ev, S0)) return null;
    return occ;
  }

  function eventsOn(events, day) {
    var D = midnight(day), next = addDays(D, 1), out = [];
    var longAgo = addDays(D, -15);
    events.forEach(function (ev) {
      // Quick exits: most of a calendar is one-off events on other days, and series that have ended.
      if (!ev.rrule || ev.recurId) { if (ev.start >= next || ev.end < D) return; }
      else if (ev.rrule.until && ev.rrule.until < longAgo) return;
      var lenDays = Math.round((ev.end - ev.start) / DAY), lenMs = ev.end - ev.start;
      var back = Math.min(14, Math.ceil(lenMs / DAY)), k, st, en;
      for (k = 0; k <= back; k++) {                             // k > 0: an event that began on an earlier day and is still running
        st = startOn(ev, addDays(D, -k));
        if (!st) continue;
        en = ev.allDay ? addDays(st, Math.max(1, lenDays)) : new Date(st.getTime() + lenMs);
        if (st < next && (en > D || (lenMs === 0 && st >= D))) {
          out.push({ summary: ev.summary || "(no title)", start: st, end: en, allDay: !!ev.allDay });
          break;
        }
      }
    });
    out.sort(function (a, b) { return (b.allDay - a.allDay) || (a.start - b.start) || (a.summary < b.summary ? -1 : 1); });
    return out;
  }

  return { parse: parse, eventsOn: eventsOn };
})();
if (typeof module !== "undefined") module.exports = Cal;
