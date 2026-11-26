// This TV as a Spotify device (app/player.js): when Spotify's player is loaded, repaired and
// offered, and what is said when it cannot be. Spotify's SDK, the page and the helper are stand-ins.
const assert = require("assert");

let tokens, fixes, fixCalls, tokenCalls, appended, made, connectOk, timers;
global.window = { PalmSystem: {} };                             // as on a TV
global.document = { createElement: () => ({}), head: { appendChild: t => { appended.push(t); } } };
global.Settings = {
  musicToken: cb => { tokenCalls++; cb(tokens.length > 1 ? tokens.shift() : tokens[0]); },
  musicFix: cb => { fixCalls++; cb(fixes.length > 1 ? fixes.shift() : fixes[0]); }
};
const realTimeout = global.setTimeout;
global.setTimeout = fn => { timers++; fn(); };                  // the half-second waits, without waiting
const P = require("../app/player.js");

function Sdk(opts) { this.opts = opts; this.on = {}; this.connects = 0; this.disconnects = 0; made.push(this); }
Sdk.prototype.addListener = function (name, fn) { this.on[name] = fn; };
Sdk.prototype.connect = function () { this.connects++; return { then: f => f(connectOk) }; };
Sdk.prototype.disconnect = function () { this.disconnects++; };

function fresh(tv) {
  tokens = [{ token: "tok-1", expires: 1 }]; fixes = [{ available: true, fixed: 1 }];
  fixCalls = tokenCalls = timers = 0; appended = []; made = []; connectOk = true;
  delete window.Spotify; delete window.onSpotifyWebPlaybackSDKReady;
  P._reset(tv);
}
// Spotify's script has loaded: it defines Spotify.Player and calls the page back.
function sdkLoads() { window.Spotify = { Player: Sdk }; window.onSpotifyWebPlaybackSDKReady(); }

// On a TV: token, script, repair, connect, and ready only once the repair is confirmed again.
fresh(true);
let changes = [];
P.start({ onChange: s => changes.push(s) });
assert.strictEqual(P.status(), "starting");
assert.strictEqual(appended.length, 1);
assert.strictEqual(appended[0].src, "https://sdk.scdn.co/spotify-player.js");
assert.strictEqual(made.length, 0, "nothing is created before Spotify's script has loaded");
sdkLoads();
assert.strictEqual(made.length, 1);
assert.strictEqual(made[0].opts.name, P.NAME);
assert.strictEqual(fixCalls, 1, "repaired before connecting");
assert.strictEqual(made[0].connects, 1);
assert.strictEqual(P.id(), "", "not offered until Spotify says it is ready");
made[0].on.ready({ device_id: "device-1" });
assert.strictEqual(fixCalls, 2, "and checked again once ready");
assert.strictEqual(P.status(), "ready");
assert.strictEqual(P.id(), "device-1");
assert.deepStrictEqual(changes, ["starting", "ready"]);
let given = null;
made[0].opts.getOAuthToken(tok => { given = tok; });
assert.strictEqual(given, "tok-1", "Spotify's player gets its token from the helper");
P.start();
assert.strictEqual(made.length, 1, "starting again while running does nothing");
made[0].on.not_ready();
assert.strictEqual(P.id(), "");
assert.strictEqual(P.status(), "starting");

// The player's frame did not exist before connecting: connect anyway, repair once it is ready.
fresh(true);
fixes = [{ available: true, fixed: 0 }, { available: true, fixed: 0 }, { available: true, fixed: 0 }, { available: true, fixed: 0 }, { available: true, fixed: 1 }];
P.start();
sdkLoads();
assert.strictEqual(fixCalls, 3, "three tries before connecting");
assert.strictEqual(made[0].connects, 1);
made[0].on.ready({ device_id: "device-2" });
assert.strictEqual(P.id(), "device-2");
assert.strictEqual(fixCalls, 5);

// The repair never takes: the TV is not offered as a player, because songs would stop after ten seconds.
fresh(true);
fixes = [{ available: true, fixed: 0 }];
P.start();
sdkLoads();
made[0].on.ready({ device_id: "device-3" });
assert.strictEqual(fixCalls, 3 + 12);
assert.strictEqual(P.status(), "failed");
assert.strictEqual(P.id(), "");
assert.strictEqual(made[0].disconnects, 1);
assert.ok(/remote control/.test(P.why()));

// A TV without the inspector: not even connected.
fresh(true);
fixes = [{ available: false, reason: "closed" }];
P.start();
sdkLoads();
assert.strictEqual(fixCalls, 1, "no point in trying again");
assert.strictEqual(made[0].connects, 0);
assert.strictEqual(P.status(), "failed");
assert.ok(/remote control/.test(P.why()));
// ... and it is not retried on every button press.
P.start();
assert.strictEqual(tokenCalls, 1);

// Not signed in for playing here: the helper's own words, and Spotify's script is never loaded.
fresh(true);
tokens = [{ error: "To play music on this TV itself, sign in to Spotify again on the setup page." }];
P.start();
assert.strictEqual(P.status(), "failed");
assert.strictEqual(P.why(), "To play music on this TV itself, sign in to Spotify again on the setup page.");
assert.strictEqual(appended.length, 0);
fresh(true);
tokens = [null];                                                // the helper did not answer
P.start();
assert.ok(/helper is not running/.test(P.why()));

// Spotify's script cannot be fetched.
fresh(true);
P.start();
appended[0].parentNode = { removeChild: t => { appended.splice(appended.indexOf(t), 1); } };
appended[0].onerror();
assert.strictEqual(P.status(), "failed");
assert.ok(/internet connection/.test(P.why()));
assert.strictEqual(appended.length, 0);

// What Spotify can say.
[["account_error", /Premium/], ["authentication_error", /Sign in again/], ["initialization_error", /cannot run/]].forEach(function (c) {
  fresh(true);
  P.start(); sdkLoads();
  made[0].on.ready({ device_id: "d" });
  made[0].on[c[0]]({ message: "x" });
  assert.strictEqual(P.status(), "failed", c[0]);
  assert.ok(c[1].test(P.why()), c[0] + ": " + P.why());
  assert.strictEqual(P.id(), "");
});
fresh(true);
connectOk = false;
P.start(); sdkLoads();
assert.ok(/did not accept this TV/.test(P.why()));

// A song that fails asks for the repair again, so the next one plays.
fresh(true);
P.start(); sdkLoads();
made[0].on.ready({ device_id: "d" });
made[0].on.playback_error({ message: "x" });
assert.strictEqual(fixCalls, 3);
assert.strictEqual(P.status(), "ready");

// Music starting on this TV is announced once per start, not on every progress report.
fresh(true);
let plays = 0;
P.start({ onPlay: () => { plays++; } });
sdkLoads();
made[0].on.ready({ device_id: "d" });
made[0].on.player_state_changed(null);
made[0].on.player_state_changed({ paused: true });
assert.strictEqual(plays, 0);
made[0].on.player_state_changed({ paused: false });
made[0].on.player_state_changed({ paused: false });
assert.strictEqual(plays, 1);
made[0].on.player_state_changed({ paused: true });
made[0].on.player_state_changed({ paused: false });
assert.strictEqual(plays, 2);

// On a computer the browser is current: no repair is asked for.
fresh(false);
P.start(); sdkLoads();
made[0].on.ready({ device_id: "laptop" });
assert.strictEqual(fixCalls, 0);
assert.strictEqual(P.id(), "laptop");

// Spotify's script was already loaded by an earlier try: no second copy.
fresh(true);
window.Spotify = { Player: Sdk };
P.start();
assert.strictEqual(appended.length, 0);
assert.strictEqual(made.length, 1);

global.setTimeout = realTimeout;
console.log("player checks passed");
