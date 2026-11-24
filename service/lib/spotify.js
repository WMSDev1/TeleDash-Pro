"use strict";
// Spotify: sign-in (authorization code + PKCE, no client secret) and the Web API calls behind the
// Music view (CONTRACT.md "Spotify"). The owner brings their own Spotify developer app: Spotify
// caps a development-mode app at five users, so no client can be built into the package.
// Spotify sends the phone back through the project's GitHub Pages site (<pagesBase>/oauth/), the
// same return page Google uses; the server tells the two apart by the state's nonce (owns()).
// Tokens stay in secrets.json: the dashboard only ever sees the normalised results below.
var util = require("./util");
var http = require("./http");
var secrets = require("./secrets");
var settings = require("./settings");

var AUTH = "https://accounts.spotify.com/authorize";
var TOKEN = "https://accounts.spotify.com/api/token";
var API = "https://api.spotify.com/v1";
var SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing " +
  "user-library-read user-library-modify playlist-read-private playlist-read-collaborative " +
  "user-read-recently-played";
var STATE_MS = 10 * 60 * 1000;
var STATE_CACHE_MS = 1000;

var URI_RE = /^spotify:(track|episode|album|playlist|artist|show):[A-Za-z0-9]{22}$/;
var ID_RE = /^[A-Za-z0-9]{22}$/;
var DEVICE_RE = /^[A-Za-z0-9_-]{1,100}$/;

var pending = new Map();                       // nonce -> { verifier, expires, client }
var refreshInFlight = null;
var stateCache = null;                         // { at, value }
var stateInFlight = null;
var stateGen = 0;                              // prevents a stale in-flight state read from refilling the cache
var likedCache = null;                         // { uri, value }

function clearStateCache() {
  stateCache = null;
  stateInFlight = null;
  stateGen++;
}

function _reset() {
  clearStateCache();
  likedCache = null;
  refreshInFlight = null;
}

function clientId() {
  var sp = secrets.load().spotify || {};
  return sp.clientId || null;
}

function redirectUri(pagesBase) { return pagesBase.replace(/\/+$/, "") + "/oauth/"; }

function prune() {
  var now = Date.now();
  pending.forEach(function (v, k) { if (v.expires <= now) pending.delete(k); });
  while (pending.size > 5) pending.delete(pending.keys().next().value);   // oldest first
}

function decodeNonce(state) {
  if (typeof state !== "string" || !state) return null;
  try {
    var obj = JSON.parse(util.fromB64url(state).toString("utf8"));
    return obj && typeof obj.n === "string" ? obj.n : null;
  } catch (e) {
    return null;
  }
}

// origin: "http://<lan-ip>:<port>" — where the Pages site should send the phone back to.
function start(origin, pagesBase) {
  if (!pagesBase) throw util.httpError(400, "Spotify sign-in is not available in this build of TeleDash Pro (it has no sign-in web page). Install a release build.");
  if (!origin) throw util.httpError(500, "The TV has no network address to return to. Check its network connection.");
  var cid = clientId();
  if (!cid) throw util.httpError(400, "Add your Spotify client ID on the setup page first.");
  var nonce = util.randomToken(16);
  var verifier = util.randomToken(32);                           // 43 characters, as PKCE wants
  var challenge = util.b64url(util.sha256(verifier));
  pending.set(nonce, { verifier: verifier, expires: Date.now() + STATE_MS, client: cid });
  prune();
  var state = util.b64url(Buffer.from(JSON.stringify({ t: origin, n: nonce })));
  var q = {
    client_id: cid, response_type: "code", redirect_uri: redirectUri(pagesBase),
    scope: SCOPES, state: state, code_challenge: challenge, code_challenge_method: "S256"
  };
  return { authUrl: AUTH + "?" + http.form(q), state: state };
}

// True only when this state belongs to an active Spotify sign-in; never consumes the nonce.
function owns(state) {
  var nonce = decodeNonce(state);
  if (!nonce) return false;
  var entry = pending.get(nonce);
  return !!(entry && entry.expires > Date.now());
}

// Completes sign-in from /oauth/return?code&state. The state's nonce is single use.
function finish(query, pagesBase) {
  query = query || {};
  var nonce = decodeNonce(query.state);
  var entry = nonce ? pending.get(nonce) : null;
  if (nonce) pending.delete(nonce);
  if (!entry || entry.expires <= Date.now()) return Promise.reject(util.httpError(400, "This sign-in link has expired or was already used. Start again from the setup page."));
  if (query.error) return Promise.reject(util.httpError(400, query.error === "access_denied" ? "Spotify sign-in was cancelled." : "Spotify reported a problem with the sign-in."));
  if (!query.code) return Promise.reject(util.httpError(400, "Spotify did not send a sign-in code."));
  var cid = clientId();
  if (!cid || cid !== entry.client) return Promise.reject(util.httpError(400, "The Spotify client ID changed during sign-in. Start again from the setup page."));
  return http.json({
    url: TOKEN, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: http.form({
      grant_type: "authorization_code", code: query.code,
      redirect_uri: redirectUri(pagesBase), client_id: cid, code_verifier: entry.verifier
    })
  }).catch(function (e) {
    throw util.httpError(502, e.data && e.data.error === "invalid_client"
      ? "Spotify did not accept the client ID. Check it and try again."
      : "Spotify did not complete the sign-in. " + e.message);
  }).then(function (t) {
    if (!t.refresh_token) throw util.httpError(502, "Spotify did not grant lasting access. Try signing in again.");
    secrets.saveSpotify({
      refreshToken: t.refresh_token, accessToken: t.access_token,
      expiry: Date.now() + (Number(t.expires_in) || 3600) * 1000
    });
    settings.save({ music: { tile: true } });
    clearStateCache();
    likedCache = null;
  });
}

// Concurrent callers share one refresh request so Spotify's rotating refresh tokens do not race.
function refresh(sp) {
  if (refreshInFlight) return refreshInFlight;
  if (!sp.clientId) return Promise.reject(util.httpError(401, "Spotify access has expired or was revoked. Sign in again on the setup page."));
  var p = http.json({
    url: TOKEN, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: http.form({ grant_type: "refresh_token", refresh_token: sp.refreshToken, client_id: sp.clientId })
  }).then(function (t) {
    var fields = { accessToken: t.access_token, expiry: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
    if (t.refresh_token) fields.refreshToken = t.refresh_token;
    secrets.saveSpotify(fields);
    return t.access_token;
  }, function (e) {
    if (e.data && e.data.error === "invalid_grant") {
      // Revoked or expired for good: forget the tokens so the setup page shows "not connected".
      secrets.saveSpotify({ refreshToken: undefined, accessToken: undefined, expiry: undefined });
      throw util.httpError(401, "Spotify access has expired or was revoked. Sign in again on the setup page.");
    }
    throw e;
  });
  refreshInFlight = p;
  function clear() { if (refreshInFlight === p) refreshInFlight = null; }
  p.then(clear, clear);
  return p;
}

function getAccessToken(force) {
  var sp = secrets.load().spotify || {};
  if (!sp.refreshToken) return Promise.reject(util.httpError(409, "Spotify is not connected. Sign in on the setup page."));
  if (!force && sp.accessToken && sp.expiry > Date.now() + 60000) return Promise.resolve(sp.accessToken);
  return refresh(sp);
}

// A current access token, refreshed when it is within a minute of expiring.
function accessToken() { return getAccessToken(false); }

// ---------- Web API ----------

function parseJson(buf) {
  if (!buf) return null;
  var text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// Player commands answer 200/202/204 with an empty body, so this uses http.request directly.
function call(method, path, opts) {
  function send(token, retried) {
    var headers = { Authorization: "Bearer " + token, Accept: "application/json" };
    var reqOpts = { url: API + path, method: method, headers: headers, timeout: 10000 };
    if (opts && opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      reqOpts.body = JSON.stringify(opts.body);
    }
    return http.request(reqOpts).then(function (r) {
      if (r.status >= 200 && r.status <= 299) return parseJson(r.body);
      if (r.status === 401 && !retried) {
        return getAccessToken(true).then(function (tok) { return send(tok, true); });
      }
      var data = parseJson(r.body);
      var reason = data && data.error && typeof data.error === "object" ? data.error.reason : null;
      if (r.status === 404 && reason === "NO_ACTIVE_DEVICE") {
        throw util.httpError(409, "No Spotify device is active. Start Spotify on a phone or speaker, or pick a device in the Music library.");
      }
      if (r.status === 403 && reason === "PREMIUM_REQUIRED") {
        throw util.httpError(403, "Spotify Premium is needed to control playback.");
      }
      if (r.status === 429) {
        throw util.httpError(429, "Spotify is asking us to slow down. Try again in a moment.");
      }
      throw util.httpError(502, "Spotify answered with an error (HTTP " + r.status + ").");
    });
  }
  return getAccessToken(false).then(function (token) { return send(token, false); });
}

function widestImage(images) {
  if (!Array.isArray(images) || !images.length) return "";
  var best = null, bestW = -1;
  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    if (!img || !img.url) continue;
    var w = typeof img.width === "number" ? img.width : 0;
    if (best === null || w > bestW) { best = img.url; bestW = w; }
  }
  return best || "";
}

function artistNames(artists) {
  if (!Array.isArray(artists)) return "";
  var names = [];
  for (var i = 0; i < artists.length; i++) {
    if (artists[i] && artists[i].name) names.push(artists[i].name);
  }
  return names.join(", ");
}

function lookupLiked(uri) {
  if (!uri) return Promise.resolve(null);
  if (likedCache && likedCache.uri === uri) return Promise.resolve(likedCache.value);
  return call("GET", "/me/library/contains?uris=" + encodeURIComponent(uri)).then(function (arr) {
    var val = Array.isArray(arr) && typeof arr[0] === "boolean" ? arr[0] : null;
    if (val !== null) likedCache = { uri: uri, value: val };
    return val;
  }, function () {
    return null;
  });
}

// Now-playing snapshot, cached for 1 s; concurrent callers share one in-flight read.
function state() {
  var sp = secrets.load().spotify || {};
  if (!sp.refreshToken) return Promise.resolve({ connected: false });
  var now = Date.now();
  if (stateCache && now >= stateCache.at && now - stateCache.at < STATE_CACHE_MS) {
    return Promise.resolve(stateCache.value);
  }
  if (stateInFlight) return stateInFlight;

  var gen = stateGen;
  var p = call("GET", "/me/player?additional_types=track,episode").then(function (data) {
    var at = Date.now();
    if (!data) {
      return {
        connected: true, active: false, playing: false, progressMs: 0, durationMs: 0,
        at: at, shuffle: false, repeat: "off", device: null, track: null
      };
    }
    var item = data.item || null;
    var repeat = data.repeat_state === "context" || data.repeat_state === "track" ? data.repeat_state : "off";
    var device = data.device ? {
      id: data.device.id || "",
      name: data.device.name || "",
      type: data.device.type || "",
      volume: data.device.supports_volume === false || typeof data.device.volume_percent !== "number"
        ? null : data.device.volume_percent
    } : null;
    var base = {
      connected: true, active: true, playing: !!data.is_playing,
      progressMs: data.progress_ms || 0, durationMs: item ? item.duration_ms || 0 : 0,
      at: at, shuffle: !!data.shuffle_state, repeat: repeat, device: device, track: null
    };
    if (!item) return base;
    if (item.type === "episode") {
      base.track = {
        uri: item.uri || "", title: item.name || "",
        artist: item.show && item.show.name ? item.show.name : "",
        album: "", art: widestImage(item.images), liked: null
      };
      return base;
    }
    var uri = item.uri || "";
    return lookupLiked(uri).then(function (liked) {
      base.track = {
        uri: uri, title: item.name || "", artist: artistNames(item.artists),
        album: item.album && item.album.name ? item.album.name : "",
        art: widestImage(item.album && item.album.images), liked: liked
      };
      return base;
    });
  }).then(function (result) {
    if (stateInFlight === p) stateInFlight = null;
    if (gen === stateGen) stateCache = { at: Date.now(), value: result };
    return result;
  }, function (e) {
    if (stateInFlight === p) stateInFlight = null;
    throw e;
  });

  stateInFlight = p;
  return p;
}

// ---------- commands ----------

function isWhole(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

function checkFields(body, allowed) {
  var keys = Object.keys(body);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] !== "do" && allowed.indexOf(keys[i]) < 0) {
      throw util.httpError(400, "Unknown field: " + keys[i]);
    }
  }
}

function checkUri(v, types, label) {
  if (typeof v !== "string") throw util.httpError(400, label + " must be a Spotify URI.");
  var m = URI_RE.exec(v);
  if (!m || types.indexOf(m[1]) < 0) {
    throw util.httpError(400, label + " must be a valid Spotify " + types.join("/") + " URI.");
  }
  return v;
}

function checkDeviceId(v) {
  if (typeof v !== "string" || !DEVICE_RE.test(v)) throw util.httpError(400, "deviceId is not valid.");
  return v;
}

function command(body) {
  var method, path, opts, after;
  try {
    if (!util.isObject(body)) throw util.httpError(400, "Send the music command as an object.");
    var cmd = body.do;
    if (typeof cmd !== "string" || !cmd) throw util.httpError(400, "Music command needs a do field.");

    if (cmd === "play") {
      checkFields(body, ["context", "uris", "offsetUri", "deviceId"]);
      method = "PUT";
      path = "/me/player/play";
      if (body.deviceId !== undefined) path += "?device_id=" + encodeURIComponent(checkDeviceId(body.deviceId));
      if (body.context !== undefined && body.uris !== undefined) {
        throw util.httpError(400, "play cannot take both context and uris.");
      }
      if (body.context !== undefined) {
        var ctxBody = { context_uri: checkUri(body.context, ["album", "playlist", "artist", "show"], "context") };
        if (body.offsetUri !== undefined) ctxBody.offset = { uri: checkUri(body.offsetUri, ["track", "episode"], "offsetUri") };
        opts = { body: ctxBody };
      } else if (body.uris !== undefined) {
        if (!Array.isArray(body.uris) || body.uris.length < 1 || body.uris.length > 50) {
          throw util.httpError(400, "uris must be a list of 1 to 50 track or episode URIs.");
        }
        var uris = [];
        for (var i = 0; i < body.uris.length; i++) {
          uris.push(checkUri(body.uris[i], ["track", "episode"], "uris[" + i + "]"));
        }
        var urisBody = { uris: uris };
        if (body.offsetUri !== undefined) urisBody.offset = { uri: checkUri(body.offsetUri, ["track", "episode"], "offsetUri") };
        opts = { body: urisBody };
      } else if (body.offsetUri !== undefined) {
        throw util.httpError(400, "offsetUri requires context or uris.");
      }
    } else if (cmd === "pause") {
      checkFields(body, []);
      method = "PUT"; path = "/me/player/pause";
    } else if (cmd === "next") {
      checkFields(body, []);
      method = "POST"; path = "/me/player/next";
    } else if (cmd === "previous") {
      checkFields(body, []);
      method = "POST"; path = "/me/player/previous";
    } else if (cmd === "seek") {
      checkFields(body, ["ms"]);
      if (!isWhole(body.ms) || body.ms < 0) throw util.httpError(400, "seek needs ms (a whole number, 0 or more).");
      method = "PUT"; path = "/me/player/seek?position_ms=" + body.ms;
    } else if (cmd === "shuffle") {
      checkFields(body, ["on"]);
      if (typeof body.on !== "boolean") throw util.httpError(400, "shuffle needs on (true or false).");
      method = "PUT"; path = "/me/player/shuffle?state=" + (body.on ? "true" : "false");
    } else if (cmd === "repeat") {
      checkFields(body, ["mode"]);
      if (body.mode !== "off" && body.mode !== "context" && body.mode !== "track") {
        throw util.httpError(400, "repeat needs mode (off, context, or track).");
      }
      method = "PUT"; path = "/me/player/repeat?state=" + body.mode;
    } else if (cmd === "volume") {
      checkFields(body, ["percent"]);
      if (!isWhole(body.percent) || body.percent < 0 || body.percent > 100) {
        throw util.httpError(400, "volume needs percent (a whole number from 0 to 100).");
      }
      method = "PUT"; path = "/me/player/volume?volume_percent=" + body.percent;
    } else if (cmd === "transfer") {
      checkFields(body, ["deviceId", "play"]);
      var devId = checkDeviceId(body.deviceId);
      if (body.play !== undefined && typeof body.play !== "boolean") {
        throw util.httpError(400, "transfer play must be true or false.");
      }
      method = "PUT"; path = "/me/player";
      opts = { body: { device_ids: [devId], play: !!body.play } };
    } else if (cmd === "queue") {
      checkFields(body, ["uri"]);
      var qUri = checkUri(body.uri, ["track", "episode"], "uri");
      method = "POST"; path = "/me/player/queue?uri=" + encodeURIComponent(qUri);
    } else if (cmd === "like" || cmd === "unlike") {
      checkFields(body, ["uri"]);
      var lUri = checkUri(body.uri, ["track"], "uri");
      method = cmd === "like" ? "PUT" : "DELETE";
      path = "/me/library?uris=" + encodeURIComponent(lUri);
      after = function () { likedCache = { uri: lUri, value: cmd === "like" }; };
    } else {
      throw util.httpError(400, "Unknown music command: " + cmd);
    }
  } catch (e) {
    return Promise.reject(e);
  }

  return call(method, path, opts).then(function () {
    if (after) after();
    clearStateCache();
    return { ok: true };
  });
}

// ---------- library lists ----------

function parseOffset(v) {
  if (v === undefined || v === null || v === "") return 0;
  var n = typeof v === "string" && /^\d+$/.test(v) ? parseInt(v, 10) : v;
  if (!isWhole(n) || n < 0) throw util.httpError(400, "offset must be a whole number, 0 or more.");
  return n;
}

function checkId(v, kind) {
  if (typeof v !== "string" || !ID_RE.test(v)) throw util.httpError(400, kind + " needs a valid Spotify id.");
  return v;
}

function normTrack(t, coverArt) {
  if (!t) return null;
  if (t.type === "episode") {
    return {
      kind: "track", uri: t.uri || "", id: t.id || "", title: t.name || "",
      subtitle: t.show && t.show.name ? t.show.name : "",
      art: coverArt !== undefined ? coverArt : widestImage(t.images)
    };
  }
  return {
    kind: "track", uri: t.uri || "", id: t.id || "", title: t.name || "",
    subtitle: artistNames(t.artists),
    art: coverArt !== undefined ? coverArt : widestImage(t.album && t.album.images)
  };
}

function normAlbum(a) {
  if (!a) return null;
  return {
    kind: "album", uri: a.uri || "", id: a.id || "", title: a.name || "",
    subtitle: artistNames(a.artists), art: widestImage(a.images)
  };
}

function normPlaylist(p) {
  if (!p) return null;
  var owner = p.owner && p.owner.display_name ? p.owner.display_name : "";
  var total = p.items && typeof p.items.total === "number" ? p.items.total
    : p.tracks && typeof p.tracks.total === "number" ? p.tracks.total : null;
  var count = total !== null ? total + " songs" : "";
  var subtitle = owner && count ? owner + " · " + count : (owner || count);
  return {
    kind: "playlist", uri: p.uri || "", id: p.id || "", title: p.name || "",
    subtitle: subtitle, art: widestImage(p.images)
  };
}

function normDevice(d) {
  if (!d) return null;
  return {
    kind: "device", uri: "", id: d.id || "", title: d.name || "",
    subtitle: d.type || "", art: "", active: !!d.is_active
  };
}

function pageResult(r, offset, mapEntry) {
  var raw = r && Array.isArray(r.items) ? r.items : [];
  var items = [];
  for (var i = 0; i < raw.length; i++) {
    var item = mapEntry(raw[i]);
    if (item) items.push(item);
  }
  return { items: items, next: r && r.next ? offset + raw.length : null };
}

function list(kind, opts) {
  opts = opts || {};
  var offset;
  try {
    offset = parseOffset(opts.offset);
  } catch (e) {
    return Promise.reject(e);
  }

  if (kind === "playlists") {
    return call("GET", "/me/playlists?limit=50&offset=" + offset).then(function (r) {
      return pageResult(r, offset, normPlaylist);
    });
  }
  if (kind === "albums") {
    return call("GET", "/me/albums?limit=50&offset=" + offset).then(function (r) {
      return pageResult(r, offset, function (e) { return e ? normAlbum(e.album) : null; });
    });
  }
  if (kind === "liked") {
    return call("GET", "/me/tracks?limit=50&offset=" + offset).then(function (r) {
      return pageResult(r, offset, function (e) { return e ? normTrack(e.track) : null; });
    });
  }
  if (kind === "recent") {
    return call("GET", "/me/player/recently-played?limit=50").then(function (r) {
      var raw = r && Array.isArray(r.items) ? r.items : [];
      var seen = Object.create(null);
      var items = [];
      for (var i = 0; i < raw.length; i++) {
        var item = raw[i] ? normTrack(raw[i].track) : null;
        if (!item) continue;
        if (item.uri && seen[item.uri]) continue;
        if (item.uri) seen[item.uri] = true;
        items.push(item);
      }
      return { items: items, next: null };
    });
  }
  if (kind === "playlist") {
    var pid;
    try { pid = checkId(opts.id, "playlist"); } catch (e) { return Promise.reject(e); }
    return call("GET", "/playlists/" + pid + "/items?limit=50&offset=" + offset + "&additional_types=track,episode").then(function (r) {
      return pageResult(r, offset, function (e) { return e ? normTrack(e.item || e.track) : null; });
    });
  }
  if (kind === "album") {
    var aid;
    try { aid = checkId(opts.id, "album"); } catch (e) { return Promise.reject(e); }
    return Promise.all([
      call("GET", "/albums/" + aid),
      call("GET", "/albums/" + aid + "/tracks?limit=50&offset=" + offset)
    ]).then(function (res) {
      var cover = widestImage(res[0] && res[0].images);
      return pageResult(res[1], offset, function (t) { return normTrack(t, cover); });
    });
  }
  if (kind === "queue") {
    return call("GET", "/me/player/queue").then(function (r) {
      var items = [];
      if (r && r.currently_playing) {
        var cur = normTrack(r.currently_playing);
        if (cur) items.push(cur);
      }
      var q = r && Array.isArray(r.queue) ? r.queue : [];
      for (var i = 0; i < q.length; i++) {
        var it = normTrack(q[i]);
        if (it) items.push(it);
      }
      return { items: items, next: null };
    });
  }
  if (kind === "devices") {
    return call("GET", "/me/player/devices").then(function (r) {
      var raw = r && Array.isArray(r.devices) ? r.devices : [];
      var items = [];
      for (var i = 0; i < raw.length; i++) {
        var dev = normDevice(raw[i]);
        if (dev) items.push(dev);
      }
      return { items: items, next: null };
    });
  }
  if (kind === "search") {
    var q = typeof opts.q === "string" ? opts.q.trim() : "";
    if (!q || q.length > 100) return Promise.reject(util.httpError(400, "search needs q (1 to 100 characters)."));
    return call("GET", "/search?type=track,album,playlist&limit=10&offset=" + offset + "&q=" + encodeURIComponent(q)).then(function (r) {
      var tr = r && r.tracks ? r.tracks : {};
      var al = r && r.albums ? r.albums : {};
      var pl = r && r.playlists ? r.playlists : {};
      var items = []
        .concat((Array.isArray(tr.items) ? tr.items : []).map(function (t) { return normTrack(t); }))
        .concat((Array.isArray(al.items) ? al.items : []).map(normAlbum))
        .concat((Array.isArray(pl.items) ? pl.items : []).map(normPlaylist))
        .filter(Boolean);
      var hasNext = !!(tr.next || al.next || pl.next);
      return { items: items, next: hasNext ? offset + 10 : null };
    });
  }
  return Promise.reject(util.httpError(400, "Unknown music list: " + kind));
}

module.exports = {
  redirectUri: redirectUri,
  start: start,
  owns: owns,
  finish: finish,
  accessToken: accessToken,
  state: state,
  command: command,
  list: list,
  SCOPES: SCOPES,
  _pending: pending,
  _reset: _reset
};
