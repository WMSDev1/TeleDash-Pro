"use strict";
// Spotify sign-in (PKCE, no client secret), token refresh, now-playing state, playback commands
// and library lists, with the HTTP transport mocked: no request ever reaches Spotify.
var t = require("./harness");
var assert = require("assert");
var URL = require("url").URL;
var util = require("../lib/util");
var http = require("../lib/http");
var secrets = require("../lib/secrets");
var settings = require("../lib/settings");
var spotify = require("../lib/spotify");

var PAGES = "https://example.github.io/teledash-pro";
var ORIGIN = "http://192.168.1.50:8770";
var CID = "0123456789abcdef0123456789abcdef";
var CID2 = "fedcba9876543210fedcba9876543210";
var ID_A = "AAAAAAAAAAAAAAAAAAAAAA";
var ID_B = "BBBBBBBBBBBBBBBBBBBBBB";
var ID_C = "CCCCCCCCCCCCCCCCCCCCCC";
var TRACK_A = "spotify:track:" + ID_A;
var TRACK_B = "spotify:track:" + ID_B;
var EPISODE_C = "spotify:episode:" + ID_C;
var ALBUM_A = "spotify:album:" + ID_A;
var PLAYLIST_B = "spotify:playlist:" + ID_B;

var jsonCalls = [];
var jsonReplies = [];
var reqCalls = [];
var reqReplies = [];

var realJson = http.json;
var realRequest = http.request;

http.json = function (o) {
  jsonCalls.push(o);
  var r = jsonReplies.shift();
  if (!r) return Promise.reject(new Error("unexpected http.json request to " + o.url));
  if (typeof r === "function") return r(o);
  return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
};

http.request = function (o) {
  reqCalls.push(o);
  var r = reqReplies.shift();
  if (!r) return Promise.reject(new Error("unexpected http.request to " + o.url));
  if (typeof r === "function") return r(o);
  return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
};

function clearMocks() {
  jsonCalls = [];
  jsonReplies = [];
  reqCalls = [];
  reqReplies = [];
}

function reply(status, body) {
  var buf = body === undefined || body === null
    ? Buffer.alloc(0)
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return { status: status, headers: {}, body: buf };
}

function query(url) {
  var u = new URL(url);
  var o = {};
  u.searchParams.forEach(function (v, k) { o[k] = v; });
  return o;
}

function formBody(o) { return query("http://x/?" + o.body); }

function signInFixture(tok) {
  secrets.save({ spotify: { clientId: CID } });
  secrets.saveSpotify({
    refreshToken: "rt-1",
    accessToken: tok || "at-valid",
    expiry: Date.now() + 3600000
  });
}

// 1. start
t.test("start: errors when pagesBase, origin or client ID is missing", function () {
  return t.rejects(function () { spotify.start(ORIGIN, ""); }, /not available in this build/, 400)
    .then(function () { return t.rejects(function () { spotify.start("", PAGES); }, /no network address/, 500); })
    .then(function () { return t.rejects(function () { spotify.start(ORIGIN, PAGES); }, /Add your Spotify client ID/, 400); });
});

t.test("start: builds the contract's auth URL, PKCE challenge and state", function () {
  secrets.save({ spotify: { clientId: CID } });
  var r = spotify.start(ORIGIN, PAGES + "/");
  var q = query(r.authUrl);
  assert.ok(r.authUrl.indexOf("https://accounts.spotify.com/authorize?") === 0);
  assert.strictEqual(q.client_id, CID);
  assert.strictEqual(q.redirect_uri, PAGES + "/oauth/");
  assert.strictEqual(q.response_type, "code");
  assert.strictEqual(q.scope, spotify.SCOPES);
  assert.strictEqual(q.code_challenge_method, "S256");
  assert.ok(q.code_challenge && q.code_challenge.length >= 40);
  assert.strictEqual(q.state, r.state);
  var st = JSON.parse(util.fromB64url(q.state).toString("utf8"));
  assert.strictEqual(st.t, ORIGIN);
  assert.ok(/^[A-Za-z0-9_-]{16,}$/.test(st.n));
  assert.strictEqual(q.client_secret, undefined, "Spotify PKCE has no client secret");
  assert.strictEqual(q.access_token, undefined);
  assert.strictEqual(q.refresh_token, undefined);
});

t.test("start: prunes pending states to at most 5, oldest first", function () {
  spotify._pending.clear();
  var states = [];
  for (var i = 0; i < 7; i++) states.push(spotify.start(ORIGIN, PAGES).state);
  assert.strictEqual(spotify._pending.size, 5);
  assert.strictEqual(spotify.owns(states[0]), false);
  assert.strictEqual(spotify.owns(states[1]), false);
  assert.strictEqual(spotify.owns(states[2]), true);
  assert.strictEqual(spotify.owns(states[6]), true);
});

// 2. owns
t.test("owns: fresh state true without consuming; garbage and consumed states false; never throws", function () {
  clearMocks();
  var r = spotify.start(ORIGIN, PAGES);
  assert.strictEqual(spotify.owns(r.state), true);
  assert.strictEqual(spotify.owns(r.state), true, "owns must not consume the nonce");
  assert.strictEqual(spotify.owns("garbage"), false);
  assert.strictEqual(spotify.owns(""), false);
  assert.strictEqual(spotify.owns(null), false);
  assert.strictEqual(spotify.owns(undefined), false);
  assert.strictEqual(spotify.owns(12345), false);
  assert.strictEqual(spotify.owns({}), false);
  jsonReplies.push({ access_token: "at-own", expires_in: 3600, refresh_token: "rt-own" });
  return spotify.finish({ state: r.state, code: "ok-code" }, PAGES).then(function () {
    assert.strictEqual(spotify.owns(r.state), false, "consumed by finish");
  });
});

// 3. finish
t.test("finish: bad, cancelled, missing-code, changed-client and reused states never call Spotify", function () {
  clearMocks();
  secrets.save({ spotify: { clientId: CID } });
  var s1 = spotify.start(ORIGIN, PAGES).state;
  var s2 = spotify.start(ORIGIN, PAGES).state;
  var s3 = spotify.start(ORIGIN, PAGES).state;
  var s4 = spotify.start(ORIGIN, PAGES).state;
  return t.rejects(function () { return spotify.finish({ state: "garbage", code: "c" }, PAGES); }, /expired or was already used/, 400)
    .then(function () { return t.rejects(function () { return spotify.finish({ state: s1, error: "access_denied" }, PAGES); }, /cancelled/, 400); })
    .then(function () { return t.rejects(function () { return spotify.finish({ state: s1, code: "c" }, PAGES); }, /already used/, 400); })
    .then(function () { return t.rejects(function () { return spotify.finish({ state: s2, error: "server_error" }, PAGES); }, /reported a problem/, 400); })
    .then(function () { return t.rejects(function () { return spotify.finish({ state: s3 }, PAGES); }, /did not send a sign-in code/, 400); })
    .then(function () {
      secrets.save({ spotify: { clientId: CID2 } });
      return t.rejects(function () { return spotify.finish({ state: s4, code: "c" }, PAGES); }, /client ID changed/, 400);
    })
    .then(function () {
      assert.strictEqual(jsonCalls.length, 0);
      assert.strictEqual(reqCalls.length, 0);
    });
});

t.test("finish: exchanges code with PKCE verifier and no client_secret, stores tokens and enables tile", function () {
  clearMocks();
  secrets.save({ spotify: { clientId: CID } });
  settings.save({ music: { tile: false } });
  var r = spotify.start(ORIGIN, PAGES);
  var q = query(r.authUrl);
  jsonReplies.push({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" });
  return spotify.finish({ state: r.state, code: "auth-code-1" }, PAGES).then(function () {
    assert.strictEqual(jsonCalls.length, 1);
    assert.strictEqual(jsonCalls[0].url, "https://accounts.spotify.com/api/token");
    assert.strictEqual(jsonCalls[0].method, "POST");
    assert.strictEqual(jsonCalls[0].headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.strictEqual(jsonCalls[0].headers.Accept, "application/json");
    var b = formBody(jsonCalls[0]);
    assert.strictEqual(b.grant_type, "authorization_code");
    assert.strictEqual(b.code, "auth-code-1");
    assert.strictEqual(b.redirect_uri, PAGES + "/oauth/");
    assert.strictEqual(b.client_id, CID);
    assert.strictEqual(b.client_secret, undefined, "no client_secret in PKCE exchange");
    assert.strictEqual(util.b64url(util.sha256(b.code_verifier)), q.code_challenge, "verifier matches challenge");
    var sp = secrets.load().spotify;
    assert.strictEqual(sp.refreshToken, "rt-1");
    assert.strictEqual(sp.accessToken, "at-1");
    assert.ok(sp.expiry > Date.now());
    assert.strictEqual(secrets.stored().spotifySignedIn, true);
    assert.strictEqual(settings.load().music.tile, true);
  });
});

t.test("finish: maps invalid_client and missing refresh_token to 502", function () {
  clearMocks();
  secrets.save({ spotify: { clientId: CID } });
  var s1 = spotify.start(ORIGIN, PAGES).state;
  var s2 = spotify.start(ORIGIN, PAGES).state;
  var badClient = util.httpError(502, "refused");
  badClient.data = { error: "invalid_client" };
  jsonReplies.push(badClient);
  jsonReplies.push({ access_token: "at-no-rt", expires_in: 3600 });
  return t.rejects(function () { return spotify.finish({ state: s1, code: "c1" }, PAGES); }, /did not accept the client ID/, 502)
    .then(function () { return t.rejects(function () { return spotify.finish({ state: s2, code: "c2" }, PAGES); }, /lasting access/, 502); });
});

// 4. accessToken
t.test("accessToken: cached when fresh, refreshes near expiry, rotates refresh token, shares concurrent refresh, invalid_grant forgets tokens", function () {
  clearMocks();
  spotify._reset();
  signInFixture("at-fresh");
  return spotify.accessToken().then(function (tok) {
    assert.strictEqual(tok, "at-fresh");
    assert.strictEqual(jsonCalls.length, 0);

    // Near expiry (< 60 s left): two concurrent callers share one refresh request.
    secrets.saveSpotify({ expiry: Date.now() + 1000 });
    jsonReplies.push({ access_token: "at-rotated", expires_in: 3600, refresh_token: "rt-2" });
    return Promise.all([spotify.accessToken(), spotify.accessToken()]);
  }).then(function (toks) {
    assert.deepStrictEqual(toks, ["at-rotated", "at-rotated"]);
    assert.strictEqual(jsonCalls.length, 1, "concurrent callers share one refresh");
    var b = formBody(jsonCalls[0]);
    assert.strictEqual(b.grant_type, "refresh_token");
    assert.strictEqual(b.refresh_token, "rt-1");
    assert.strictEqual(b.client_id, CID);
    assert.strictEqual(b.client_secret, undefined);
    assert.strictEqual(secrets.load().spotify.refreshToken, "rt-2", "rotated refresh token stored");

    // invalid_grant forgets tokens but keeps clientId and rejects 401.
    secrets.saveSpotify({ expiry: 0 });
    var revoked = util.httpError(502, "refused");
    revoked.data = { error: "invalid_grant" };
    jsonReplies.push(revoked);
    return t.rejects(function () { return spotify.accessToken(); }, /expired or was revoked/, 401);
  }).then(function () {
    assert.strictEqual(secrets.stored().spotifySignedIn, false);
    assert.strictEqual(secrets.stored().spotifyClient, true, "clientId is kept");
    assert.strictEqual(secrets.load().spotify.clientId, CID);
    // Not connected rejects 409.
    return t.rejects(function () { return spotify.accessToken(); }, /not connected/, 409);
  });
});

// 5. state
t.test("state: signed out returns { connected: false } with no HTTP call", function () {
  clearMocks();
  spotify._reset();
  secrets.remove("spotify");
  return spotify.state().then(function (s) {
    assert.deepStrictEqual(s, { connected: false });
    assert.strictEqual(reqCalls.length, 0);
    assert.strictEqual(jsonCalls.length, 0);
  });
});

t.test("state: track with unsorted art, 1 s cache, liked cached per track, episode, 204, failed liked", function () {
  clearMocks();
  spotify._reset();
  signInFixture("at-state");

  var playerTrack = {
    is_playing: true,
    progress_ms: 42000,
    shuffle_state: true,
    repeat_state: "context",
    device: { id: "dev-1", name: "Living Room", type: "Speaker", volume_percent: 0, supports_volume: true },
    item: {
      type: "track",
      uri: TRACK_A,
      name: "Song One",
      duration_ms: 215000,
      artists: [{ name: "Artist One" }, { name: "Artist Two" }],
      album: {
        name: "Album One",
        images: [
          { url: "https://example.com/small.jpg", width: 64 },
          { url: "https://example.com/large.jpg", width: 640 },
          { url: "https://example.com/med.jpg", width: 300 }
        ]
      }
    }
  };

  reqReplies.push(reply(200, playerTrack));
  reqReplies.push(reply(200, [true]));

  var realNow = Date.now;
  var fakeNow = realNow();
  Date.now = function () { return fakeNow; };

  return Promise.all([spotify.state(), spotify.state()]).then(function (pair) {
    var s = pair[0];
    assert.deepStrictEqual(pair[0], pair[1], "concurrent calls share in-flight read");
    assert.strictEqual(reqCalls.length, 2, "one player call and one liked lookup");
    assert.strictEqual(reqCalls[0].url, "https://api.spotify.com/v1/me/player?additional_types=track,episode");
    assert.strictEqual(reqCalls[1].url, "https://api.spotify.com/v1/me/library/contains?uris=" + encodeURIComponent(TRACK_A));
    assert.strictEqual(s.connected, true);
    assert.strictEqual(s.active, true);
    assert.strictEqual(s.playing, true);
    assert.strictEqual(s.progressMs, 42000);
    assert.strictEqual(s.durationMs, 215000);
    assert.strictEqual(s.at, fakeNow);
    assert.strictEqual(s.shuffle, true);
    assert.strictEqual(s.repeat, "context");
    assert.deepStrictEqual(s.device, { id: "dev-1", name: "Living Room", type: "Speaker", volume: 0 });
    assert.deepStrictEqual(s.track, {
      uri: TRACK_A, title: "Song One", artist: "Artist One, Artist Two",
      album: "Album One", art: "https://example.com/large.jpg", liked: true
    });

    // Immediate read hits 1 s cache: no extra HTTP call.
    return spotify.state();
  }).then(function () {
    assert.strictEqual(reqCalls.length, 2, "1 s cache avoids second request");

    // Advance past 1 s cache: player is fetched again, but liked is NOT looked up again for the same track.
    fakeNow += 1500;
    reqReplies.push(reply(200, playerTrack));
    return spotify.state();
  }).then(function (s) {
    assert.strictEqual(reqCalls.length, 3, "liked remembered for same track across reads");
    assert.strictEqual(s.track.liked, true);

    // Episode: no liked lookup, album is "", artist is show name, volume null when unsupported.
    fakeNow += 1500;
    reqReplies.push(reply(200, {
      is_playing: false,
      progress_ms: 1000,
      shuffle_state: false,
      repeat_state: "off",
      device: { id: "dev-2", name: "TV", type: "TV", volume_percent: 50, supports_volume: false },
      item: {
        type: "episode",
        uri: EPISODE_C,
        name: "Episode One",
        duration_ms: 900000,
        show: { name: "Show One" },
        images: [{ url: "https://example.com/ep.jpg", width: 300 }]
      }
    }));
    return spotify.state();
  }).then(function (s) {
    assert.strictEqual(reqCalls.length, 4, "no liked lookup for episodes");
    assert.strictEqual(s.device.volume, null);
    assert.deepStrictEqual(s.track, {
      uri: EPISODE_C, title: "Episode One", artist: "Show One",
      album: "", art: "https://example.com/ep.jpg", liked: null
    });

    // HTTP 204: nothing active.
    fakeNow += 1500;
    reqReplies.push(reply(204));
    return spotify.state();
  }).then(function (s) {
    assert.deepStrictEqual(s, {
      connected: true, active: false, playing: false, progressMs: 0, durationMs: 0,
      at: fakeNow, shuffle: false, repeat: "off", device: null, track: null
    });

    // Failed liked lookup -> liked is null, state() still succeeds.
    fakeNow += 1500;
    var trackBPlayer = Object.assign({}, playerTrack, {
      item: Object.assign({}, playerTrack.item, { uri: TRACK_B, name: "Song Two" })
    });
    reqReplies.push(reply(200, trackBPlayer));
    reqReplies.push(reply(500, { error: { status: 500, message: "boom" } }));
    return spotify.state();
  }).then(function (s) {
    assert.strictEqual(s.track.uri, TRACK_B);
    assert.strictEqual(s.track.liked, null, "failed liked lookup degrades to null");
  }).then(function () { Date.now = realNow; }, function (e) { Date.now = realNow; throw e; });
});

// 6. 401 refresh and retry
t.test("401 from API triggers one token refresh and one retry", function () {
  clearMocks();
  spotify._reset();
  signInFixture("at-stale");
  reqReplies.push(reply(401, { error: { status: 401, message: "expired" } }));
  jsonReplies.push({ access_token: "at-new", expires_in: 3600 });
  reqReplies.push(reply(204));
  return spotify.state().then(function (s) {
    assert.strictEqual(s.active, false);
    assert.strictEqual(jsonCalls.length, 1);
    assert.strictEqual(reqCalls.length, 2);
    assert.strictEqual(reqCalls[0].headers.Authorization, "Bearer at-stale");
    assert.strictEqual(reqCalls[1].headers.Authorization, "Bearer at-new");
  });
});

// 7. command
t.test("command: every do sends the exact method, path, query and JSON body, and empties state cache", function () {
  clearMocks();
  spotify._reset();
  signInFixture("at-cmd");

  // Populate state cache first so we can verify command empties it.
  reqReplies.push(reply(204));
  return spotify.state().then(function () {
    assert.strictEqual(reqCalls.length, 1);
    clearMocks();

    var seq = [
      { body: { do: "play" }, method: "PUT", path: "/me/player/play", json: undefined },
      { body: { do: "play", deviceId: "dev_1" }, method: "PUT", path: "/me/player/play?device_id=dev_1", json: undefined },
      { body: { do: "play", context: ALBUM_A }, method: "PUT", path: "/me/player/play", json: { context_uri: ALBUM_A } },
      { body: { do: "play", context: PLAYLIST_B, offsetUri: TRACK_A, deviceId: "dev-2" }, method: "PUT", path: "/me/player/play?device_id=dev-2", json: { context_uri: PLAYLIST_B, offset: { uri: TRACK_A } } },
      { body: { do: "play", uris: [TRACK_A, EPISODE_C], offsetUri: EPISODE_C }, method: "PUT", path: "/me/player/play", json: { uris: [TRACK_A, EPISODE_C], offset: { uri: EPISODE_C } } },
      { body: { do: "pause" }, method: "PUT", path: "/me/player/pause", json: undefined },
      { body: { do: "next" }, method: "POST", path: "/me/player/next", json: undefined },
      { body: { do: "previous" }, method: "POST", path: "/me/player/previous", json: undefined },
      { body: { do: "seek", ms: 0 }, method: "PUT", path: "/me/player/seek?position_ms=0", json: undefined },
      { body: { do: "seek", ms: 90500 }, method: "PUT", path: "/me/player/seek?position_ms=90500", json: undefined },
      { body: { do: "shuffle", on: true }, method: "PUT", path: "/me/player/shuffle?state=true", json: undefined },
      { body: { do: "shuffle", on: false }, method: "PUT", path: "/me/player/shuffle?state=false", json: undefined },
      { body: { do: "repeat", mode: "track" }, method: "PUT", path: "/me/player/repeat?state=track", json: undefined },
      { body: { do: "volume", percent: 55 }, method: "PUT", path: "/me/player/volume?volume_percent=55", json: undefined },
      { body: { do: "transfer", deviceId: "dev-9", play: true }, method: "PUT", path: "/me/player", json: { device_ids: ["dev-9"], play: true } },
      { body: { do: "transfer", deviceId: "dev-9" }, method: "PUT", path: "/me/player", json: { device_ids: ["dev-9"], play: false } },
      { body: { do: "queue", uri: TRACK_A }, method: "POST", path: "/me/player/queue?uri=" + encodeURIComponent(TRACK_A), json: undefined },
      { body: { do: "like", uri: TRACK_A }, method: "PUT", path: "/me/library?uris=" + encodeURIComponent(TRACK_A), json: undefined },
      { body: { do: "unlike", uri: TRACK_A }, method: "DELETE", path: "/me/library?uris=" + encodeURIComponent(TRACK_A), json: undefined }
    ];

    var p = Promise.resolve();
    seq.forEach(function (step) {
      p = p.then(function () {
        reqReplies.push(reply(204));
        return spotify.command(step.body).then(function (res) {
          assert.deepStrictEqual(res, { ok: true });
          var c = reqCalls[reqCalls.length - 1];
          assert.strictEqual(c.method, step.method, step.body.do + " method");
          assert.strictEqual(c.url, "https://api.spotify.com/v1" + step.path, step.body.do + " url");
          if (step.json === undefined) {
            assert.strictEqual(c.body, undefined, step.body.do + " has no body");
            assert.strictEqual(c.headers["Content-Type"], undefined);
          } else {
            assert.deepStrictEqual(JSON.parse(c.body), step.json, step.body.do + " body");
            assert.strictEqual(c.headers["Content-Type"], "application/json");
          }
        });
      });
    });
    return p;
  }).then(function () {
    // State cache was emptied by commands, and unlike remembered liked = false for TRACK_A.
    reqReplies.push(reply(200, {
      is_playing: false, progress_ms: 0, shuffle_state: false, repeat_state: "off", device: null,
      item: { type: "track", uri: TRACK_A, name: "Song One", duration_ms: 1000, artists: [], album: { name: "", images: [] } }
    }));
    var before = reqCalls.length;
    return spotify.state().then(function (s) {
      assert.strictEqual(reqCalls.length, before + 1, "state fetched fresh, liked came from unlike memory");
      assert.strictEqual(s.track.liked, false);
    });
  });
});

t.test("command: validation errors reject 400 and send nothing", function () {
  clearMocks();
  signInFixture("at-val");
  var bad = [
    null,
    {},
    { do: "dance" },
    { do: "pause", extra: 1 },
    { do: "play", context: ALBUM_A, uris: [TRACK_A] },
    { do: "play", context: TRACK_A },
    { do: "play", uris: [] },
    { do: "play", uris: [ALBUM_A] },
    { do: "play", offsetUri: TRACK_A },
    { do: "play", context: ALBUM_A, offsetUri: ALBUM_A },
    { do: "play", deviceId: "bad device!" },
    { do: "seek", ms: -1 },
    { do: "seek", ms: 1.5 },
    { do: "seek", ms: "100" },
    { do: "shuffle", on: "true" },
    { do: "repeat", mode: "all" },
    { do: "volume", percent: 101 },
    { do: "volume", percent: -1 },
    { do: "transfer", deviceId: "" },
    { do: "transfer", deviceId: "dev1", play: 1 },
    { do: "queue", uri: ALBUM_A },
    { do: "like", uri: EPISODE_C },
    { do: "unlike", uri: "spotify:track:short" }
  ];
  var p = Promise.resolve();
  bad.forEach(function (b) {
    p = p.then(function () { return t.rejects(function () { return spotify.command(b); }, /./, 400); });
  });
  return p.then(function () {
    assert.strictEqual(reqCalls.length, 0);
    assert.strictEqual(jsonCalls.length, 0);
  });
});

t.test("command: maps NO_ACTIVE_DEVICE -> 409, PREMIUM_REQUIRED -> 403, 429 -> 429, other -> 502", function () {
  clearMocks();
  signInFixture("at-err");
  reqReplies.push(reply(404, { error: { status: 404, message: "No device", reason: "NO_ACTIVE_DEVICE" } }));
  reqReplies.push(reply(403, { error: { status: 403, message: "Premium", reason: "PREMIUM_REQUIRED" } }));
  reqReplies.push(reply(429, { error: { status: 429, message: "Rate limit" } }));
  reqReplies.push(reply(500, { error: { status: 500, message: "Oops" } }));
  return t.rejects(function () { return spotify.command({ do: "pause" }); }, /No Spotify device is active/, 409)
    .then(function () { return t.rejects(function () { return spotify.command({ do: "pause" }); }, /Spotify Premium is needed/, 403); })
    .then(function () { return t.rejects(function () { return spotify.command({ do: "pause" }); }, /slow down/, 429); })
    .then(function () { return t.rejects(function () { return spotify.command({ do: "pause" }); }, /HTTP 500/, 502); });
});

// 8. list
t.test("list: playlists, albums, liked, recent (deduped), playlist (item/track + null skip), album (cover), queue, devices, search", function () {
  clearMocks();
  signInFixture("at-list");

  var rawTrackA = {
    type: "track", uri: TRACK_A, id: ID_A, name: "Track A",
    artists: [{ name: "Art 1" }, { name: "Art 2" }],
    album: { images: [{ url: "https://example.com/a1.jpg", width: 64 }, { url: "https://example.com/a2.jpg", width: 300 }] }
  };
  var rawEpC = {
    type: "episode", uri: EPISODE_C, id: ID_C, name: "Ep C",
    show: { name: "Podcast One" },
    images: [{ url: "https://example.com/ep.jpg", width: 640 }]
  };

  // playlists
  reqReplies.push(reply(200, {
    items: [
      { uri: PLAYLIST_B, id: ID_B, name: "Mix 1", owner: { display_name: "Owner A" }, items: { total: 12 }, images: [{ url: "https://example.com/p1.jpg", width: 300 }] },
      { uri: "spotify:playlist:" + ID_A, id: ID_A, name: "Mix 2", owner: { display_name: "Owner B" }, tracks: { total: 0 }, images: [] },
      { uri: "spotify:playlist:" + ID_C, id: ID_C, name: "Mix 3", owner: { display_name: "Owner C" }, images: null },
      null
    ],
    next: "https://api.spotify.com/v1/me/playlists?offset=54"
  }));
  return spotify.list("playlists", { offset: 50 }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/me/playlists?limit=50&offset=50");
    assert.strictEqual(r.next, 54, "next counts raw entries returned by Spotify");
    assert.deepStrictEqual(r.items, [
      { kind: "playlist", uri: PLAYLIST_B, id: ID_B, title: "Mix 1", subtitle: "Owner A · 12 songs", art: "https://example.com/p1.jpg" },
      { kind: "playlist", uri: "spotify:playlist:" + ID_A, id: ID_A, title: "Mix 2", subtitle: "Owner B · 0 songs", art: "" },
      { kind: "playlist", uri: "spotify:playlist:" + ID_C, id: ID_C, title: "Mix 3", subtitle: "Owner C", art: "" }
    ]);

    // albums
    reqReplies.push(reply(200, {
      items: [
        { album: { uri: ALBUM_A, id: ID_A, name: "Album A", artists: [{ name: "Band" }], images: [{ url: "https://example.com/alb.jpg", width: 640 }] } },
        null
      ],
      next: null
    }));
    return spotify.list("albums");
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/me/albums?limit=50&offset=0");
    assert.strictEqual(r.next, null);
    assert.deepStrictEqual(r.items, [
      { kind: "album", uri: ALBUM_A, id: ID_A, title: "Album A", subtitle: "Band", art: "https://example.com/alb.jpg" }
    ]);

    // liked
    reqReplies.push(reply(200, { items: [{ track: rawTrackA }, { track: null }], next: "https://next" }));
    return spotify.list("liked", { offset: 10 });
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/me/tracks?limit=50&offset=10");
    assert.strictEqual(r.next, 12);
    assert.deepStrictEqual(r.items, [
      { kind: "track", uri: TRACK_A, id: ID_A, title: "Track A", subtitle: "Art 1, Art 2", art: "https://example.com/a2.jpg" }
    ]);

    // recent: deduplicates repeats keeping first, next always null
    reqReplies.push(reply(200, {
      items: [{ track: rawTrackA }, { track: rawTrackA }, { track: rawEpC }],
      next: "https://ignored"
    }));
    return spotify.list("recent");
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/me/player/recently-played?limit=50");
    assert.strictEqual(r.next, null);
    assert.strictEqual(r.items.length, 2);
    assert.strictEqual(r.items[0].uri, TRACK_A);
    assert.strictEqual(r.items[1].uri, EPISODE_C);
    assert.strictEqual(r.items[1].subtitle, "Podcast One");

    // playlist: uses `item`, falls back to `track`, skips nulls
    reqReplies.push(reply(200, {
      items: [{ item: rawEpC }, { track: rawTrackA }, { item: null, track: null }, null],
      next: null
    }));
    return spotify.list("playlist", { id: ID_B, offset: 5 });
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/playlists/" + ID_B + "/items?limit=50&offset=5&additional_types=track,episode");
    assert.strictEqual(r.next, null);
    assert.strictEqual(r.items.length, 2);
    assert.strictEqual(r.items[0].uri, EPISODE_C);
    assert.strictEqual(r.items[1].uri, TRACK_A);

    // album: fetches cover + tracks, applies album cover to every track
    reqReplies.push(reply(200, {
      name: "Album A",
      images: [{ url: "https://example.com/small.jpg", width: 64 }, { url: "https://example.com/cover.jpg", width: 640 }]
    }));
    reqReplies.push(reply(200, {
      items: [{ uri: TRACK_A, id: ID_A, name: "Track 1", artists: [{ name: "Band" }] }, null],
      next: "https://more"
    }));
    return spotify.list("album", { id: ID_A, offset: 0 });
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 2].url, "https://api.spotify.com/v1/albums/" + ID_A);
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/albums/" + ID_A + "/tracks?limit=50&offset=0");
    assert.strictEqual(r.next, 2);
    assert.deepStrictEqual(r.items, [
      { kind: "track", uri: TRACK_A, id: ID_A, title: "Track 1", subtitle: "Band", art: "https://example.com/cover.jpg" }
    ]);

    // queue: currently_playing first then queue, next null
    reqReplies.push(reply(200, { currently_playing: rawTrackA, queue: [rawEpC, null] }));
    return spotify.list("queue");
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/me/player/queue");
    assert.strictEqual(r.next, null);
    assert.strictEqual(r.items.length, 2);
    assert.strictEqual(r.items[0].uri, TRACK_A);
    assert.strictEqual(r.items[1].uri, EPISODE_C);

    // devices
    reqReplies.push(reply(200, {
      devices: [
        { id: "dev-1", name: "Living Room", type: "Speaker", is_active: true },
        { id: "dev-2", name: "Phone", type: "Smartphone", is_active: false }
      ]
    }));
    return spotify.list("devices");
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/me/player/devices");
    assert.strictEqual(r.next, null);
    assert.deepStrictEqual(r.items, [
      { kind: "device", uri: "", id: "dev-1", title: "Living Room", subtitle: "Speaker", art: "", active: true },
      { kind: "device", uri: "", id: "dev-2", title: "Phone", subtitle: "Smartphone", art: "", active: false }
    ]);

    // search: tracks, then albums, then playlists; next = offset + 10 if any has next
    reqReplies.push(reply(200, {
      tracks: { items: [rawTrackA], next: null },
      albums: { items: [{ uri: ALBUM_A, id: ID_A, name: "Alb", artists: [{ name: "B" }], images: [] }], next: "https://more" },
      playlists: { items: [null, { uri: PLAYLIST_B, id: ID_B, name: "Pl", owner: { display_name: "U" }, items: { total: 3 }, images: [] }], next: null }
    }));
    return spotify.list("search", { q: "  jazz & blues  ", offset: 10 });
  }).then(function (r) {
    assert.strictEqual(reqCalls[reqCalls.length - 1].url, "https://api.spotify.com/v1/search?type=track,album,playlist&limit=10&offset=10&q=jazz%20%26%20blues");
    assert.strictEqual(r.next, 20);
    assert.deepStrictEqual(r.items.map(function (x) { return x.kind; }), ["track", "album", "playlist"]);
  });
});

t.test("list: validation errors reject 400 and send nothing", function () {
  clearMocks();
  signInFixture("at-lerr");
  var longQ = new Array(102).join("a");
  return t.rejects(function () { return spotify.list("unknown"); }, /Unknown music list/, 400)
    .then(function () { return t.rejects(function () { return spotify.list("playlist", { id: "short" }); }, /valid Spotify id/, 400); })
    .then(function () { return t.rejects(function () { return spotify.list("album", {}); }, /valid Spotify id/, 400); })
    .then(function () { return t.rejects(function () { return spotify.list("search", { q: "   " }); }, /needs q/, 400); })
    .then(function () { return t.rejects(function () { return spotify.list("search", { q: longQ }); }, /needs q/, 400); })
    .then(function () { return t.rejects(function () { return spotify.list("playlists", { offset: -1 }); }, /offset/, 400); })
    .then(function () {
      assert.strictEqual(reqCalls.length, 0);
      assert.strictEqual(jsonCalls.length, 0);
    });
});

t.test("restore transport", function () {
  http.json = realJson;
  http.request = realRequest;
});

t.run();
