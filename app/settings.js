// Settings and data from the setup helper (the service on this TV, http://127.0.0.1:8770).
// CONFIG = DEFAULTS (config.js) + the last settings the service gave us (cached in localStorage, so
// they apply instantly on the next launch). Everything here fails quietly: without the service the
// app simply runs on the cached or built-in settings.
//   Settings.start(onChange, onStatus, readKey)  poll /api/local/state now and every 30 s; onChange(CONFIG)
//                                       when the settings change, onStatus(up) when reachability does.
//                                       readKey(cb) reads the helper's key ($DATA/local.token, root-only):
//                                       every /api/local call must carry it as X-TeleDash-Local
//   Settings.serviceUp()                true once the service has answered (and still does)
//   Settings.calendar(cb) / pair(cb) -> cb(object or null); feed(cb) -> cb(object or null, HTTP status);
//   usage(cb) -> cb(text or null); night(on, cb) dims (on) or restores (off) the TV's picture
//   music(cb), musicDo(body, cb), musicList(kind, {id, offset, q}, cb) -> cb(answer or null, HTTP status):
//                                       the answer is passed on even for an error status, so the
//                                       helper's plain-English { error } can be shown
//   musicToken(cb), musicFix(cb)        for Spotify's player in this page (player.js): a short-lived
//                                       token, and the helper's repair of that player
//   sound(onLine, onEnd) -> stop()      the helper's measurements of the sound the TV is playing,
//                                       one line of text at a time, until stop() is called
var CONFIG;
var Settings = (function () {
  var BASE = "http://127.0.0.1:8770", KEY = "teledash.settings", POLL_MS = 30000;
  var up = null, last = null, appliedJson = "", onChange = null, onStatus = null, timer = null;
  var key = "", readKey = null, needKey = true, retried = false;

  function load() { try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function apply(s) { CONFIG = Helpers.merge(DEFAULTS, s || {}); }

  var cached = load();
  apply(cached);
  appliedJson = cached ? JSON.stringify(cached) : "";

  // cb(data, text, status) — data is the parsed JSON (null when not JSON), data and text are null on
  // any failure; status is the HTTP status (0 when the helper did not answer at all).
  function req(method, path, cb, ms, body) {
    var done = false, x;
    function fin(d, t, s) { if (!done) { done = true; cb(d, t, s || 0); } }
    try {
      x = new XMLHttpRequest();
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) { fin(null, null, x.status); return; }
        var d = null; try { d = JSON.parse(x.responseText); } catch (e) {}
        fin(d, x.responseText, x.status);
      };
      x.onerror = x.ontimeout = x.onabort = function () { fin(null, null, 0); };
      x.open(method, BASE + path);
      if (key) x.setRequestHeader("X-TeleDash-Local", key);
      x.timeout = ms || 8000;
      if (body !== undefined) { x.setRequestHeader("Content-Type", "application/json"); x.send(JSON.stringify(body)); }
      else x.send();
    } catch (e) { fin(null, null, 0); }
  }

  // Reads the key only when needed (at start, after a refusal, on refresh), because each read
  // starts a root shell through Homebrew Channel.
  // Calls that arrive while the key is being read wait for it, in order.
  var waiting = null;
  function withKey(cb) {
    if (waiting) { waiting.push(cb); return; }
    if (!needKey || !readKey) { cb(); return; }
    needKey = false;
    waiting = [cb];
    readKey(function (k) { key = k || ""; var w = waiting; waiting = null; w.forEach(function (f) { f(); }); });
  }
  // Night mode's picture: on dims it (the helper saves the owner's values first), off restores them.
  // Retries once with a fresh key if refused.
  function night(on, cb, again) {
    withKey(function () { req("POST", "/api/local/night", function (d, t, status) {
      if (status === 403 && !again) { needKey = true; night(on, cb, true); return; }
      if (cb) cb(d);
    }, 20000, { on: !!on }); });
  }

  // Music view calls. Unlike req, the parsed answer is handed over for error statuses too.
  // Retries once with a fresh key if refused.
  function call(method, path, body, cb, again) {
    withKey(function () {
      var done = false, x;
      function fin(d, s) { if (!done) { done = true; cb(d, s || 0); } }
      try {
        x = new XMLHttpRequest();
        x.onload = function () {
          if (x.status === 403 && !again) { done = true; needKey = true; call(method, path, body, cb, true); return; }
          var d = null; try { d = JSON.parse(x.responseText); } catch (e) {}
          fin(d, x.status);
        };
        x.onerror = x.ontimeout = x.onabort = function () { fin(null, 0); };
        x.open(method, BASE + path);
        if (key) x.setRequestHeader("X-TeleDash-Local", key);
        x.timeout = 15000;
        if (body != null) { x.setRequestHeader("Content-Type", "application/json"); x.send(JSON.stringify(body)); }
        else x.send();
      } catch (e) { fin(null, 0); }
    });
  }
  function listPath(kind, o) {
    var p = "/api/local/music/list?kind=" + encodeURIComponent(kind);
    o = o || {};
    if (o.id) p += "&id=" + encodeURIComponent(o.id);
    if (o.offset) p += "&offset=" + encodeURIComponent(o.offset);
    if (o.q) p += "&q=" + encodeURIComponent(o.q);
    return p;
  }

  // The sound stream: one request that stays open while the helper keeps writing lines to it.
  // onLine(text) gets the newest complete line each time some arrive; onEnd(status) is called if
  // the stream ends by itself (404: this TV offers no sound to measure; 0: the helper is gone).
  function sound(onLine, onEnd) {
    var stopped = false, ctl = null;
    function end(status) { if (!stopped) { stopped = true; onEnd(status); } }
    withKey(function () {
      if (stopped) return;
      if (typeof fetch !== "function" || typeof TextDecoder !== "function") { end(404); return; }
      var opts = { headers: { "X-TeleDash-Local": key } };
      try { ctl = new AbortController(); opts.signal = ctl.signal; } catch (e) { ctl = null; }
      fetch(BASE + "/api/local/music/sound", opts).then(function (res) {
        if (res.status === 403) needKey = true;                // a stale key: the next try reads it again
        if (!res.ok || !res.body || !res.body.getReader) { end(res.status || 0); return; }
        var reader = res.body.getReader(), text = new TextDecoder(), rest = "";
        function more() {
          return reader.read().then(function (r) {
            if (stopped) { try { reader.cancel(); } catch (e) {} return; }
            if (r.done) { end(200); return; }
            rest += text.decode(r.value, { stream: true });
            var lines = rest.split("\n");
            rest = lines.pop();
            if (lines.length) onLine(lines[lines.length - 1]);  // older lines are already out of date
            return more();
          });
        }
        return more();
      }).then(null, function () { end(0); });
    });
    return function () {
      stopped = true;
      if (ctl) { try { ctl.abort(); } catch (e) {} }
    };
  }

  function setUp(v) {
    if (v === up) return;
    up = v;
    if (onStatus) onStatus(v);
  }
  function poll() {
    clearTimeout(timer);
    withKey(function () { req("GET", "/api/local/state", function (d, t, status) {
      // Refused: the key is missing or stale (the helper was just installed, or its data reset).
      // Read it again and retry once straight away.
      if (status === 403) { needKey = true; if (!retried) { retried = true; poll(); return; } } else retried = false;
      timer = setTimeout(poll, POLL_MS);
      if (!d || !d.settings) { setUp(false); return; }
      last = d;
      var json = JSON.stringify(d.settings), changed = json !== appliedJson;
      if (changed) { appliedJson = json; save(d.settings); apply(d.settings); }
      setUp(true);                                   // status first, so the rebuild sees the service as up
      if (changed && onChange) onChange(CONFIG);
    }, 5000); });
  }

  return {
    start: function (change, status, keyReader) { onChange = change; onStatus = status; readKey = keyReader || null; poll(); },
    refresh: function () { needKey = needKey || !key; poll(); },
    serviceUp: function () { return up === true; },
    state: function () { return last; },
    // tz: the TV's own UTC offset, since node on the TV may not run in the zone the TV shows.
    calendar: function (cb) { req("GET", "/api/local/calendar?days=2&tz=" + new Date().getTimezoneOffset(), function (d) { cb(d); }, 30000); },
    feed: function (cb) { req("GET", "/api/local/feed", function (d, t, s) { cb(d, s); }, 30000); },
    usage: function (cb) { req("GET", "/api/local/usage", function (d, t) { cb(t); }, 10000); },
    night: night,
    music: function (cb) { call("GET", "/api/local/music", null, cb); },
    musicDo: function (body, cb) { call("POST", "/api/local/music", body, cb); },
    musicList: function (kind, o, cb) { call("GET", listPath(kind, o), null, cb); },
    musicSet: function (body, cb) { call("POST", "/api/local/music/settings", body, cb); },
    musicToken: function (cb) { call("GET", "/api/local/music/token", null, cb); },
    musicFix: function (cb) { call("POST", "/api/local/music/player", {}, cb); },
    sound: sound,
    pair: function (cb) { req("POST", "/api/local/pair", function (d) { cb(d && d.url ? d : null); }, 8000); },
    KEY: KEY
  };
})();
