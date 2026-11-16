(function () {
  var APPDIR = "/media/developer/apps/usr/palm/applications/" + Helpers.APP_ID;
  var DATA = Helpers.TV_DATA;                                  // $DATA on the TV (CONTRACT.md)
  var REFRESH_MS = 30 * 60 * 1000, RETRY_MS = 60 * 1000;
  var grid = document.getElementById("grid");
  var statusEl = document.getElementById("status");
  var cols = 6, apps = [], focus = 0, tiles = [], tvList = null, moved = false;   // moved: someone has used the arrows
  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  // Status line: a passing message ("Opening …") wins over the standing hint ("Setup helper not running").
  var note = "", hint = "";
  function say(t) { note = t || ""; statusEl.textContent = note || hint; }
  function setHint(t) { hint = t || ""; statusEl.textContent = note || hint; }

  // --- TV services ---
  var subs = [];                                               // subscriptions must stay referenced or they stop
  function luna(uri, params, cb) {
    var B = window.WebOSServiceBridge || window.PalmServiceBridge;
    if (!B) return false;
    var b = new B();
    if (params && params.subscribe) subs.push(b);
    b.onservicecallback = function (msg) { var r = null; try { r = JSON.parse(msg); } catch (e) {} if (cb) cb(r || {}); };
    b.call(uri, JSON.stringify(params || {}));
    return true;
  }
  // Run a shell command as root through Homebrew Channel's exec service. cb(stdout, reply):
  // stdout is null when not on a rooted TV or when the command failed.
  function sh(cmd, cb) {
    var sent = luna("luna://org.webosbrew.hbchannel.service/exec", { command: cmd }, function (r) {
      var out = r.stdoutString;
      if (out == null && r.stdoutBytes) { try { out = atob(r.stdoutBytes); } catch (e) {} }
      cb(r.returnValue === false || out == null ? null : out, r);
    });
    if (!sent) cb(null, null);
  }

  // --- launcher tiles ---
  function buildGrid(list) {
    var keep = moved && apps[focus] && apps[focus].id, at = 0;
    apps = list; tiles = []; focus = 0; grid.innerHTML = "";
    cols = Math.max(1, Math.min(12, +CONFIG.columns || 6));
    grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    apps.forEach(function (a, i) {
      var d = document.createElement("div");
      d.className = "tile" + (a.title.length > 14 ? " long" : "");
      d.style.background = a.color;
      if (a.logo) {
        var img = document.createElement("img");
        img.src = a.logo; img.alt = a.title;
        img.onerror = function () { if (img.parentNode) d.removeChild(img); d.textContent = a.title; };  // fall back to the name
        d.appendChild(img);
      } else {
        d.textContent = a.title;
      }
      d.addEventListener("click", function () { setFocus(i); launch(a); });
      d.addEventListener("mouseenter", function () { moved = true; setFocus(i); });   // Magic Remote pointer
      grid.appendChild(d); tiles.push(d);
      if (a.id === keep) at = i;
    });
    setFocus(at);
  }
  function setFocus(i) {
    if (i < 0 || i >= tiles.length) return;
    if (tiles[focus]) tiles[focus].classList.remove("focus");
    focus = i;
    tiles[focus].classList.add("focus");
  }

  // Tile order: re-sorted once a day by time in use (usage.js), remembered for the rest of the day.
  var ORDER_KEY = "teledash.order";
  function tileList() {
    var list = Helpers.tiles(CONFIG.apps, tvList), saved = store(ORDER_KEY);
    if (CONFIG.tileOrder === "daily" && saved && saved.mins)
      list = Usage.order(list, saved.mins, Helpers.pinnedIds(CONFIG.apps, CONFIG.pinned));
    return list;
  }
  var pendingGrid = false;
  function refreshGrid() {                                     // never reshuffle a screen nobody is looking at
    if (isIdle() || isBrief()) pendingGrid = true;
    else buildGrid(tileList());
  }
  function dailyOrder() {
    if (CONFIG.tileOrder !== "daily") return;
    var today = new Date().toDateString(), saved = store(ORDER_KEY);
    if (saved && saved.day === today) return;
    function use(text) {
      if (text == null) return;
      store(ORDER_KEY, { day: today, mins: Usage.minutes(text, Date.now(), 30) });
      refreshGrid();
    }
    // "; true": no log yet must still count as an answer (an empty one), or this would start a
    // root shell every minute.
    function fromLog() { sh("tail -n 6000 " + DATA + "/usage.log 2>/dev/null; true", use); }
    if (Settings.serviceUp()) Settings.usage(function (t) { if (t != null) use(t); else fromLog(); });
    else fromLog();
  }
  // Installed apps, from the TV itself. ?demo=1 shows placeholder tiles when previewing on a computer.
  function loadTvApps() {
    if (/[?&]demo=1/.test(location.search)) {
      tvList = [];
      for (var i = 1; i <= 9; i++) tvList.push({ id: "example.app" + i, title: "App " + i });
      refreshGrid(); return;
    }
    luna("luna://com.webos.applicationManager/listApps", {}, function (r) {
      if (r.apps && r.apps.length) { tvList = r.apps; refreshGrid(); return; }
      // webOS may refuse the app list to a developer app (Assumed): ask for it as root instead.
      sh("luna-send -n 1 luna://com.webos.service.applicationmanager/listApps '{}'", function (out) {
        var i = out ? out.indexOf("{") : -1, d = null;
        if (i >= 0) { try { d = JSON.parse(out.slice(i)); } catch (e) {} }
        if (d && d.apps && d.apps.length) { tvList = d.apps; refreshGrid(); }
      });
    });
  }

  function launch(a, lgModeSet) {
    if (a.setup) { openSetup(); return; }
    if (!window.WebOSServiceBridge && !window.PalmServiceBridge) { say("Not running on the TV — would launch " + a.id); return; }
    // Exit tile ("All apps"): tell the kiosk script to let the LG home screen stay, by writing the
    // LG-mode flag as root. The script deletes it as soon as any other app comes to the front.
    // Home opens either way, even without root.
    if (a.exit && !lgModeSet) { sh("touch /tmp/teledash-lgmode", function () { launch(a, true); }); return; }
    say("Opening " + a.title + "…");
    luna("luna://com.webos.applicationManager/launch", { id: a.id }, function (r) {
      say(r.returnValue === false ? "Could not open " + a.title + ": " + (r.errorText || "unknown error") : "");
    });
  }

  // --- idle view and morning brief ---
  var idleEl = $("idle"), idleTimer = null, idleMs = 0;
  var qi = /[?&]idle=(\d+)/.exec(location.search);            // ?idle=5 to preview on a computer
  var qm = /[?&]morning=1/.test(location.search);              // ?morning=1 previews the brief
  function setIdleMs() { idleMs = (qi ? +qi[1] : +CONFIG.idleSeconds || 0) * 1000; }
  function isIdle() { return document.body.classList.contains("idle"); }
  function isBrief() { return document.body.classList.contains("brief"); }
  function inMorning(now) { return qm || Helpers.inMorning(CONFIG.morning, now || new Date()); }
  function showBrief() {
    document.body.classList.remove("idle"); document.body.classList.add("brief");
    setWeatherBackgroundPaused(false);
    renderBrief();
  }
  function drift() {
    if (!isIdle()) return;
    idleEl.style.transform = "translate(" + Math.round(60 + Math.random() * 1040) + "px," +
      Math.round(60 + Math.random() * 520) + "px)";
  }
  function goIdle() {
    if (overlay) { idleTimer = setTimeout(goIdle, idleMs); return; }   // not while the setup screen is up
    if (inMorning()) { showBrief(); return; }
    document.body.classList.remove("brief");
    document.body.classList.add("idle");
    setWeatherBackgroundPaused(true);
    setTimeout(drift, 100);
  }
  function wake() {                                            // returns true if it was idle or showing the brief
    var was = isIdle() || isBrief();
    if (was) { document.body.classList.remove("idle"); document.body.classList.remove("brief"); setWeatherBackgroundPaused(false); }
    if (pendingGrid) { pendingGrid = false; buildGrid(tileList()); }
    clearTimeout(idleTimer);
    if (idleMs > 0) idleTimer = setTimeout(goIdle, idleMs);
    return was;
  }
  setInterval(drift, 60000);
  // Each minute: brighten a dim screen into the brief when the morning window opens, dim the
  // brief when it closes, refresh the brief, and pick up a new day's tile order.
  setInterval(function () {
    if (isIdle() && inMorning()) showBrief();
    else if (isBrief() && !inMorning()) goIdle();
    else if (isBrief()) renderBrief();
    dailyOrder();
  }, 60000);
  document.addEventListener("mousemove", function () { wake(); });
  // Back in front: normally the dashboard. After a long absence inside the morning window (the TV
  // was just switched on), go straight to the brief. Catch up on anything that went stale meanwhile.
  var hiddenAt = null;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    var away = hiddenAt ? Date.now() - hiddenAt : 0;
    wake();
    if (away > 30 * 60000 && inMorning()) showBrief();
    if (away > 60000) { loadTvApps(); Settings.refresh(); }
    if (lastOk && new Date() - lastOk > REFRESH_MS) { weather(); calendar(); }
  });

  document.addEventListener("keydown", function (e) {
    var k = e.keyCode;
    if (overlay) { e.preventDefault(); wake(); overlayKey(k); return; }
    if (wake()) { e.preventDefault(); return; }                // first press only wakes the screen
    if (k >= 37 && k <= 40) moved = true;
    if (k === 37 && focus % cols !== 0) setFocus(focus - 1);                 // left
    else if (k === 39 && focus % cols !== cols - 1) setFocus(focus + 1);     // right
    else if (k === 38) setFocus(focus - cols);                               // up
    else if (k === 40) setFocus(Math.min(focus + cols, tiles.length - 1));   // down
    else if (k === 13) launch(apps[focus]);                                  // OK
    else if (k === 48 || k === 96 || k === 406) openSetup();                 // 0 or the blue key
    else return;
    e.preventDefault();
  });

  // --- clock ---
  function tick() {
    var n = new Date();
    $("clock").textContent = n.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/ ?[AP]M/, "");
    $("date").textContent = n.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    $("iclock").textContent = $("bclock").textContent = $("clock").textContent;
    $("idate").textContent = $("bdate").textContent = $("date").textContent;
    var c = CONFIG.countdowns;
    var cd = c ? Countdown.upcoming(n, c.withinDays || 45).slice(0, 2).map(Countdown.label) : [];
    $("count").textContent = cd.join("  ·  ");
    $("icount").textContent = cd[0] || "";
    $("bcount").textContent = cd.join("  ·  ");
  }
  setInterval(tick, 10000);

  // --- weather (open-meteo.com) ---
  var WX = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog",
    51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Snow", 73: "Snow", 75: "Heavy snow", 77: "Snow", 80: "Showers", 81: "Showers",
    82: "Heavy showers", 85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm" };
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Morning 6am-noon, Afternoon noon-6pm, Evening 6pm-midnight (hour indexes within a day).
  var PERIODS = [["Morning", 6, 12], ["Afternoon", 12, 18], ["Evening", 18, 24]];
  function el(cls, text) { var e = document.createElement("div"); e.className = cls; e.textContent = text; return e; }
  function rain(p) { return p == null ? "" : (p >= 20 ? Math.round(p) + "% precip" : ""); }
  function hm(d) { return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }

  // Average temperature, most common condition and highest precipitation chance over a block of hours.
  function summarise(h, from, to) {
    var sum = 0, n = 0, counts = {}, best = null, pmax = null, i;
    for (i = from; i < to; i++) {
      if (h.temperature_2m[i] == null) continue;
      sum += h.temperature_2m[i]; n++;
      var c = h.weather_code[i]; counts[c] = (counts[c] || 0) + 1;
      if (best === null || counts[c] > counts[best] || (counts[c] === counts[best] && c > best)) best = c;
      var p = h.precipitation_probability ? h.precipitation_probability[i] : null;
      if (p != null && (pmax === null || p > pmax)) pmax = p;
    }
    return n ? { temp: Math.round(sum / n), text: WX[best] || "", precip: pmax } : null;
  }
  function periodCell(h, day, p, hourNow) {
    var s = summarise(h, day * 24 + p[1], day * 24 + p[2]);
    var c = el("pcell" + (day === 0 && hourNow >= p[2] ? " past" : ""), "");
    c.appendChild(el("when", p[0]));
    c.appendChild(el("t", s ? s.temp + "°" : "–"));
    c.appendChild(el("s", s ? s.text : ""));
    c.appendChild(el("p", s ? rain(s.precip) : ""));
    return c;
  }

  // The left panel shows the calendar when one is loaded, otherwise today's and tomorrow's weather.
  // With neither (or no weather at all) the panels step aside.
  function layoutPanels() {
    $("forecast").style.display = CONFIG.weather || calEvents ? "" : "none";
    $("days").style.display = CONFIG.weather ? "" : "none";
  }
  function renderPeriods() {
    var box = $("periods");
    if (calEvents) { renderAgenda(); return; }
    box.innerHTML = "";
    if (!lastWx) return;
    var h = lastWx.hourly, hourNow = parseInt(lastWx.current.time.substr(11, 2), 10);
    ["Today", "Tomorrow"].forEach(function (name, day) {
      box.appendChild(el("ptitle", name));
      var row = el("prow", "");
      PERIODS.forEach(function (p) { row.appendChild(periodCell(h, day, p, hourNow)); });
      box.appendChild(row);
    });
  }

  var lastWx = null;
  function render(d) {
    lastWx = d;
    var r = Math.round, w = CONFIG.weather || {}, cur = d.current, dl = d.daily;
    // Preview any scene by adding e.g. ?wx=63&day=0 to the page address (computer preview only).
    var q = /[?&]wx=(\d+)/.exec(location.search), qd = /[?&]day=(\d)/.exec(location.search);
    setWeatherBackground(q ? +q[1] : cur.weather_code, qd ? qd[1] === "1" : cur.is_day === 1);
    var hilo = r(dl.temperature_2m_max[0]) + "° / " + r(dl.temperature_2m_min[0]) + "°";
    $("temp").textContent = r(cur.temperature_2m) + "°";
    $("wx").textContent = [WX[cur.weather_code] || "", w.label || "", hilo].filter(function (x) { return x; }).join(" · ");
    $("iwx").textContent = r(cur.temperature_2m) + "° · " + (WX[cur.weather_code] || "") + " · " + hilo;
    renderPeriods();
    var days = $("dayrow"); days.innerHTML = "";
    for (var i = 1; i <= 10 && i < dl.time.length; i++) {
      var t = dl.time[i].split("-"), dt = new Date(+t[0], +t[1] - 1, +t[2]);
      var c = el("day", "");
      c.appendChild(el("d", DOW[dt.getDay()]));
      c.appendChild(el("n", (dt.getMonth() + 1) + "/" + dt.getDate()));
      c.appendChild(el("hi", r(dl.temperature_2m_max[i]) + "°"));
      c.appendChild(el("lo", r(dl.temperature_2m_min[i]) + "°"));
      c.appendChild(el("s", WX[dl.weather_code[i]] || ""));
      c.appendChild(el("p", rain(dl.precipitation_probability_max ? dl.precipitation_probability_max[i] : null)));
      days.appendChild(c);
    }
    if (isBrief()) renderBrief();
  }
  function noWeather() {                                       // weather switched off: clear it all away
    lastWx = null; failed = false; lastOk = null;
    ["temp", "wx", "iwx", "dayrow"].forEach(function (id) { $(id).innerHTML = ""; });
    setWeatherBackground(3, false);                            // dark, slowly drifting clouds: nothing static on the OLED
    showNet(); layoutPanels(); renderPeriods();
    if (isBrief()) renderBrief();
  }

  var wxReq = null, wxTimer = null, failed = false, netUp = true, lastOk = null;
  function weather() {
    var w = CONFIG.weather;
    clearTimeout(wxTimer);
    if (wxReq) { wxReq.abort(); wxReq = null; }               // settings changed mid-request: start over
    layoutPanels();
    if (!w) { noWeather(); return; }
    var u = "https://api.open-meteo.com/v1/forecast?latitude=" + w.latitude + "&longitude=" + w.longitude +
      "&current=temperature_2m,weather_code,is_day" +
      "&hourly=temperature_2m,weather_code,precipitation_probability" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&forecast_days=11&timezone=auto" + (w.fahrenheit ? "&temperature_unit=fahrenheit" : "");
    var x = wxReq = new XMLHttpRequest();
    function done(ok) {
      wxReq = null; failed = !ok;
      if (ok) { lastOk = new Date(); netUp = true; }
      else if (navigator.onLine === false) netUp = false;
      showNet();
      wxTimer = setTimeout(weather, ok ? REFRESH_MS : RETRY_MS);
      if (ok && /[?&]offline=1/.test(location.search)) setUp(false);   // ?offline=1 previews the indicator
    }
    x.onload = function () {
      var ok = false;
      try { if (x.status === 200) { render(JSON.parse(x.responseText)); ok = true; } } catch (e) {}
      done(ok);
    };
    x.onerror = x.ontimeout = function () { done(false); };
    x.timeout = 15000;
    x.open("GET", u); x.send();
  }

  // --- offline indicator ---
  // The last good weather stays on screen; an amber line says how old it is. "Offline" means the
  // TV has no internet; "Weather not updating" means the TV is online but the weather service failed.
  function showNet() {
    var t = "";
    if (CONFIG.weather && (failed || !netUp)) {
      if (lastOk) {
        var at = hm(lastOk);
        if (lastOk.toDateString() !== new Date().toDateString()) at = DOW[lastOk.getDay()] + " " + at;
        t = netUp ? "Weather not updating · from " + at : "Offline · weather from " + at;
      } else {
        t = netUp ? "Weather unavailable" : "Offline";
      }
    } else if (!netUp) t = "Offline";
    $("net").textContent = t;
    $("inet").textContent = t;
  }
  function setUp(up) {
    var was = netUp; netUp = up; showNet();
    if (up && (!was || failed)) { weather(); calendar(); alerts(); air(); }   // back online: refresh straight away
  }
  window.addEventListener("offline", function () { setUp(false); });
  window.addEventListener("online", function () { setUp(true); });
  // The TV reports its own connection state, and again whenever it changes.
  luna("luna://com.webos.service.connectionmanager/getStatus", { subscribe: true }, function (r) {
    if (typeof r.isInternetConnectionAvailable === "boolean") setUp(r.isInternetConnectionAvailable);
  });

  // --- calendar: today's and tomorrow's events, fetched by the setup helper (iCal link or Google) ---
  var calEvents = null, calTimer = null, calSeq = 0, calKey = "", ROWS = 6;
  function calSource() { return (CONFIG.calendar && CONFIG.calendar.source) || "none"; }
  function agendaRows(box, list, day, max, emptyText) {
    var next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    var shown = list.length > max ? list.slice(0, max - 1) : list;
    shown.forEach(function (e) {
      var when = e.allDay || (e.start < day && e.end >= next) ? "All day" : e.start < day ? "to " + hm(e.end) : hm(e.start);
      var row = el("arow", "");
      row.appendChild(el("at", when)); row.appendChild(el("as", e.summary));
      box.appendChild(row);
    });
    if (!list.length) box.appendChild(el("arow quiet", emptyText));
    else if (list.length > max) box.appendChild(el("arow quiet", "+ " + (list.length - shown.length) + " more"));
  }
  function agenda(box, rows, minB) {                            // today's remaining events, then tomorrow's
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var all = Cal.eventsOn(calEvents, today), b = Cal.eventsOn(calEvents, tomorrow);
    var a = all.filter(function (e) { return e.allDay || e.end > now; });     // finished events drop off
    var rowsA = Math.min(Math.max(1, a.length), rows - Math.min(Math.max(1, b.length), minB));
    box.innerHTML = "";
    box.appendChild(el("ptitle", "Today"));
    agendaRows(box, a, today, rowsA, all.length ? "Nothing else today" : "Nothing scheduled");
    box.appendChild(el("ptitle agap", "Tomorrow"));
    agendaRows(box, b, tomorrow, Math.max(1, rows - rowsA), "Nothing scheduled");
  }
  function renderAgenda() { if (calEvents) agenda($("periods"), ROWS, 2); }
  function setCal(events) {
    calEvents = events;
    layoutPanels(); renderPeriods();
    if (isBrief()) renderBrief();
  }
  function calendar() {
    clearTimeout(calTimer);
    var my = ++calSeq, k = JSON.stringify(CONFIG.calendar || null);
    if (k !== calKey) { calKey = k; if (calEvents) setCal(null); }   // never show the old calendar under new settings
    if (calSource() === "none") return;
    if (!Settings.serviceUp()) return;                         // called again when the helper comes up
    Settings.calendar(function (d) {
      if (my !== calSeq) return;                               // settings changed meanwhile
      calTimer = setTimeout(calendar, d ? 10 * 60000 : RETRY_MS);
      if (!d) return;                                          // keep what is on screen
      try {
        if (d.source === "ical" && d.ics) setCal(Cal.parse(d.ics));
        else if (d.source === "google") setCal(Helpers.googleEvents(d.events));
        else if (d.source === "none") setCal(null);
      } catch (e) {}
    });
  }
  setInterval(renderAgenda, 60000);

  // --- alerts: National Weather Service warnings, and air quality (open-meteo) ---
  var alertText = "", alertSevere = false, alertSeq = 0, airSeq = 0;
  function showAlert() {
    ["alert", "ialert", "balert"].forEach(function (id) {
      var e = $(id);
      e.textContent = alertText; e.className = alertSevere ? "severe" : "";
    });
  }
  var SEV = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
  function alerts() {
    var w = CONFIG.weather, a = CONFIG.alerts, my = ++alertSeq;
    if (!w || !a || !a.warnings) { alertText = ""; alertSevere = false; showAlert(); return; }
    var x = new XMLHttpRequest();
    x.onload = function () {
      if (my !== alertSeq) return;
      try {
        var f = JSON.parse(x.responseText).features || [], best = null;
        f.forEach(function (it) {
          var p = it.properties || {};
          if (!best || (SEV[p.severity] || 0) > (SEV[best.severity] || 0)) best = p;
        });
        if (!best) { alertText = ""; alertSevere = false; }
        else {
          var end = best.ends || best.expires, t = best.event;
          if (end) {
            var e = new Date(end), same = e.toDateString() === new Date().toDateString();
            t += " · until " + (same ? "" : DOW[e.getDay()] + " ") + hm(e);
          }
          if (f.length > 1) t += "  (+" + (f.length - 1) + " more)";
          alertText = t; alertSevere = (SEV[best.severity] || 0) >= 3;
        }
        showAlert(); if (isBrief()) renderBrief();
      } catch (e) {}
    };
    x.timeout = 20000;
    x.open("GET", "https://api.weather.gov/alerts/active?point=" + w.latitude + "," + w.longitude); x.send();
  }
  var AQ = [[50, "Good", ""], [100, "Moderate", ""], [150, "Unhealthy for sensitive groups", "warn"],
    [200, "Unhealthy", "severe"], [300, "Very unhealthy", "severe"], [9999, "Hazardous", "severe"]];
  function showAir(text, cls) { var e = $("aq"); e.textContent = text; e.className = cls; $("baq").textContent = text; }
  function air() {
    var w = CONFIG.weather, a = CONFIG.alerts, my = ++airSeq;
    if (!w || !a || !a.airQuality) { showAir("", ""); return; }
    var x = new XMLHttpRequest();
    x.onload = function () {
      if (my !== airSeq) return;
      try {
        var v = JSON.parse(x.responseText).current.us_aqi;
        if (v == null) return;
        var c = AQ.filter(function (q) { return v <= q[0]; })[0];
        showAir("Air quality " + Math.round(v) + " · " + c[1], c[2]);
      } catch (err) {}
    };
    x.timeout = 20000;
    x.open("GET", "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + w.latitude +
      "&longitude=" + w.longitude + "&current=us_aqi&timezone=auto"); x.send();
  }

  // --- market strip: indexes from Yahoo, then the data feed's chips (fetched by the setup helper) ---
  var quotes = {}, feedData = null, feedKey = "", marketTimer = null, feedTimer = null;
  function money(v, dp) { return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function chip(label, value, change, changeText) {
    var s = document.createElement("span");
    s.className = "q";
    function part(cls, text) { var e = document.createElement("span"); e.className = cls; e.textContent = text; s.appendChild(e); }
    if (label) part("ql", label);
    part("qv", value);
    if (changeText != null) part("qc " + (change >= 0 ? "up" : "down"), (change >= 0 ? "▲ " : "▼ ") + changeText);
    return s;
  }
  function showMarket() {
    var m = CONFIG.market, f = CONFIG.feed, box = $("market");
    box.innerHTML = "";
    if (m && m.show !== false) (m.indexes || []).forEach(function (ix) {
      var q = quotes[ix.symbol];
      if (!q || !q.prev) return;
      var ch = q.price - q.prev;
      box.appendChild(chip(ix.label, money(q.price, 2), ch, Math.abs(ch / q.prev * 100).toFixed(2) + "%"));
    });
    if (f && f.enabled && feedData && feedData.items) {
      var title = feedData.title || f.title || "";
      feedData.items.forEach(function (it, i) {
        var label = it.label || "";
        if (i === 0 && title) label = label && label !== title ? title + " " + label : title;
        var ch = it.change == null || isNaN(+it.change) ? null : +it.change;
        box.appendChild(chip(label, Helpers.fmt(it.value, it.format), ch,
          ch == null ? null : Helpers.fmt(Math.abs(ch), it.format)));
      });
    }
  }
  function marketOpen(now) {                                   // US trading hours, roughly, in UTC (covers EST and EDT)
    var t = now.getUTCHours() * 60 + now.getUTCMinutes(), d = now.getUTCDay();
    return d > 0 && d < 6 && t >= 13 * 60 + 20 && t <= 21 * 60 + 15;
  }
  function yahoo(sym, cb) {
    var x = new XMLHttpRequest();
    x.onload = function () {
      try {
        var meta = JSON.parse(x.responseText).chart.result[0].meta;
        cb({ price: meta.regularMarketPrice, prev: meta.previousClose || meta.chartPreviousClose });
      } catch (e) { cb(null); }
    };
    x.onerror = x.ontimeout = function () { cb(null); };
    x.timeout = 15000;
    x.open("GET", "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?range=1d&interval=1d");
    x.send();
  }
  function market() {
    var m = CONFIG.market;
    clearTimeout(marketTimer);
    showMarket();
    if (!m || m.show === false) return;
    (m.indexes || []).forEach(function (ix) {
      yahoo(ix.symbol, function (q) { if (q && q.price) { quotes[ix.symbol] = q; showMarket(); } });
    });
    marketTimer = setTimeout(market, marketOpen(new Date()) ? 5 * 60000 : 60 * 60000);
  }
  function feed() {
    var f = CONFIG.feed, k = JSON.stringify(f || null);
    clearTimeout(feedTimer);
    if (k !== feedKey) { feedKey = k; feedData = null; showMarket(); }   // never show the old feed under new settings
    if (!f || !f.enabled) return;
    if (!Settings.serviceUp()) return;                         // called again when the helper comes up
    Settings.feed(function (d, status) {
      if (d && d.items) feedData = d;
      else if (status >= 400) feedData = null;                 // the helper says the feed is broken or gone: hide it
      showMarket();
    });
    feedTimer = setTimeout(feed, 5 * 60000);
  }

  // --- morning brief ---
  function renderBrief() {
    var row = $("bperiods");
    row.innerHTML = ""; $("bnow").textContent = "";
    if (lastWx) {
      var r = Math.round, cur = lastWx.current, dl = lastWx.daily, hourNow = parseInt(cur.time.substr(11, 2), 10);
      $("bnow").textContent = r(cur.temperature_2m) + "°  " + (WX[cur.weather_code] || "") +
        "  ·  " + r(dl.temperature_2m_max[0]) + "° / " + r(dl.temperature_2m_min[0]) + "°";
      PERIODS.forEach(function (p) { row.appendChild(periodCell(lastWx.hourly, 0, p, hourNow)); });
    }
    row.style.display = lastWx ? "" : "none";
    var box = $("bagenda");
    if (calEvents) { agenda(box, 11, 3); return; }
    box.innerHTML = "";
    box.appendChild(el("arow quiet", calSource() !== "none" ? "Calendar loading…" : "No calendar linked"));
  }
  setInterval(alerts, 10 * 60000); setInterval(air, 60 * 60000);

  // --- setup overlay: QR code for the phone, and the one-time helper install question ---
  // overlay: null, "setup" (pairing code) or "ask" (a question with buttons).
  var overlay = null, pairTimer = null, btns = [], btnFocus = 0, onBack = null;
  var hbc = null, appVersion = null, installing = false, CONSENT_KEY = "teledash.consent";
  function showOverlay(o) {
    $("sqr").innerHTML = o.qr || "";
    $("stitle").textContent = o.title || "";
    $("smsg").textContent = o.msg || "";
    $("surl").textContent = o.url || "";
    $("scode").textContent = o.code ? "Code  " + o.code : "";
    $("sfoot").textContent = o.foot || "";
    btns = o.buttons || []; btnFocus = 0; onBack = o.back || closeOverlay;
    var box = $("sbtns"); box.innerHTML = "";
    btns.forEach(function (b, i) {
      var e = el("btn" + (i === 0 ? " focus" : ""), b.label);
      e.addEventListener("click", function () { b.act(); });
      e.addEventListener("mouseenter", function () { focusBtn(i); });
      box.appendChild(e);
    });
    document.body.classList.add("setup");
  }
  function focusBtn(i) {
    var e = $("sbtns").childNodes;
    if (i < 0 || i >= e.length) return;
    if (e[btnFocus]) e[btnFocus].className = "btn";
    btnFocus = i; e[i].className = "btn focus";
  }
  function closeOverlay() {
    overlay = null; clearTimeout(pairTimer);
    document.body.classList.remove("setup");
    $("sqr").innerHTML = "";
  }
  function overlayKey(k) {
    if (k === 461 || k === 27 || k === 8) onBack();            // Back, Esc
    else if (k === 37) focusBtn(btnFocus - 1);
    else if (k === 39) focusBtn(btnFocus + 1);
    else if (k === 13 && btns[btnFocus]) btns[btnFocus].act();
  }

  function openSetup() { overlay = "setup"; pairing(); }
  function pairing() {
    clearTimeout(pairTimer);
    if (overlay !== "setup") return;
    if (/[?&]setup=demo/.test(location.search)) {              // computer preview of the QR screen
      showPair({ url: "http://192.168.1.50:8770/s/EXAMPLE1", code: "EXAMPLE1" }); return;
    }
    if (installing) { showOverlay({ title: "Installing the setup helper…", msg: "This takes a few seconds.", foot: "Back to close" }); return; }
    showOverlay({ title: "Set up TeleDash Pro", msg: "Getting a setup code…", foot: "Back to close" });
    Settings.pair(function (p) {
      if (overlay !== "setup") return;
      if (p) { showPair(p); return; }
      if (Settings.serviceUp()) {
        showOverlay({ title: "Set up TeleDash Pro", msg: "Could not get a setup code from the helper.",
          buttons: [{ label: "Try again", act: pairing }, { label: "Close", act: closeOverlay }] });
      } else helperMissing();
    });
  }
  function showPair(p) {
    showOverlay({ qr: typeof QR !== "undefined" ? QR.svg(p.url, 420) : "", title: "Set up TeleDash Pro",
      msg: "Scan with your phone on the same Wi-Fi", url: p.url, code: p.code,
      foot: "The code is good for 10 minutes and works once · Back to close" });
    pairTimer = setTimeout(pairing, 9 * 60000);                // fresh code before this one expires
  }
  function helperMissing() {
    if (hbc === null) {                                        // launch check not back yet: ask now
      sh("echo :ok", function (out) { hbc = out != null; if (overlay === "setup") helperMissing(); });
      return;
    }
    if (hbc) {
      showOverlay({ title: "The setup helper is not running",
        msg: "Phone setup needs a small helper that runs on this TV as root, through Homebrew Channel. " +
          "Install it now? It starts with the TV and can be removed at any time.",
        buttons: [{ label: "Install", act: function () { install(false); } }, { label: "Close", act: closeOverlay }] });
    } else {
      showOverlay({ title: "The setup helper is not installed",
        msg: "Phone setup needs a rooted TV with Homebrew Channel. Until then TeleDash Pro uses its built-in settings.",
        foot: "Back to close" });
    }
  }

  // Root helper: on launch, compare the helper's running version with ours. Never installed -> ask
  // once (Not now is remembered for 7 days); installed but older -> re-install quietly.
  function readVersion(cb) {
    var x = new XMLHttpRequest(), done = false;
    function fin(v) { if (!done) { done = true; cb(v); } }
    try {
      x.onload = function () { var v = null; try { v = JSON.parse(x.responseText).version; } catch (e) {} fin(v || null); };
      x.onerror = x.ontimeout = function () { fin(null); };
      x.open("GET", "appinfo.json"); x.timeout = 5000; x.send();
    } catch (e) { fin(null); }
  }
  function helperCheck() {
    readVersion(function (v) {
      appVersion = v;
      sh("cat " + DATA + "/running-version 2>/dev/null; echo :ok", function (out) {
        hbc = out != null;                                     // Homebrew Channel's exec service answered
        if (!hbc) return;
        var snooze = store(CONSENT_KEY);
        var act = Helpers.installAction(out.replace(/:ok\s*$/, ""), appVersion, snooze && snooze.until, Date.now());
        if (act === "silent") install(true);
        else if (act === "consent" && !overlay) askConsent();
      });
    });
  }
  function askConsent() {
    function notNow() { store(CONSENT_KEY, { until: Date.now() + 7 * 86400000 }); closeOverlay(); }
    overlay = "ask";
    showOverlay({ title: "Set up from your phone?",
      msg: "TeleDash Pro can install a small helper so you can set it up from your phone and make Home open TeleDash. Install?",
      foot: "You can do this later with the Set up tile.",
      buttons: [{ label: "OK", act: function () { closeOverlay(); install(false); } }, { label: "Not now", act: notNow }],
      back: notNow });
  }
  function lastLine(t) { var l = String(t || "").replace(/\s+$/, "").split("\n"); return l[l.length - 1]; }
  function install(silent) {
    if (installing) return;
    installing = true;
    say(silent ? "Updating the setup helper…" : "Installing the setup helper…");
    if (overlay === "setup") pairing();
    sh("sh " + APPDIR + "/system/install.sh 2>&1", function (out, r) {
      installing = false;
      // install.sh exits non-zero on failure, so its "install failed: <reason>" is only in the reply.
      if (out == null && r) out = r.stdoutString;
      var m = /installed (\S+)/.exec(out || "");
      if (m) {
        say("Setup helper " + (silent ? "updated" : "installed") + " (" + m[1] + ")");
        setTimeout(function () { Settings.refresh(); if (overlay === "setup") pairing(); }, 3000);   // give it time to start
      } else {
        say("Setup helper install failed: " + (lastLine(out) || (r && (r.stderrString || r.errorText)) || "no answer"));
        if (overlay === "setup") helperMissing();
      }
    });
  }

  // --- settings: rebuild everything from CONFIG whenever the helper reports a change ---
  function applySettings() {
    setIdleMs();
    buildGrid(tileList());
    tick(); weather(); alerts(); air(); market(); calendar(); feed();
    if (isBrief() && !inMorning()) goIdle();
    if (!isIdle() && !isBrief()) wake();
  }
  function onStatus(up) {
    setHint(up ? "" : "Setup helper not running");
    if (up) { calendar(); feed(); dailyOrder(); }
  }

  setIdleMs();
  buildGrid(tileList());
  tick(); weather(); alerts(); air(); market();
  wake();
  if (inMorning()) setTimeout(showBrief, 0);                   // fresh start (power-on) in the morning
  loadTvApps();
  dailyOrder();
  // The helper's key for /api/local (CONTRACT.md), readable only as root.
  function readKey(cb) { sh("cat " + DATA + "/local.token 2>/dev/null; true", function (out) { cb(out ? out.replace(/\s+/g, "") : ""); }); }
  Settings.start(applySettings, onStatus, readKey);
  helperCheck();
  if (/[?&]setup=demo/.test(location.search)) openSetup();
})();
