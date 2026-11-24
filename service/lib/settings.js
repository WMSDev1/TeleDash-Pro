"use strict";
// settings.json: the non-secret settings, validated field by field (CONTRACT.md "Settings schema").
// The service is the source of truth; the app and the setup page only ever see what is saved here.
var URL = require("url").URL;
var store = require("./store");
var util = require("./util");

var FILE = "settings.json";

var DEFAULTS = {
  rev: 0,
  apps: null,
  columns: 6,
  idleSeconds: 120,
  weather: null,
  alerts: { warnings: true, airQuality: true },
  market: { show: true, indexes: [
    { symbol: "^GSPC", label: "S&P 500" }, { symbol: "^IXIC", label: "Nasdaq" }, { symbol: "^DJI", label: "Dow" }
  ] },
  feed: { enabled: false, title: "", url: "", format: "json",
          csv: { date: "date", value: "value", flows: "", time: "" } },
  calendar: { source: "none", calendars: ["primary"] },
  morning: { weekdays: { from: "06:30", to: "09:00" }, weekends: { from: "07:30", to: "10:00" } },
  night: { from: "22:00" },
  countdowns: { holidays: true, withinDays: 45, dates: [] },
  tileOrder: "daily",
  pinned: ["com.webos.app.hdmi1", "com.webos.app.home"],
  home: { opensDashboard: false, delaySeconds: 1 },
  updates: { auto: false },
  music: { tile: false, fadeSeconds: 8, fadeTo: 0, skin: "retro" }
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function bad(msg) { throw util.httpError(400, msg); }

// ---- field checks: each returns the cleaned value or throws a plain-English 400 ----

function bool(v, name) {
  if (typeof v !== "boolean") bad(name + " must be true or false.");
  return v;
}

function int(v, name, min, max) {
  if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v || v < min || v > max) {
    bad(name + " must be a whole number from " + min + " to " + max + ".");
  }
  return v;
}

function num(v, name, min, max) {
  if (typeof v !== "number" || !isFinite(v) || v < min || v > max) bad(name + " must be a number from " + min + " to " + max + ".");
  return v;
}

function text(v, name, max, allowEmpty) {
  if (typeof v !== "string") bad(name + " must be text.");
  v = v.trim();
  if (/[\u0000-\u001f\u007f]/.test(v)) bad(name + " contains characters that are not allowed.");
  if (!allowEmpty && !v) bad(name + " cannot be empty.");
  if (v.length > max) bad(name + " is too long (at most " + max + " characters).");
  return v;
}

function oneOf(v, name, list) {
  if (list.indexOf(v) < 0) bad(name + " must be one of: " + list.join(", ") + ".");
  return v;
}

function onlyKeys(v, name, keys) {
  if (!util.isObject(v)) bad(name + " must be an object.");
  Object.keys(v).forEach(function (k) {
    if (keys.indexOf(k) < 0) bad("Unknown setting: " + name + "." + k);
  });
}

// Partial update of a fixed-shape object: unknown keys rejected, missing keys keep their value.
function merge(v, current, name, keys) {
  onlyKeys(v, name, keys);
  var out = {};
  keys.forEach(function (k) { out[k] = Object.prototype.hasOwnProperty.call(v, k) ? v[k] : current[k]; });
  return out;
}

function list(v, name, max) {
  if (!Array.isArray(v)) bad(name + " must be a list.");
  if (v.length > max) bad(name + " has too many entries (at most " + max + ").");
  return v;
}

var APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
function appId(v, name) {
  if (typeof v !== "string" || !APP_ID.test(v)) bad(name + " is not a valid app id.");
  return v;
}

var TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function morningGroup(v, current, name) {
  if (v === null) return null;
  var g = merge(v, current || { from: "", to: "" }, name, ["from", "to"]);
  if (typeof g.from !== "string" || !TIME.test(g.from)) bad(name + ".from must be a time like 06:30.");
  if (typeof g.to !== "string" || !TIME.test(g.to)) bad(name + ".to must be a time like 09:00.");
  return g;
}

function countdownDate(v, name) {
  var m = typeof v === "string" && /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(v);
  if (!m) bad(name + " must be MM-DD (every year) or YYYY-MM-DD (once).");
  var y = m[1] ? +m[1] : 2024, mo = +m[2], d = +m[3];           // 2024 is a leap year: allows 02-29
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) bad(name + " is not a real date.");
  return v;
}

// Feed address: an https:// URL or github:<owner>/<repo>/<path>[@ref].
var GITHUB = /^github:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/([^@\s]+?)(?:@([^\s@]{1,100}))?$/;
function feedUrl(v, name) {
  v = text(v, name, 500, true);
  if (!v) return v;
  var g = GITHUB.exec(v);
  if (g) {
    if (g[3].split("/").some(function (p) { return p === "" || p === "." || p === ".."; })) bad(name + " has an invalid file path.");
    return v;
  }
  var u;
  try { u = new URL(v); } catch (e) { bad(name + " must start with https:// or github:"); }
  if (u.protocol !== "https:") bad(name + " must start with https:// (or use github:owner/repo/path).");
  return v;
}

var V = {
  apps: function (v) {
    if (v === null) return null;
    return list(v, "apps", 60).map(function (a, i) {
      var n = "apps[" + i + "]";
      onlyKeys(a, n, ["id", "title", "color", "exit"]);
      var out = { id: appId(a.id, n + ".id"), title: text(a.title, n + ".title", 60) };
      if (a.color !== undefined) {
        if (typeof a.color !== "string" || !/^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/.test(a.color)) bad(n + ".color must be a colour like #3d4450.");
        out.color = a.color;
      }
      if (a.exit !== undefined) out.exit = bool(a.exit, n + ".exit");
      return out;
    });
  },
  columns: function (v) { return int(v, "columns", 2, 10); },
  idleSeconds: function (v) { return int(v, "idleSeconds", 10, 3600); },
  weather: function (v) {
    if (v === null) return null;
    onlyKeys(v, "weather", ["latitude", "longitude", "label", "fahrenheit"]);
    // Rounded to one decimal (about 10 km) before saving: the exact location is never stored.
    return {
      latitude: Math.round(num(v.latitude, "weather.latitude", -90, 90) * 10) / 10,
      longitude: Math.round(num(v.longitude, "weather.longitude", -180, 180) * 10) / 10,
      label: text(v.label === undefined ? "" : v.label, "weather.label", 60, true),
      fahrenheit: v.fahrenheit === undefined ? false : bool(v.fahrenheit, "weather.fahrenheit")
    };
  },
  alerts: function (v, cur) {
    var o = merge(v, cur, "alerts", ["warnings", "airQuality"]);
    return { warnings: bool(o.warnings, "alerts.warnings"), airQuality: bool(o.airQuality, "alerts.airQuality") };
  },
  market: function (v, cur) {
    var o = merge(v, cur, "market", ["show", "indexes"]);
    return {
      show: bool(o.show, "market.show"),
      indexes: list(o.indexes, "market.indexes", 8).map(function (x, i) {
        var n = "market.indexes[" + i + "]";
        onlyKeys(x, n, ["symbol", "label"]);
        if (typeof x.symbol !== "string" || !/^[\^A-Za-z0-9.=-]{1,20}$/.test(x.symbol)) bad(n + ".symbol is not a valid market symbol.");
        return { symbol: x.symbol, label: text(x.label, n + ".label", 30) };
      })
    };
  },
  feed: function (v, cur) {
    var o = merge(v, cur, "feed", ["enabled", "title", "url", "format", "csv"]);
    var c = merge(o.csv === cur.csv ? {} : o.csv, cur.csv, "feed.csv", ["date", "value", "flows", "time"]);
    var out = {
      enabled: bool(o.enabled, "feed.enabled"),
      title: text(o.title, "feed.title", 40, true),
      url: feedUrl(o.url, "feed.url"),
      format: oneOf(o.format, "feed.format", ["json", "csv"]),
      csv: {
        date: text(c.date, "feed.csv.date", 60, false),
        value: text(c.value, "feed.csv.value", 60, false),
        flows: text(c.flows, "feed.csv.flows", 60, true),
        time: text(c.time, "feed.csv.time", 60, true)
      }
    };
    if (out.enabled && !out.url) bad("Add the data feed's address before turning it on.");
    return out;
  },
  calendar: function (v, cur) {
    var o = merge(v, cur, "calendar", ["source", "calendars"]);
    var cals = list(o.calendars, "calendar.calendars", 20).map(function (c, i) {
      return text(c, "calendar.calendars[" + i + "]", 300, false);
    });
    return { source: oneOf(o.source, "calendar.source", ["none", "ical", "google"]), calendars: cals.length ? cals : ["primary"] };
  },
  morning: function (v, cur) {
    var o = merge(v, cur, "morning", ["weekdays", "weekends"]);
    return {
      weekdays: morningGroup(o.weekdays, cur.weekdays, "morning.weekdays"),
      weekends: morningGroup(o.weekends, cur.weekends, "morning.weekends")
    };
  },
  // Night hours start; they end when that morning's brief starts (07:00 on days without one).
  // null: night mode only when chosen by hand.
  night: function (v, cur) {
    if (v === null) return null;
    var o = merge(v, cur || DEFAULTS.night, "night", ["from"]);
    if (typeof o.from !== "string" || !TIME.test(o.from)) bad("night.from must be a time like 22:00.");
    return { from: o.from };
  },
  countdowns: function (v, cur) {
    var o = merge(v, cur, "countdowns", ["holidays", "withinDays", "dates"]);
    return {
      holidays: bool(o.holidays, "countdowns.holidays"),
      withinDays: int(o.withinDays, "countdowns.withinDays", 1, 366),
      dates: list(o.dates, "countdowns.dates", 50).map(function (d, i) {
        var n = "countdowns.dates[" + i + "]";
        onlyKeys(d, n, ["title", "date"]);
        return { title: text(d.title, n + ".title", 60), date: countdownDate(d.date, n + ".date") };
      })
    };
  },
  tileOrder: function (v) { return oneOf(v, "tileOrder", ["daily", "fixed"]); },
  pinned: function (v) {
    return list(v, "pinned", 20).map(function (id, i) { return appId(id, "pinned[" + i + "]"); });
  },
  home: function (v, cur) {
    var o = merge(v, cur, "home", ["opensDashboard", "delaySeconds"]);
    return { opensDashboard: bool(o.opensDashboard, "home.opensDashboard"), delaySeconds: int(o.delaySeconds, "home.delaySeconds", 0, 30) };
  },
  updates: function (v, cur) {
    var o = merge(v, cur, "updates", ["auto"]);
    return { auto: bool(o.auto, "updates.auto") };
  },
  // The Music view. tile: show the Music tile (Spotify sign-in turns it on). fadeSeconds: how long
  // after the last button press the artwork and controls fade (0 = never). fadeTo: the percent of
  // full opacity they rest at once faded (0 = gone, leaving only the visualizer). skin: the look.
  music: function (v, cur) {
    var o = merge(v, Object.assign({}, DEFAULTS.music, cur), "music", ["tile", "fadeSeconds", "fadeTo", "skin"]);
    return {
      tile: bool(o.tile, "music.tile"),
      fadeSeconds: int(o.fadeSeconds, "music.fadeSeconds", 0, 600),
      fadeTo: int(o.fadeTo, "music.fadeTo", 0, 100),
      skin: oneOf(o.skin, "music.skin", ["retro", "modern"])
    };
  }
};

// Saved settings over the defaults, so a file from an older version still has every field.
function load() {
  var saved = store.readJson(FILE, null);
  var s = clone(DEFAULTS);
  if (!util.isObject(saved)) return s;
  Object.keys(DEFAULTS).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(saved, k)) return;
    if (util.isObject(DEFAULTS[k]) && util.isObject(saved[k])) s[k] = Object.assign(s[k], saved[k]);
    else s[k] = saved[k];
  });
  if (util.isObject(saved.feed) && util.isObject(saved.feed.csv)) s.feed.csv = Object.assign(clone(DEFAULTS.feed.csv), saved.feed.csv);
  return s;
}

// Validates a partial update against the current settings. Returns the cleaned full settings
// without saving (used by save, and by tests).
function apply(current, patch) {
  if (!util.isObject(patch)) bad("Settings must be sent as an object.");
  var next = clone(current);
  Object.keys(patch).forEach(function (k) {
    if (k === "rev") return;                               // managed here, never by a client
    if (!Object.prototype.hasOwnProperty.call(V, k)) bad("Unknown setting: " + k);
    next[k] = V[k](patch[k], current[k]);
  });
  return next;
}

// Returns { settings, before } so callers can see what changed.
function save(patch) {
  var before = load();
  var next = apply(before, patch);
  next.rev = (typeof before.rev === "number" ? before.rev : 0) + 1;
  store.writeJson(FILE, next);
  return { settings: next, before: before };
}

module.exports = { DEFAULTS: DEFAULTS, load: load, apply: apply, save: save };
