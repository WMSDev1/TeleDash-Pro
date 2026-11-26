// The TV as a Spotify device (CONTRACT.md "Playing on the TV"): Spotify's own Web Playback SDK,
// loaded into this page, so the TV's speakers play the music and the TV can be chosen in any
// Spotify app. The helper supplies a short-lived token, and on a TV it also repairs the player for
// the TV's older browser engine (service/lib/inspector.js). Without that repair every song stops
// after ten seconds, so on a TV the player is only offered once the repair is confirmed.
//   Player.start({ onPlay, onChange })  load and connect; calling it again retries after a failure
//   Player.id()                         this TV's Spotify device id; "" until it is ready
//   Player.status()                     "off" | "starting" | "ready" | "failed"
//   Player.why()                        after a failure: what to tell the owner
var Player = (function () {
  var SDK = "https://sdk.scdn.co/spotify-player.js", NAME = "TeleDash Pro";
  var TRIES_BEFORE = 3, TRIES_AFTER = 12, GAP_MS = 500, RETRY_MS = 60000;
  var NO_REPAIR = "This TV cannot play Spotify itself, so Music works as a remote control for your other devices.";
  var win = typeof window !== "undefined" ? window : {};
  var onTv = !!(win.WebOSServiceBridge || win.PalmServiceBridge || win.PalmSystem);
  var status = "off", why = "", id = "", player = null, hooks = {}, tag = null, sounding = false, failedAt = 0;

  function changed() { if (hooks.onChange) hooks.onChange(status); }
  function fail(message) {
    status = "failed"; why = message || ""; id = ""; failedAt = Date.now();
    if (player) { try { player.disconnect(); } catch (e) {} player = null; }
    changed();
  }

  // Asks the helper to repair the player, up to `tries` times half a second apart (the player's
  // frame may still be loading). cb(true) once it is repaired, cb(false, final) if not; final means
  // this TV cannot do it at all, so there is no point in trying again.
  function repair(tries, cb) {
    if (!onTv) { cb(true); return; }                             // a computer's browser needs no repair
    Settings.musicFix(function (d) {
      if (d && d.available && d.fixed > 0) { cb(true); return; }
      if (d && d.available === false && d.reason !== "timeout") { cb(false, true); return; }
      if (tries > 1) setTimeout(function () { repair(tries - 1, cb); }, GAP_MS); else cb(false, false);
    });
  }

  function create() {
    if (player || status !== "starting") return;
    var p;
    try {
      p = new win.Spotify.Player({
        name: NAME, volume: 0.5,
        // Spotify's player asks again whenever it needs a fresh token; the helper keeps one current.
        getOAuthToken: function (give) { Settings.musicToken(function (d) { if (d && d.token) give(d.token); }); }
      });
    } catch (e) { fail("This TV cannot run Spotify's player."); return; }
    player = p;
    p.addListener("ready", function (e) {
      // Checked again here: before connecting, the player's frame may not have existed yet.
      repair(TRIES_AFTER, function (ok) {
        if (player !== p) return;
        if (!ok) { fail(NO_REPAIR); return; }
        id = (e && e.device_id) || ""; status = "ready"; why = "";
        changed();
      });
    });
    p.addListener("not_ready", function () { if (player === p && status === "ready") { id = ""; status = "starting"; changed(); } });
    p.addListener("initialization_error", function () { if (player === p) fail("This TV cannot run Spotify's player."); });
    p.addListener("authentication_error", function () { if (player === p) fail("Spotify did not accept the sign-in. Sign in again on the setup page."); });
    p.addListener("account_error", function () { if (player === p) fail("Playing on this TV needs Spotify Premium."); });
    // A song that fails still leaves the next one a chance: make sure the repair is in place.
    p.addListener("playback_error", function () { if (player === p) repair(1, function () {}); });
    p.addListener("player_state_changed", function (s) {
      var now = !!(s && !s.paused);
      if (now && !sounding && hooks.onPlay) hooks.onPlay();
      sounding = now;
    });
    repair(TRIES_BEFORE, function (ok, final) {
      if (player !== p) return;
      if (!ok && final) { fail(NO_REPAIR); return; }
      var c;
      try { c = p.connect(); } catch (e) { fail("This TV cannot run Spotify's player."); return; }
      if (c && c.then) c.then(function (yes) { if (!yes && player === p) fail("Spotify did not accept this TV as a player."); });
    });
  }

  function start(h) {
    if (h) hooks = h;
    if (status === "starting" || status === "ready") return;
    if (status === "failed" && Date.now() - failedAt < RETRY_MS) return;   // not on every press
    if (typeof document === "undefined" || typeof Settings === "undefined") return;
    status = "starting"; why = "";
    changed();
    Settings.musicToken(function (d) {
      if (status !== "starting") return;
      // Not signed in, or signed in before this TV could play: the helper says which.
      if (!d || !d.token) { fail(d && d.error ? d.error : "The setup helper is not running, so this TV cannot play Spotify itself."); return; }
      if (win.Spotify && win.Spotify.Player) { create(); return; }
      win.onSpotifyWebPlaybackSDKReady = create;
      if (tag) return;                                           // still loading from an earlier try
      tag = document.createElement("script");
      tag.src = SDK; tag.async = true;
      tag.onerror = function () {
        if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
        tag = null;
        fail("Spotify's player could not be loaded. Check the TV's internet connection.");
      };
      document.head.appendChild(tag);
    });
  }

  return {
    start: start,
    id: function () { return status === "ready" ? id : ""; },
    status: function () { return status; },
    why: function () { return why; },
    NAME: NAME,
    _reset: function (tv) { status = "off"; why = ""; id = ""; player = null; hooks = {}; tag = null; sounding = false; failedAt = 0; if (tv !== undefined) onTv = !!tv; }
  };
})();
if (typeof module !== "undefined") module.exports = Player;
