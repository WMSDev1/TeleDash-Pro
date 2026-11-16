// Small pure functions shared by settings.js and app.js. No DOM, no network, so they can be
// tested in Node (test/): var H = require("../app/helpers.js").
var Helpers = (function () {
  var TV_DATA = "/home/root/teledash";
  var APP_ID = "com.teledashpro.dashboard";

  function isObj(x) { return x !== null && typeof x === "object" && !(x instanceof Array); }

  // Deep merge: objects merge key by key; arrays, null and plain values replace. Never mutates.
  function merge(base, over) {
    var out = {}, k;
    if (!isObj(base)) base = {};
    for (k in base) if (base.hasOwnProperty(k)) out[k] = isObj(base[k]) ? merge(base[k], {}) : base[k];
    if (!isObj(over)) return out;
    for (k in over) {
      if (!over.hasOwnProperty(k) || over[k] === undefined) continue;
      out[k] = isObj(over[k]) && isObj(out[k]) ? merge(out[k], over[k]) : over[k];
    }
    return out;
  }

  // ISO 8601 -> Date. "YYYY-MM-DD" (all-day) is local midnight, not UTC midnight as Date() would do.
  function parseIso(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?(Z|[+-]\d\d:?\d\d)?)?$/.exec(String(s || "").replace(/^\s+|\s+$/g, ""));
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (m[4] == null) return new Date(y, mo, d);
    var h = +m[4], mi = +m[5], sec = +(m[6] || 0), ms = m[7] ? +(m[7] + "00").slice(0, 3) : 0;
    if (!m[8]) return new Date(y, mo, d, h, mi, sec, ms);          // no zone: the TV's own time
    var off = 0;
    if (m[8] !== "Z") {
      var z = m[8].replace(":", "");
      off = (z.charAt(0) === "-" ? -1 : 1) * (+z.substr(1, 2) * 60 + +z.substr(3, 2));
    }
    return new Date(Date.UTC(y, mo, d, h, mi, sec, ms) - off * 60000);
  }

  // The service's Google events -> the event shape Cal.eventsOn() understands.
  function googleEvents(list) {
    var out = [];
    (list || []).forEach(function (e) {
      var allDay = !!e.allDay || /^\d{4}-\d\d-\d\d$/.test(String(e.start || ""));
      var st = parseIso(e.start), en = parseIso(e.end);
      if (!st) return;
      if (!en || en < st) en = allDay ? new Date(st.getFullYear(), st.getMonth(), st.getDate() + 1) : st;
      out.push({ summary: e.summary || "(no title)", start: st, end: en, allDay: allDay });
    });
    return out;
  }

  // Number formatting for feed chips. format: "usd" | "percent" | "number" (default).
  function group(v, dp) {
    var p = Math.abs(v).toFixed(dp).split("."), i = p[0], s = "";
    while (i.length > 3) { s = "," + i.slice(-3) + s; i = i.slice(0, -3); }
    return (v < 0 ? "-" : "") + i + s + (p[1] ? "." + p[1] : "");
  }
  function fmt(v, format) {
    v = +v;
    if (isNaN(v)) return "";
    if (format === "usd") return (v < 0 ? "-$" : "$") + group(Math.abs(v), 2);
    if (format === "percent") return group(v, 2) + "%";
    return group(v, Math.abs(v) >= 1000 || v === Math.round(v) ? 0 : 2);
  }

  // Apps from luna://com.webos.applicationManager/listApps worth a tile: visible, has a window,
  // not LG's own system apps (settings, inputs, Live TV: HDMI 1 is pinned separately), not us.
  var SYSTEM = /^(com\.webos\.|com\.palm\.|com\.lge\.|com\.webos$)/;
  function tvApps(list) {
    var out = [];
    (list || []).forEach(function (a) {
      if (!a || !a.id || a.id === APP_ID) return;
      if (a.visible === false || a.noWindow === true || a.hidden === true) return;
      if (SYSTEM.test(a.id)) return;
      out.push(a);
    });
    return out;
  }
  // The app's logo. The web app may not read other apps' folders on webOS 6 (Verified on an LG C1:
  // file:// icon paths fail), so the setup helper, which runs as root, serves them. A URL icon is
  // used as it is. If the helper is not running the image fails and the tile shows the name.
  var ICONS = "http://127.0.0.1:8770/icons/";
  function iconUrl(tv) {
    var icon = tv && (tv.largeIcon || tv.icon);
    if (!icon || !tv.id) return "";
    if (/^https?:/i.test(icon)) return icon;
    return ICONS + encodeURIComponent(tv.id);
  }
  // Dark text on light tiles (Netflix and YouTube report white), light text otherwise.
  function textColor(bg) {
    var m = /^#?([0-9a-f]{6})$/i.exec(bg || "");
    if (!m) return "#ffffff";
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#111111" : "#ffffff";
  }
  // Tile for one app: its own icon from the TV and the TV's colour behind it.
  function tileFor(id, title, color, tv) {
    var t = { id: id, title: title || (tv && tv.title) || id, color: color || "" };
    if (tv) {
      var logo = iconUrl(tv);
      if (logo) t.logo = logo;
      if (!t.color) t.color = tv.bgColor || tv.iconColor || "";
    }
    if (!t.color) t.color = "#3d4450";
    t.text = textColor(t.color);
    return t;
  }

  var HDMI1 = { id: "com.webos.app.hdmi1", title: "HDMI 1", color: "#3d4450" };
  var SETUP = { id: "teledash.setup", title: "Set up", color: "#2b3442", setup: true };
  var NIGHT = { id: "teledash.night", title: "Night", color: "#2a1a16", night: true };
  var ALL = { id: "com.webos.app.home", title: "All apps", color: "#3d4450", exit: true };
  var FIXED = [HDMI1.id, SETUP.id, NIGHT.id, ALL.id];
  // Tiles in order. apps null (automatic): the TV's own apps, then HDMI 1, Set up, Night, All apps.
  // apps a list (chosen on the setup page): that list in its order, HDMI 1 only if it is listed,
  // and always Set up and Night just before All apps (All apps added at the end if missing).
  function fixedTile(f, o) {
    var t = { id: f.id, title: (o && o.title) || f.title, color: (o && o.color) || f.color };
    if (f.setup) t.setup = true;
    if (f.exit) t.exit = true;
    if (f.night) t.night = true;
    return t;
  }
  function tiles(configApps, tvList) {
    var byId = {}, list = [];
    (tvList || []).forEach(function (a) { if (a && a.id) byId[a.id] = a; });
    if (!(configApps instanceof Array)) {
      tvApps(tvList).forEach(function (a) { list.push(tileFor(a.id, a.title, "", a)); });
      return list.concat([fixedTile(HDMI1), fixedTile(SETUP), fixedTile(NIGHT), fixedTile(ALL)]);
    }
    var hasAll = false;
    configApps.forEach(function (a) {
      if (!a || !a.id || a.id === SETUP.id || a.id === NIGHT.id) return;
      if (a.id === HDMI1.id) { list.push(fixedTile(HDMI1, a)); return; }
      if (a.id === ALL.id) { list.push(fixedTile(SETUP), fixedTile(NIGHT), fixedTile(ALL, a)); hasAll = true; return; }
      var t = tileFor(a.id, a.title, a.color, byId[a.id]);
      if (a.logo) t.logo = a.logo;
      list.push(t);
    });
    if (!hasAll) list.push(fixedTile(SETUP), fixedTile(NIGHT), fixedTile(ALL));
    return list;
  }
  // Ids that keep their place when the tiles are re-sorted by use.
  function pinnedIds(configApps, pinned) {
    var p = (pinned || []).concat([SETUP.id, NIGHT.id, ALL.id]);
    return configApps instanceof Array ? p : p.concat([HDMI1.id]);
  }

  // Root helper: what to do given $DATA/running-version (null = could not read) and our version.
  // "none" = up to date; "consent" = never installed, ask first; "silent" = app updated, re-install.
  function installAction(running, version, snoozedUntil, now) {
    running = String(running == null ? "" : running).replace(/^\s+|\s+$/g, "");
    if (!version || running === version) return "none";
    if (running) return "silent";
    return snoozedUntil && now < snoozedUntil ? "none" : "consent";
  }

  // Morning window check. m = settings.morning; null groups or times turn it off.
  function hm(s) { var p = /^(\d\d?):(\d\d)$/.exec(String(s || "")); return p ? +p[1] * 60 + +p[2] : null; }
  function inMorning(m, now) {
    if (!m) return false;
    var w = (now.getDay() === 0 || now.getDay() === 6) ? m.weekends : m.weekdays;
    if (!w) return false;
    var a = hm(w.from), b = hm(w.to), t = now.getHours() * 60 + now.getMinutes();
    return a != null && b != null && t >= a && t < b;
  }

  return { merge: merge, parseIso: parseIso, iconUrl: iconUrl, textColor: textColor, googleEvents: googleEvents, fmt: fmt, tvApps: tvApps,
    tiles: tiles, pinnedIds: pinnedIds, installAction: installAction, inMorning: inMorning, FIXED: FIXED,
    TV_DATA: TV_DATA, APP_ID: APP_ID };
})();
if (typeof module !== "undefined") module.exports = Helpers;
