// The Music view: Spotify full screen (CONTRACT.md "Music view" and "Spotify"). The helper does
// all the talking to Spotify; this file only draws what it reports and sends button presses back.
//   Music.init({ onClose })   once, after the page has loaded
//   Music.open() / close()    show or leave the view (the music itself keeps playing)
//   Music.isOpen()            the view is on screen
//   Music.playing()           Spotify is playing: the screen must not go idle
//   Music.key(keyCode)        a remote button, while the view is open
// ?music=demo on a computer previews the view with made-up songs and no helper.
var Music = (function () {
  var POLL_MS = 2000, AFTER_CMD_MS = 600, LIB_IDLE_MS = 60000, DRIFT_MS = 60000;
  var ROW_H = 96, ROWS = 9, SEEK_MS = 15000, VOL_STEP = 5, PAGE = 50;
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, BKSP: 8,
    PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412, TOGGLE: 10252 };
  var MEDIA = [K.PLAY, K.PAUSE, K.STOP, K.FF, K.RW, K.TOGGLE];
  var demo = typeof location !== "undefined" && /[?&]music=demo/.test(location.search);

  // ---- pure helpers (also used by test/music.test.js) ----

  function fmt(ms) {
    var s = Math.max(0, Math.floor((+ms || 0) / 1000)), m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  // Next shown item from `from` in direction dir (-1 or 1); stays put at either end.
  function step(hidden, from, dir) {
    for (var i = from + dir; i >= 0 && i < hidden.length; i += dir) if (!hidden[i]) return i;
    return from;
  }
  // What to ask Spotify for when a row is chosen. Inside a playlist or album the whole thing is
  // the context, so Spotify carries on after the chosen song; elsewhere (liked songs, recently
  // played, the queue) there is no context to name, so the songs from the chosen one onwards
  // are sent as a list.
  function playRequest(view, index) {
    var row = view.items[index];
    if (!row) return null;
    if (row.kind === "device") return { "do": "transfer", deviceId: row.id, play: true };
    if (row.kind !== "track") return null;
    if (view.context) return { "do": "play", context: view.context, offsetUri: row.uri };
    var uris = [];
    for (var i = index; i < view.items.length && uris.length < PAGE; i++) {
      if (view.items[i].kind === "track" && view.items[i].uri) uris.push(view.items[i].uri);
    }
    return { "do": "play", uris: uris };
  }
  // A button was pressed while the artwork and controls were faded out (the remote's own
  // Play/Pause/Next keys never come here: they always act). Return true if this press should
  // only bring the overlay back, false if it should also do its normal job.
  function revealOnly(k) {
    return true;                                               // every key: the first press only wakes it
  }
  function artOk(u) { return typeof u === "string" && /^(https:\/\/|data:image\/)/.test(u); }
  // The clock's four digits for a position: "m:ss" up to 99:59, a blank instead of a leading zero.
  function clockDigits(ms) {
    var s = Math.min(5999, Math.max(0, Math.floor((+ms || 0) / 1000))), m = Math.floor(s / 60), r = s % 60;
    return [m >= 10 ? Math.floor(m / 10) : null, m % 10, Math.floor(r / 10), r % 10];
  }

  // ---- icons: a few simple shapes drawn here, so nothing depends on the TV's fonts ----
  var ICONS = {
    play: ["M7 4l13 8-13 8z"], pause: ["M6 4h4v16H6zM14 4h4v16h-4z"],
    next: ["M5 5l10 7-10 7zM17 5h3v14h-3z"], prev: ["M19 5L9 12l10 7zM4 5h3v14H4z"],
    shuffle: ["M3 7h3l9 10h5M3 17h3l3-3.3M12.5 9.8L15 7h5M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5", 1],
    repeat: ["M4 11V9a2 2 0 0 1 2-2h13M16.5 4.5L19 7l-2.5 2.5M20 13v2a2 2 0 0 1-2 2H5M7.5 19.5L5 17l2.5-2.5", 1],
    heart: ["M12 20l-7.5-7.6a4.6 4.6 0 0 1 6.5-6.5l1 1 1-1a4.6 4.6 0 0 1 6.5 6.5z", 1],
    library: ["M4 6h16M4 12h16M4 18h16", 1], close: ["M6 6l12 12M18 6L6 18", 1],
    viz: ["M5 20v-8M10 20V5M15 20v-11M20 20v-6", 1]
  };
  function icon(name) {
    var i = ICONS[name];
    return '<svg viewBox="0 0 24 24" width="44" height="44"><path d="' + i[0] + '"' +
      (i[1] ? ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : ' fill="currentColor"') + "/></svg>";
  }
  var CTL = [
    { id: "shuffle", icon: "shuffle" }, { id: "previous", icon: "prev" }, { id: "back", text: "-15" },
    { id: "toggle", icon: "play" }, { id: "fwd", text: "+15" }, { id: "next", icon: "next" },
    { id: "repeat", icon: "repeat" }, { id: "like", icon: "heart" },
    { id: "voldown", text: "Vol -" }, { id: "volup", text: "Vol +" }, { id: "viz", icon: "viz" },
    { id: "library", icon: "library" }
  ];
  var MENU = [
    { kind: "menu", title: "Playlists", list: "playlists" }, { kind: "menu", title: "Albums", list: "albums" },
    { kind: "menu", title: "Liked songs", list: "liked" }, { kind: "menu", title: "Recently played", list: "recent" },
    { kind: "menu", title: "Queue", list: "queue" }, { kind: "menu", title: "Devices", list: "devices" }
  ];

  // ---- made-up data for ?music=demo ----
  var Demo = (function () {
    var T = [["Example Song", "Example Artist", "Example Album", 215000, "#24456b"],
      ["Second Track", "Another Artist", "Another Album", 187000, "#5b2a4a"],
      ["Third Tune", "Example Artist", "Example Album", 242000, "#2a5b3f"]];
    var s = { i: 0, playing: true, pos: 61000, at: Date.now(), shuffle: false, repeat: "off", vol: 40, liked: [false, true, false] };
    function art(c) {
      return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">' +
        '<rect width="640" height="640" fill="' + c + '"/><circle cx="320" cy="320" r="170" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="26"/></svg>');
    }
    function uri(i) { return "spotify:track:" + "AAAAAAAAAAAAAAAAAAAAA" + i; }
    function advance() {
      var n = Date.now();
      if (s.playing) { s.pos += n - s.at; if (s.pos >= T[s.i][3]) { s.i = (s.i + 1) % T.length; s.pos = 0; } }
      s.at = n;
    }
    function rows() {
      return T.map(function (t, i) { return { kind: "track", uri: uri(i), id: "t" + i, title: t[0], subtitle: t[1], art: art(t[4]) }; });
    }
    return {
      state: function (cb) {
        advance();
        var t = T[s.i];
        cb({ connected: true, active: true, playing: s.playing, progressMs: s.pos, durationMs: t[3], at: s.at,
          shuffle: s.shuffle, repeat: s.repeat, device: { id: "d1", name: "Living room", type: "Speaker", volume: s.vol },
          track: { uri: uri(s.i), title: t[0], artist: t[1], album: t[2], art: art(t[4]), liked: s.liked[s.i] } }, 200);
      },
      cmd: function (b, cb) {
        advance();
        var d = b["do"];
        if (d === "play") {
          s.playing = true;
          var u = b.offsetUri || (b.uris && b.uris[0]);
          if (u) { s.i = +u.charAt(u.length - 1) % T.length; s.pos = 0; }
        }
        else if (d === "pause") s.playing = false;
        else if (d === "next") { s.i = (s.i + 1) % T.length; s.pos = 0; }
        else if (d === "previous") { s.i = (s.i + T.length - 1) % T.length; s.pos = 0; }
        else if (d === "seek") s.pos = b.ms;
        else if (d === "shuffle") s.shuffle = b.on;
        else if (d === "repeat") s.repeat = b.mode;
        else if (d === "volume") s.vol = b.percent;
        else if (d === "like") s.liked[s.i] = true;
        else if (d === "unlike") s.liked[s.i] = false;
        cb({ ok: true }, 200);
      },
      list: function (kind, o, cb) {
        var items;
        if (kind === "playlists") items = [{ kind: "playlist", uri: "spotify:playlist:AAAAAAAAAAAAAAAAAAAAAA", id: "AAAAAAAAAAAAAAAAAAAAAA", title: "Example playlist", subtitle: "You · 3 songs", art: art("#3d4450") }];
        else if (kind === "albums") items = [{ kind: "album", uri: "spotify:album:AAAAAAAAAAAAAAAAAAAAAA", id: "AAAAAAAAAAAAAAAAAAAAAA", title: "Example Album", subtitle: "Example Artist", art: art("#24456b") }];
        else if (kind === "devices") items = [{ kind: "device", uri: "", id: "d1", title: "Living room", subtitle: "Speaker", art: "", active: true },
          { kind: "device", uri: "", id: "d2", title: "Phone", subtitle: "Smartphone", art: "", active: false }];
        else items = rows();
        setTimeout(function () { cb({ items: items, next: null }, 200); }, 150);
      }
    };
  })();
  var Live = {
    state: function (cb) { Settings.music(cb); },
    cmd: function (b, cb) { Settings.musicDo(b, cb); },
    list: function (kind, o, cb) { Settings.musicList(kind, o, cb); }
  };
  var src = demo ? Demo : Live;

  // ---- state ----
  var hooks = {}, shown = false, st = null, err = "", seq = 0, fails = 0;
  var pollTimer = null, tickTimer = null, fadeTimer = null, driftTimer = null, msgTimer = null;
  var faded = false, lastTouch = 0, focus = 3, btns = [], lib = null, note = "";
  var E = {};
  var V = typeof Viz !== "undefined" ? Viz : null;               // the visualizers (viz.js)

  function $(id) { return document.getElementById(id); }
  function el(cls, text) { var e = document.createElement("div"); e.className = cls; if (text != null) e.textContent = text; return e; }
  function cfg() { return (typeof CONFIG !== "undefined" && CONFIG && CONFIG.music) || {}; }
  // The look: "retro" (a late-90s desktop player) unless the owner chose "modern". ?skin= previews one.
  var qs = typeof location !== "undefined" && /[?&]skin=(retro|modern)/.exec(location.search);
  function skin() { return qs ? qs[1] : cfg().skin === "modern" ? "modern" : "retro"; }
  function fadeMs() { return Math.max(0, +cfg().fadeSeconds || 0) * 1000; }

  function position() {
    if (!st || !st.track) return 0;
    var p = (st.progressMs || 0) + (st.playing ? Date.now() - st.at : 0);
    return Math.max(0, st.durationMs ? Math.min(p, st.durationMs) : p);
  }
  function hiddenCtl() {
    var vol = st && st.device && typeof st.device.volume === "number";
    return CTL.map(function (c) { return (c.id === "voldown" || c.id === "volup") && !vol; });
  }

  // ---- drawing ----
  function build() {
    ["music", "mover", "martimg", "mtitle", "martist", "malbum", "mfill", "mpos", "mdur", "mctl", "mdev", "mmsg",
      "mlibtitle", "mlist", "mlibfoot", "mwtitle", "mclose", "mclock", "fshuffle", "frepeat", "flike"].forEach(function (id) { E[id] = $(id); });
    E.mclose.innerHTML = icon("close");
    E.mclose.addEventListener("click", close);
    E.mctl.innerHTML = "";
    btns = CTL.map(function (c, i) {
      var b = el("mbtn");
      if (c.icon) b.innerHTML = icon(c.icon); else b.textContent = c.text;
      b.addEventListener("click", function () { touch(); setFocus(i); act(c.id); });
      b.addEventListener("mouseenter", function () { setFocus(i); });
      E.mctl.appendChild(b);
      return b;
    });
    document.addEventListener("mousemove", function () { if (shown) touch(); });
  }
  function setFocus(i) {
    if (btns[focus]) btns[focus].classList.remove("focus");
    focus = i;
    if (btns[focus]) btns[focus].classList.add("focus");
  }
  function ctl(id) { for (var i = 0; i < CTL.length; i++) if (CTL[i].id === id) return i; return 0; }
  function setIcon(id, name) { var i = ctl(id); if (CTL[i].shown !== name) { CTL[i].shown = name; btns[i].innerHTML = icon(name); } }

  function render() {
    var t = st && st.track, hid = hiddenCtl();
    var title = "", sub = "", album = "", msg = err;
    if (st && st.connected === false) {
      title = "Spotify is not connected";
      msg = "Open Set up on the dashboard, scan the code with your phone and sign in under Music.";
    } else if (t) { title = t.title; sub = t.artist; album = t.album; }
    else if (st) {
      title = "Nothing is playing";
      if (!msg) msg = "Start Spotify on a phone or speaker, or press Up for the library and pick a device.";
    } else if (!msg) title = "Connecting to Spotify…";
    var retro = skin() === "retro";
    E.music.className = retro ? "retro" : "";
    setTitle(title, retro);
    E.martist.textContent = sub; E.malbum.textContent = album;
    E.mmsg.textContent = note || msg;
    E.mwtitle.textContent = "Music" + (st && st.device ? " - " + st.device.name : "");
    E.fshuffle.className = st && st.shuffle ? "on" : "";
    E.frepeat.className = st && st.repeat && st.repeat !== "off" ? "on" : "";
    E.frepeat.textContent = st && st.repeat === "track" ? "REPEAT 1" : "REPEAT";
    E.flike.className = t && t.liked ? "on" : "";
    var a = t && artOk(t.art) ? t.art : "";
    if (E.martimg.getAttribute("data-src") !== a) {
      E.martimg.setAttribute("data-src", a);
      if (a) E.martimg.src = a; else E.martimg.removeAttribute("src");
      E.martimg.style.visibility = a ? "visible" : "hidden";
    }
    if (V) { V.setArt(a); V.setSkin(retro); V.setPlaying(!!(st && st.playing)); }
    var vol = st && st.device && typeof st.device.volume === "number" ? "volume " + st.device.volume + "%" : "";
    E.mdev.textContent = !(st && st.device) ? "" : retro ? vol || st.device.type || "" :   // the title bar names the device
      "Playing on " + st.device.name + (vol ? " · " + vol : "");
    setIcon("toggle", st && st.playing ? "pause" : "play");
    btns.forEach(function (b, i) {
      var c = CTL[i].id, on = false;
      if (c === "shuffle") on = !!(st && st.shuffle);
      else if (c === "repeat") on = !!(st && st.repeat && st.repeat !== "off");
      else if (c === "like") on = !!(t && t.liked);
      b.className = "mbtn" + (i === focus ? " focus" : "") + (on ? " on" : "") + (hid[i] ? " hide" : "") +
        (c === "like" && on ? " fill" : "");
      if (c === "repeat") b.setAttribute("data-one", st && st.repeat === "track" ? "1" : "");
    });
    if (hid[focus]) setFocus(ctl("toggle"));
    tick();
  }
  function tick() {
    if (!shown) return;
    var p = position(), d = st && st.track ? st.durationMs : 0;
    E.mfill.style.width = d ? Math.min(100, p / d * 100).toFixed(2) + "%" : "0";
    E.mpos.textContent = st && st.track ? fmt(p) : "";
    E.mdur.textContent = d ? fmt(d) : "";
    if (skin() === "retro") drawClock(st && st.track ? clockDigits(p) : null);
  }
  // A long title scrolls across the LCD in the retro look; elsewhere it is cut with an ellipsis.
  function setTitle(text, retro) {
    var sp = E.mtitle.firstChild, key = text + (retro ? "|r" : "|m");
    if (E.mtitle.getAttribute("data-k") === key) return;
    E.mtitle.setAttribute("data-k", key);
    E.mtitle.className = "";
    sp.style.animationDuration = "";
    sp.textContent = text;
    if (!retro || sp.offsetWidth <= E.mtitle.clientWidth) return;
    sp.style.animationDuration = Math.max(10, Math.round(sp.offsetWidth / 70)) + "s";
    E.mtitle.className = "scroll";
  }
  // The LCD clock: seven-segment digits drawn here, lit over a faint unlit set, so the TV's fonts
  // do not matter. digits: four numbers (null = blank), or null for no song.
  var SEG = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];
  var clockKey = "";
  function drawClock(digits) {
    var k = digits ? digits.join(",") : "-";
    if (k === clockKey) return;
    clockKey = k;
    var c = E.mclock.getContext("2d"), W = 62, H = 104, T = 12, G = 16, x = 4, y = 4;
    c.clearRect(0, 0, E.mclock.width, E.mclock.height);
    function bar(x0, y0, len, down, lit) {                      // one segment: a long hexagon from (x0, y0)
      var h = T / 2;
      c.beginPath();
      if (down) { c.moveTo(x0, y0); c.lineTo(x0 + h, y0 + h); c.lineTo(x0 + h, y0 + len - h); c.lineTo(x0, y0 + len); c.lineTo(x0 - h, y0 + len - h); c.lineTo(x0 - h, y0 + h); }
      else { c.moveTo(x0, y0); c.lineTo(x0 + h, y0 - h); c.lineTo(x0 + len - h, y0 - h); c.lineTo(x0 + len, y0); c.lineTo(x0 + len - h, y0 + h); c.lineTo(x0 + h, y0 + h); }
      c.closePath();
      c.shadowColor = "#3cff70"; c.shadowBlur = lit ? 10 : 0;
      c.fillStyle = lit ? "#3cff70" : "#0a2912";
      c.fill();
    }
    function digit(ox, n) {
      var on = n == null ? "" : SEG[n], h = T / 2, mid = y + H / 2, half = H / 2 - h - 4;
      bar(ox + h + 2, y + h, W - T - 4, false, on.indexOf("a") >= 0);
      bar(ox + h + 2, mid, W - T - 4, false, on.indexOf("g") >= 0);
      bar(ox + h + 2, y + H - h, W - T - 4, false, on.indexOf("d") >= 0);
      bar(ox + h, y + h + 2, half, true, on.indexOf("f") >= 0);
      bar(ox + W - h, y + h + 2, half, true, on.indexOf("b") >= 0);
      bar(ox + h, mid + 2, half, true, on.indexOf("e") >= 0);
      bar(ox + W - h, mid + 2, half, true, on.indexOf("c") >= 0);
    }
    for (var i = 0; i < 4; i++) {
      digit(x, digits ? digits[i] : null);
      x += W + G;
      if (i === 1) {                                            // the colon
        c.shadowBlur = digits ? 10 : 0; c.fillStyle = digits ? "#3cff70" : "#0a2912";
        c.fillRect(x, y + H * 0.3 - 6, 12, 12); c.fillRect(x, y + H * 0.7 - 6, 12, 12);
        x += 12 + G;
      }
    }
  }
  function say(text) {
    note = text || "";
    clearTimeout(msgTimer);
    if (note) msgTimer = setTimeout(function () { note = ""; if (shown) render(); }, 6000);
    if (shown) render();
  }

  // ---- talking to the helper ----
  function poll() {
    clearTimeout(pollTimer);
    if (!shown) return;
    if (document.hidden) { pollTimer = setTimeout(poll, POLL_MS); return; }   // another app is in front
    var my = ++seq;
    src.state(function (d, status) {
      if (!shown || my !== seq) return;                         // a newer read is already on its way
      pollTimer = setTimeout(poll, POLL_MS);
      if (d && typeof d.connected === "boolean") { st = d; err = ""; fails = 0; }
      else {
        // Keep the last song on screen through a hiccup; say what is wrong after a few misses.
        if (++fails >= 3) st = null;
        err = d && d.error ? d.error : status ? "Spotify could not be reached just now." :
          "The setup helper is not running, so Music cannot reach Spotify.";
      }
      render();
      if (lib) renderLib();                                     // which device is playing may have changed
    });
  }
  function send(body, optimistic) {
    if (optimistic && st) { optimistic(st); render(); }
    seq++;                                                      // drop any read that started before this press
    clearTimeout(pollTimer);
    src.cmd(body, function (d) {
      if (!d || !d.ok) say((d && d.error) || "Spotify did not answer. Try again.");
      pollTimer = setTimeout(poll, AFTER_CMD_MS);              // Spotify needs a moment to catch up
    });
  }
  function freeze(s) { s.progressMs = position(); s.at = Date.now(); }

  // What the visualizer is moving to, said plainly: real sound, or a made-up beat.
  function vizNote() {
    if (!V) return "";
    var n = "Visualizer: " + V.name();
    if (V.name() === "Off" || V.live()) return n;
    return n + (V.computer ? " (made-up beat: press C to share a tab's sound, M for the microphone)" : " (not following the music yet)");
  }
  function act(id) {
    var s = st || {};
    if (id === "viz") { if (V) { V.next(); say(vizNote()); } return; }
    if (id === "library") { openLib(); return; }
    if (s.connected === false || !st) return;
    if (id === "toggle") send(s.playing ? { "do": "pause" } : { "do": "play" }, function (x) { freeze(x); x.playing = !x.playing; });
    else if (id === "next" || id === "previous") send({ "do": id });
    else if (id === "back" || id === "fwd") {
      if (!s.track) return;
      var ms = Math.round(Math.max(0, Math.min((s.durationMs || 0) - 1000, position() + (id === "fwd" ? SEEK_MS : -SEEK_MS))));
      send({ "do": "seek", ms: ms }, function (x) { x.progressMs = ms; x.at = Date.now(); });
    }
    else if (id === "shuffle") send({ "do": "shuffle", on: !s.shuffle }, function (x) { x.shuffle = !x.shuffle; });
    else if (id === "repeat") {
      var mode = s.repeat === "off" ? "context" : s.repeat === "context" ? "track" : "off";
      send({ "do": "repeat", mode: mode }, function (x) { x.repeat = mode; });
    }
    else if (id === "like") {
      if (!s.track || !/^spotify:track:/.test(s.track.uri)) return;
      var like = !s.track.liked;
      send({ "do": like ? "like" : "unlike", uri: s.track.uri }, function (x) { x.track.liked = like; });
    }
    else if (id === "voldown" || id === "volup") {
      if (!s.device || typeof s.device.volume !== "number") return;
      var v = Math.max(0, Math.min(100, s.device.volume + (id === "volup" ? VOL_STEP : -VOL_STEP)));
      send({ "do": "volume", percent: v }, function (x) { x.device.volume = v; });
    }
  }
  function mediaKey(k) {
    var playing = st && st.playing;
    if (k === K.TOGGLE) act("toggle");
    else if (k === K.PLAY) { if (!playing) act("toggle"); }
    else if (k === K.PAUSE || k === K.STOP) { if (playing) act("toggle"); }
    else if (k === K.FF) act("next");
    else if (k === K.RW) act("previous");
  }

  // ---- library: a stack of lists; the top one is on screen ----
  function view() { return lib[lib.length - 1]; }
  function openLib() {
    lib = [{ title: "Library", items: MENU, next: null, focus: 0 }];
    document.body.classList.add("mlib");
    renderLib();
  }
  function closeLib() {
    lib = null;
    document.body.classList.remove("mlib");
  }
  function load(v) {
    if (v.loading) return;
    v.loading = true; v.error = "";
    var at = v.items.length;
    src.list(v.kind, { id: v.id, offset: v.next || 0 }, function (d) {
      v.loading = false;
      if (d && d.items) { v.items = v.items.concat(d.items); v.next = d.next; }
      else v.error = (d && d.error) || "Spotify did not answer.";
      // Spotify lists the songs only of playlists the owner made or shares; one they merely
      // follow can still be played whole, so offer that in place of a dead end.
      if (v.error && v.context && !v.items.length) {
        v.items = [{ kind: "all", uri: v.context, title: "Play all of it", subtitle: "Spotify does not list these songs", art: "" }];
        v.error = "";
      }
      if (lib && view() === v) { if (!at) v.focus = 0; renderLib(); }
    });
  }
  function push(row) {
    var v = { title: row.title, kind: row.list || row.kind, id: row.id, items: [], next: null, focus: 0 };
    if (row.kind === "playlist" || row.kind === "album") v.context = row.uri;
    lib.push(v);
    load(v);
    renderLib();
  }
  function choose(i) {
    var v = view(), row = v.items[i];
    if (!row) return;
    if (row.kind === "menu" || row.kind === "playlist" || row.kind === "album") { push(row); return; }
    var r = row.kind === "all" ? { "do": "play", context: row.uri } : playRequest(v, i);
    if (!r) return;
    closeLib();
    send(r);
  }
  function renderLib() {
    if (!lib) return;
    var v = view(), box = E.mlist;
    E.mlibtitle.textContent = v.title;
    box.innerHTML = "";
    v.items.forEach(function (row, i) {
      var r = el("mrow" + (i === v.focus ? " focus" : ""));
      var th;
      if (artOk(row.art)) { th = document.createElement("img"); th.src = row.art; th.alt = ""; }
      else th = document.createElement("div");
      th.className = "mthumb";
      if (row.kind !== "menu") r.appendChild(th);
      var tx = el("mtext");
      tx.appendChild(el("mt", row.title));
      var sub = row.subtitle || "";
      if (row.kind === "device" && row.active) sub += (sub ? " · " : "") + "playing here";
      if (sub) tx.appendChild(el("ms", sub));
      r.appendChild(tx);
      r.addEventListener("click", function () { touch(); v.focus = i; choose(i); });
      r.addEventListener("mouseenter", function () { if (v.focus !== i) { v.focus = i; markRow(v); } });
      box.appendChild(r);
    });
    if (!v.items.length) box.appendChild(el("mrow quiet", v.loading ? "Loading…" : v.error || "Nothing here yet."));
    E.mlibfoot.textContent = v.error && v.items.length ? v.error : v.loading && v.items.length ? "Loading more…" :
      lib.length > 1 ? "Back for the previous list" : "Back to close";
    scrollLib(v);
  }
  function markRow(v) {
    var rows = E.mlist.childNodes;
    for (var i = 0; i < rows.length; i++) rows[i].className = "mrow" + (i === v.focus ? " focus" : "");
    scrollLib(v);
  }
  function scrollLib(v) {
    var top = Math.max(0, Math.min(v.focus - Math.floor(ROWS / 2), v.items.length - ROWS));
    E.mlist.style.transform = "translateY(" + (-top * ROW_H) + "px)";
  }
  function libKey(k) {
    var v = view();
    if (k === K.UP || k === K.DOWN) {
      var n = Math.max(0, Math.min(v.items.length - 1, v.focus + (k === K.DOWN ? 1 : -1)));
      if (n !== v.focus) { v.focus = n; markRow(v); }
      if (v.next != null && n >= v.items.length - 5) load(v);  // fetch the next page before the end
    }
    else if (k === K.OK || k === K.RIGHT) choose(v.focus);
    else if (k === K.LEFT || k === K.BACK || k === K.ESC || k === K.BKSP) {
      lib.pop();
      if (lib.length) renderLib(); else closeLib();
    }
  }
  function nowKey(k) {
    if (k === K.LEFT || k === K.RIGHT) setFocus(step(hiddenCtl(), focus, k === K.RIGHT ? 1 : -1));
    else if (k === K.OK) act(CTL[focus].id);
    else if (k === K.UP) openLib();
    else if (k === K.DOWN) fade(true);
    else if (k === K.BACK || k === K.ESC || k === K.BKSP) close();
  }

  // ---- fade: artwork and controls step aside after a while, and nothing sits still on an OLED ----
  // Shows the overlay and restarts the countdown. Returns true if it had been faded.
  function touch() {
    var was = faded;
    faded = false; lastTouch = Date.now();
    E.mover.style.transition = "opacity .25s ease";               // back at once, and no slow slide home
    E.mover.style.opacity = "1";
    E.mover.style.transform = "";
    clearTimeout(fadeTimer);
    if (fadeMs() > 0) fadeTimer = setTimeout(fade, lib ? Math.max(fadeMs(), LIB_IDLE_MS) : fadeMs());
    return was;
  }
  function fade(now) {
    clearTimeout(fadeTimer);
    if (!shown) return;
    // Paused or nothing playing: leave the overlay up. The ordinary idle view takes over instead.
    if (!(st && st.playing)) { if (fadeMs() > 0) fadeTimer = setTimeout(fade, fadeMs()); return; }
    if (lib) closeLib();
    faded = true;
    E.mover.style.transition = (now === true ? "opacity .4s ease" : "opacity 1.5s ease") + ", transform 55s linear";
    E.mover.style.opacity = String(Math.max(0, Math.min(100, +cfg().fadeTo || 0)) / 100);
  }
  function drift() {
    if (!shown || Date.now() - lastTouch < DRIFT_MS / 2) return;    // never while someone is using it
    if (!faded) E.mover.style.transition = "opacity .25s ease, transform 55s linear";
    E.mover.style.transform = "translate(" + Math.round(Math.random() * 120 - 60) + "px," + Math.round(Math.random() * 60 - 50) + "px)";
  }

  function key(k) {
    // Previewing on a computer: C shares a tab's (or the screen's) sound with the visualizer, M the microphone.
    if (V && V.computer && (k === 67 || k === 77)) {
      V.capture(k === 77 ? "mic" : "tab", function (e) { say(e || "The visualizer is following this computer's sound."); });
      touch();
      return;
    }
    var media = MEDIA.indexOf(k) >= 0, was = touch();
    if (media) { mediaKey(k); return; }
    if (was && revealOnly(k)) return;
    if (lib) libKey(k); else nowKey(k);
  }

  function open() {
    if (shown) return;
    shown = true; st = null; err = ""; fails = 0; note = "";
    document.body.classList.add("music");
    setFocus(ctl("toggle"));
    render(); touch(); poll();
    if (V) V.start($("mviz"));
    tickTimer = setInterval(tick, 500);
    driftTimer = setInterval(drift, DRIFT_MS);
  }
  function close() {
    if (!shown) return;
    shown = false; seq++;
    [pollTimer, fadeTimer, msgTimer].forEach(clearTimeout);
    clearInterval(tickTimer); clearInterval(driftTimer);
    if (lib) closeLib();
    if (V) V.stop();
    document.body.classList.remove("music");
    if (hooks.onClose) hooks.onClose();
  }

  return {
    init: function (h) { hooks = h || {}; build(); },
    open: open, close: close, key: key,
    isOpen: function () { return shown; },
    playing: function () { return !!(shown && st && st.playing); },
    demo: demo,
    _fmt: fmt, _step: step, _playRequest: playRequest, _revealOnly: revealOnly, _artOk: artOk, _clockDigits: clockDigits, K: K
  };
})();
if (typeof module !== "undefined") module.exports = Music;
