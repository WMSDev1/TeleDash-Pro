// TeleDash Pro setup page. Talks only to the TV that served it (and, for the city search, to
// Open-Meteo's free geocoding service straight from the phone). Every write sends X-TeleDash: 1.
(function () {
  "use strict";

  var ALL_APPS = { id: "com.webos.app.home", title: "All apps", exit: true };
  var S = null;            // settings as last saved on the TV
  var ST = null;           // /api/status
  var installed = [];      // [{ id, title }] from the TV
  var pick = [];           // working copy of the picked tiles
  var pinned = [];         // working copy of pinned ids
  var dates = [];          // working copy of countdown dates

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function say(section, text, ok) {
    var m = $(section + "-msg");
    m.textContent = text || "";
    m.className = "msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function ended() {
    var b = $("banner");
    b.textContent = "Your setup session has ended. Press OK on the TV for a new code, then scan it again.";
    b.hidden = false;
    $("main").hidden = true;
  }

  // fetch wrapper: JSON in and out, plain-English errors.
  function api(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (method !== "GET") opts.headers["X-TeleDash"] = "1";
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { ended(); throw new Error("Your setup session has ended."); }
        if (!r.ok) throw new Error(data.error || "The TV answered with an error (" + r.status + ").");
        return data;
      });
    }, function () {
      throw new Error("Could not reach the TV. Is the phone on the same Wi-Fi as the TV, and is the TV on?");
    });
  }

  // Saves a partial settings update and refreshes the page's copy.
  function saveSettings(section, patch, done) {
    say(section, "Saving…", true);
    return api("PUT", "/api/settings", patch).then(function (s) {
      S = s;
      say(section, done || "Saved. The TV will pick it up shortly.", true);
      return s;
    }).catch(function (e) { say(section, e.message, false); throw e; });
  }

  function refreshStatus() {
    return api("GET", "/api/status").then(function (st) { ST = st; renderStatus(); return st; });
  }

  // ---------------- calendar ----------------

  function radio(name) {
    var r = document.querySelector("input[name=" + name + "]:checked");
    return r ? r.value : null;
  }
  function setRadio(name, value) {
    var r = document.querySelector("input[name=" + name + "][value=" + value + "]");
    if (r) r.checked = true;
  }

  function showCalendarPanels() {
    var src = radio("calsource");
    $("cal-ical").hidden = src !== "ical";
    $("cal-google").hidden = src !== "google";
  }

  function renderStatus() {
    var st = ST.stored;
    $("ical-state").textContent = st.icalUrl ? "A calendar link is saved." : "No calendar link saved yet.";
    $("google-unavailable").hidden = ST.google.available;
    $("google-steps").hidden = !ST.google.available;
    $("google-redirect").textContent = ST.google.redirectUri || "";
    var canSignIn = ST.google.builtIn || st.googleClient;
    $("google-state").textContent = st.googleSignedIn ? "Signed in to Google." :
      canSignIn ? "Tap Sign in with Google, then pick the calendars to show." :
      "Open Advanced below and add your own Google client first.";
    $("google-signin").disabled = !canSignIn;
    $("google-warning").hidden = !!st.googleSignedIn;
    if (!ST.google.builtIn) $("google-own").open = true;          // the only way to sign in
    $("google-cals").hidden = !st.googleSignedIn;
    $("token-state").textContent = st.feedToken ? "A token is saved." : "No token saved.";
    var u = ST.update;
    $("update-state").textContent = "This TV runs version " + u.current +
      (u.latest ? (u.available ? ". Version " + u.latest + " is available." : ". It is up to date.") : ".") +
      (u.installing ? " An update is being installed now." : "") +
      (u.error ? " Last update problem: " + u.error : "");
    $("version").textContent = "TeleDash Pro " + ST.version;
  }

  function loadGoogleCalendars() {
    var box = $("google-cal-list");
    box.textContent = "Loading your calendars…";
    api("GET", "/api/google/calendars").then(function (list) {
      box.textContent = "";
      var chosen = S.calendar.calendars;
      list.forEach(function (c) {
        var l = el("label");
        var cb = el("input", { type: "checkbox", value: c.id });
        cb.checked = chosen.indexOf(c.id) >= 0 || (c.primary && chosen.indexOf("primary") >= 0);
        if (c.primary) cb.dataset.primary = "1";
        l.appendChild(cb);
        l.appendChild(document.createTextNode(c.summary + (c.primary ? " (main)" : "")));
        box.appendChild(l);
      });
      if (!list.length) box.textContent = "No calendars found in this Google account.";
    }).catch(function (e) { box.textContent = ""; say("calendar", e.message, false); });
  }

  function initCalendar() {
    setRadio("calsource", S.calendar.source);
    showCalendarPanels();
    Array.prototype.forEach.call(document.querySelectorAll("input[name=calsource]"), function (r) {
      r.addEventListener("change", function () {
        showCalendarPanels();
        var src = radio("calsource");
        // Switch the TV over only when the chosen source is ready; otherwise wait for its Save.
        if (src === "none" || (src === "ical" && ST.stored.icalUrl) || (src === "google" && ST.stored.googleSignedIn)) {
          saveSettings("calendar", { calendar: { source: src } });
        } else say("calendar", "");
      });
    });

    $("ical-save").addEventListener("click", function () {
      var url = $("ical-url").value.trim();
      if (!url) return say("calendar", "Paste the calendar link first.", false);
      say("calendar", "Saving…", true);
      api("POST", "/api/secrets", { icalUrl: url }).then(function () {
        $("ical-url").value = "";
        return refreshStatus();
      }).then(function () {
        return saveSettings("calendar", { calendar: { source: "ical" } }, "Calendar link saved. The TV will show it shortly.");
      }).catch(function (e) { say("calendar", e.message, false); });
    });
    $("ical-remove").addEventListener("click", function () { disconnect("icalUrl", "calendar", "The calendar link was removed."); });

    $("google-save").addEventListener("click", function () {
      var id = $("google-id").value.trim(), secret = $("google-secret").value.trim();
      if (!id || !secret) return say("calendar", "Paste both the client ID and the client secret.", false);
      api("POST", "/api/secrets", { google: { clientId: id, clientSecret: secret } }).then(function () {
        $("google-id").value = ""; $("google-secret").value = "";
        say("calendar", "Keys saved. Now tap Sign in with Google.", true);
        return refreshStatus();
      }).catch(function (e) { say("calendar", e.message, false); });
    });
    $("google-signin").addEventListener("click", function () {
      say("calendar", "Opening Google…", true);
      api("POST", "/api/google/start", {}).then(function (r) { location.href = r.authUrl; })
        .catch(function (e) { say("calendar", e.message, false); });
    });
    $("google-cals-save").addEventListener("click", function () {
      var ids = [];
      Array.prototype.forEach.call($("google-cal-list").querySelectorAll("input:checked"), function (cb) {
        ids.push(cb.dataset.primary ? "primary" : cb.value);
      });
      if (!ids.length) return say("calendar", "Pick at least one calendar.", false);
      saveSettings("calendar", { calendar: { calendars: ids } });
    });
    $("google-remove").addEventListener("click", function () { disconnect("google", "calendar", "Google was disconnected and its keys removed."); });

    if (ST.stored.googleSignedIn) loadGoogleCalendars();

    // Back from Google's sign-in page.
    var g = /[?&]google=(ok|error)/.exec(location.search);
    if (g) {
      history.replaceState(null, "", "/setup");
      if (g[1] === "ok") { say("calendar", "Signed in to Google. Pick the calendars to show.", true); setRadio("calsource", "google"); showCalendarPanels(); }
      else say("calendar", ST.google.lastError || "Google sign-in did not complete. Try again.", false);
      $("calendar").scrollIntoView();
    }
  }

  function disconnect(name, section, done) {
    if (!confirm("Remove this from the TV?")) return;
    api("DELETE", "/api/secrets/" + name).then(function () {
      return api("GET", "/api/settings");
    }).then(function (s) {
      S = s;
      setRadio("calsource", S.calendar.source);
      showCalendarPanels();
      say(section, done, true);
      return refreshStatus();
    }).catch(function (e) { say(section, e.message, false); });
  }

  // ---------------- weather ----------------

  function renderWeather() {
    var w = S.weather;
    $("weather-state").textContent = w ? "Weather for " + (w.label || (w.latitude + ", " + w.longitude)) : "Weather is off.";
    $("fahrenheit").checked = w ? w.fahrenheit : /US|LR|MM/.test(navigator.language || "");
    $("alert-warnings").checked = S.alerts.warnings;
    $("alert-air").checked = S.alerts.airQuality;
  }

  function setPlace(lat, lon, label) {
    saveSettings("weather", { weather: { latitude: lat, longitude: lon, label: label, fahrenheit: $("fahrenheit").checked } })
      .then(function () { $("city-results").textContent = ""; renderWeather(); }, function () {});
  }

  function initWeather() {
    renderWeather();
    function search() {
      var q = $("city").value.trim();
      var list = $("city-results");
      if (q.length < 2) return say("weather", "Type at least two letters of a city or town.", false);
      say("weather", "Searching…", true);
      fetch("https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=" + encodeURIComponent(q), { referrerPolicy: "no-referrer" })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (d) {
          list.textContent = "";
          var res = d.results || [];
          if (!res.length) return say("weather", "No place found with that name. Try a nearby larger town.", false);
          say("weather", "Tap your place:", true);
          res.forEach(function (p) {
            var label = p.name;
            var where = [p.admin1, p.country].filter(Boolean).join(", ");
            var b = el("button", { type: "button" }, label + (where ? " — " + where : ""));
            b.addEventListener("click", function () { setPlace(Math.round(p.latitude * 10) / 10, Math.round(p.longitude * 10) / 10, label); });
            var li = el("li"); li.appendChild(b); list.appendChild(li);
          });
        })
        .catch(function () { say("weather", "The place search did not answer. Check the phone's internet connection.", false); });
    }
    $("city-search").addEventListener("click", search);
    $("city").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });

    $("use-location").addEventListener("click", function () {
      // Phones only share location with https pages; the TV serves plain http on the home network.
      if (!window.isSecureContext || !navigator.geolocation) {
        return say("weather", "Your phone only shares its location with secure (https) pages, and the TV's setup page is not one. Search for your city instead.", false);
      }
      say("weather", "Asking the phone for its location…", true);
      navigator.geolocation.getCurrentPosition(function (pos) {
        setPlace(Math.round(pos.coords.latitude * 10) / 10, Math.round(pos.coords.longitude * 10) / 10, "Home");
      }, function () { say("weather", "The phone did not share its location. Search for your city instead.", false); },
      { maximumAge: 600000, timeout: 15000 });
    });
    $("weather-off").addEventListener("click", function () {
      saveSettings("weather", { weather: null }, "Weather is off.").then(renderWeather, function () {});
    });
    $("weather-save").addEventListener("click", function () {
      var patch = { alerts: { warnings: $("alert-warnings").checked, airQuality: $("alert-air").checked } };
      if (S.weather) patch.weather = { latitude: S.weather.latitude, longitude: S.weather.longitude, label: S.weather.label, fahrenheit: $("fahrenheit").checked };
      saveSettings("weather", patch).then(renderWeather, function () {});
    });
  }

  // ---------------- tiles ----------------

  function titleOf(id) {
    for (var i = 0; i < installed.length; i++) if (installed[i].id === id) return installed[i].title;
    return id;
  }

  function ensureAllApps() {
    if (!pick.some(function (a) { return a.id === ALL_APPS.id; })) pick.push(Object.assign({}, ALL_APPS));
    if (pinned.indexOf(ALL_APPS.id) < 0) pinned.push(ALL_APPS.id);
  }

  function renderTiles() {
    var mode = radio("tilemode");
    $("tiles-pick").hidden = mode !== "pick";
    $("tiles-auto-help").hidden = mode !== "auto";
    if (mode !== "pick") return;
    ensureAllApps();
    var list = $("tile-list");
    list.textContent = "";
    pick.forEach(function (a, i) {
      var li = el("li");
      li.appendChild(el("span", {}, a.title));
      var isPinned = pinned.indexOf(a.id) >= 0;
      var star = el("button", { type: "button", "class": "small", "aria-label": (isPinned ? "Unpin " : "Pin ") + a.title }, isPinned ? "★" : "☆");
      star.addEventListener("click", function () {
        if (a.id === ALL_APPS.id) return;
        if (isPinned) pinned.splice(pinned.indexOf(a.id), 1); else pinned.push(a.id);
        renderTiles();
      });
      var up = el("button", { type: "button", "class": "small", "aria-label": "Move " + a.title + " up" }, "↑");
      up.disabled = i === 0;
      up.addEventListener("click", function () { pick.splice(i - 1, 0, pick.splice(i, 1)[0]); renderTiles(); });
      var down = el("button", { type: "button", "class": "small", "aria-label": "Move " + a.title + " down" }, "↓");
      down.disabled = i === pick.length - 1;
      down.addEventListener("click", function () { pick.splice(i + 1, 0, pick.splice(i, 1)[0]); renderTiles(); });
      li.appendChild(star); li.appendChild(up); li.appendChild(down);
      if (a.id !== ALL_APPS.id) {
        var rm = el("button", { type: "button", "class": "small danger", "aria-label": "Remove " + a.title }, "✕");
        rm.addEventListener("click", function () {
          pick.splice(i, 1);
          if (pinned.indexOf(a.id) >= 0) pinned.splice(pinned.indexOf(a.id), 1);
          renderTiles();
        });
        li.appendChild(rm);
      }
      list.appendChild(li);
    });
    var sel = $("tile-add-select");
    sel.textContent = "";
    var have = pick.map(function (a) { return a.id; });
    var options = installed.filter(function (a) { return have.indexOf(a.id) < 0; });
    options.forEach(function (a) { sel.appendChild(el("option", { value: a.id }, a.title)); });
    if (!options.length) sel.appendChild(el("option", { value: "" }, installed.length ? "All installed apps are added" : "The TV did not list its apps"));
    $("tile-add").disabled = !options.length;
  }

  function initTiles() {
    setRadio("tilemode", S.apps ? "pick" : "auto");
    pick = (S.apps || []).map(function (a) { return Object.assign({}, a); });
    pinned = S.pinned.slice();
    $("tile-order").value = S.tileOrder;
    $("columns").value = S.columns;
    api("GET", "/api/apps").then(function (apps) { installed = apps; renderTiles(); }, function (e) { say("tiles", e.message, false); });
    Array.prototype.forEach.call(document.querySelectorAll("input[name=tilemode]"), function (r) {
      r.addEventListener("change", renderTiles);
    });
    $("tile-add").addEventListener("click", function () {
      var id = $("tile-add-select").value;
      if (!id) return;
      // New tiles go before the pinned ones at the end.
      var at = pick.length;
      while (at > 0 && pinned.indexOf(pick[at - 1].id) >= 0) at--;
      pick.splice(at, 0, { id: id, title: titleOf(id) });
      renderTiles();
    });
    $("tiles-save").addEventListener("click", function () {
      var cols = parseInt($("columns").value, 10);
      if (!(cols >= 2 && cols <= 10)) return say("tiles", "Tiles per row must be from 2 to 10.", false);
      var patch = { tileOrder: $("tile-order").value, columns: cols };
      if (radio("tilemode") === "pick") {
        ensureAllApps();
        patch.apps = pick;
        // Pinned ids in list order, so the end of the row matches what is shown here.
        patch.pinned = pick.map(function (a) { return a.id; }).filter(function (id) { return pinned.indexOf(id) >= 0; });
      } else {
        patch.apps = null;
      }
      saveSettings("tiles", patch).then(function (s) { pinned = s.pinned.slice(); renderTiles(); }, function () {});
    });
    renderTiles();
  }

  // ---------------- data feed ----------------

  function initFeed() {
    var f = S.feed;
    $("feed-enabled").checked = f.enabled;
    $("feed-title").value = f.title;
    $("feed-url").value = f.url;
    setRadio("feedformat", f.format);
    $("csv-date").value = f.csv.date; $("csv-value").value = f.csv.value;
    $("csv-flows").value = f.csv.flows; $("csv-time").value = f.csv.time;
    function showCsv() { $("feed-csv").hidden = radio("feedformat") !== "csv"; }
    showCsv();
    Array.prototype.forEach.call(document.querySelectorAll("input[name=feedformat]"), function (r) { r.addEventListener("change", showCsv); });

    $("feed-save").addEventListener("click", function () {
      saveSettings("feed", { feed: {
        enabled: $("feed-enabled").checked, title: $("feed-title").value, url: $("feed-url").value.trim(),
        format: radio("feedformat") || "json",
        csv: { date: $("csv-date").value, value: $("csv-value").value, flows: $("csv-flows").value, time: $("csv-time").value }
      } }).then(refreshStatus).catch(function () {});   // a new site removes the saved token
    });
    $("token-save").addEventListener("click", function () {
      var t = $("feed-token").value.trim();
      if (!t) return say("feed", "Paste the token first.", false);
      api("POST", "/api/secrets", { feedToken: t }).then(function () {
        $("feed-token").value = "";
        say("feed", "Token saved.", true);
        return refreshStatus();
      }).catch(function (e) { say("feed", e.message, false); });
    });
    $("token-remove").addEventListener("click", function () { disconnect("feedToken", "feed", "The token was removed."); });
  }

  // ---------------- morning ----------------

  function initMorning() {
    var m = S.morning;
    [["wd", m.weekdays, "06:30", "09:00"], ["we", m.weekends, "07:30", "10:00"]].forEach(function (g) {
      $(g[0] + "-on").checked = !!g[1];
      $(g[0] + "-from").value = g[1] ? g[1].from : g[2];
      $(g[0] + "-to").value = g[1] ? g[1].to : g[3];
    });
    $("morning-save").addEventListener("click", function () {
      function group(p) {
        if (!$(p + "-on").checked) return null;
        return { from: $(p + "-from").value.slice(0, 5), to: $(p + "-to").value.slice(0, 5) };
      }
      var wd = group("wd"), we = group("we");
      if ((wd && (!wd.from || !wd.to)) || (we && (!we.from || !we.to))) return say("morning", "Fill in both times, or untick the day group.", false);
      saveSettings("morning", { morning: { weekdays: wd, weekends: we } }).catch(function () {});
    });
  }

  // ---------------- countdowns ----------------

  function renderDates() {
    var list = $("cd-list");
    list.textContent = "";
    if (!dates.length) list.appendChild(el("li", {}, "No dates of your own yet."));
    dates.forEach(function (d, i) {
      var li = el("li");
      li.appendChild(el("span", {}, d.title + " — " + (d.date.length === 5 ? "every year on " + d.date : d.date)));
      var rm = el("button", { type: "button", "class": "small danger", "aria-label": "Remove " + d.title }, "✕");
      rm.addEventListener("click", function () { dates.splice(i, 1); renderDates(); say("countdowns", "Removed. Tap Save countdowns to keep the change.", true); });
      li.appendChild(rm);
      list.appendChild(li);
    });
  }

  function initCountdowns() {
    $("cd-holidays").checked = S.countdowns.holidays;
    $("cd-within").value = S.countdowns.withinDays;
    dates = S.countdowns.dates.map(function (d) { return { title: d.title, date: d.date }; });
    renderDates();
    $("cd-add").addEventListener("click", function () {
      var t = $("cd-title").value.trim(), d = $("cd-date").value;
      if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return say("countdowns", "Give the countdown a name and a date.", false);
      dates.push({ title: t, date: $("cd-yearly").checked ? d.slice(5) : d });
      $("cd-title").value = ""; $("cd-date").value = "";
      renderDates();
      say("countdowns", "Added. Tap Save countdowns to keep it.", true);
    });
    $("cd-save").addEventListener("click", function () {
      var within = parseInt($("cd-within").value, 10);
      if (!(within >= 1 && within <= 366)) return say("countdowns", "Days must be from 1 to 366.", false);
      saveSettings("countdowns", { countdowns: { holidays: $("cd-holidays").checked, withinDays: within, dates: dates } }).catch(function () {});
    });
  }

  // ---------------- screen, home, updates ----------------

  function initRest() {
    $("idle").value = S.idleSeconds;
    $("market-show").checked = S.market.show;
    $("screen-save").addEventListener("click", function () {
      var idle = parseInt($("idle").value, 10);
      if (!(idle >= 10 && idle <= 3600)) return say("screen", "Seconds must be from 10 to 3600.", false);
      saveSettings("screen", { idleSeconds: idle, market: { show: $("market-show").checked } }).catch(function () {});
    });

    $("home-on").checked = S.home.opensDashboard;
    $("home-delay").value = S.home.delaySeconds;
    $("home-save").addEventListener("click", function () {
      var d = parseInt($("home-delay").value, 10);
      if (!(d >= 0 && d <= 30)) return say("home", "The delay must be from 0 to 30 seconds.", false);
      saveSettings("home", { home: { opensDashboard: $("home-on").checked, delaySeconds: d } },
        "Saved. The TV restarts its helper; this page keeps working.").catch(function () {});
    });

    $("update-auto").checked = S.updates.auto;
    $("update-save").addEventListener("click", function () {
      saveSettings("updates", { updates: { auto: $("update-auto").checked } }).then(refreshStatus).catch(function () {});
    });
    $("update-now").addEventListener("click", function () {
      say("updates", "Checking for an update…", true);
      api("POST", "/api/update", {}).then(function () {
        say("updates", "The update is downloading and will install by itself. TeleDash restarts when it is done.", true);
        return refreshStatus();
      }).catch(function (e) { say("updates", e.message, false); });
    });
  }

  // ---------------- start ----------------

  Promise.all([api("GET", "/api/settings"), api("GET", "/api/status")]).then(function (r) {
    S = r[0]; ST = r[1];
    $("main").hidden = false;
    renderStatus();
    initCalendar(); initWeather(); initTiles(); initFeed(); initMorning(); initCountdowns(); initRest();
  }).catch(function (e) {
    if (!$("banner").hidden) return;
    $("banner").textContent = e.message;
    $("banner").hidden = false;
  });
})();
