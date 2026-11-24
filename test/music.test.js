// Pure logic of the Music view (app/music.js): time text, moving along the controls, and what is
// asked of Spotify when a library row is chosen. Run by scripts/check.sh.
const assert = require("assert");
const M = require("../app/music.js");

assert.strictEqual(M._fmt(0), "0:00");
assert.strictEqual(M._fmt(61999), "1:01");
assert.strictEqual(M._fmt(3600000), "60:00");
assert.strictEqual(M._fmt(-5), "0:00");
assert.strictEqual(M._fmt(undefined), "0:00");

// Moving along the controls skips hidden ones and stops at the ends.
const hidden = [false, false, true, true, false];
assert.strictEqual(M._step(hidden, 1, 1), 4);
assert.strictEqual(M._step(hidden, 4, -1), 1);
assert.strictEqual(M._step(hidden, 4, 1), 4);
assert.strictEqual(M._step(hidden, 0, -1), 0);
assert.strictEqual(M._step([false, true, true], 0, 1), 0);        // nothing shown further on

const track = n => ({ kind: "track", uri: "spotify:track:" + String(n).padStart(22, "A"), title: "T" + n });
// Inside a playlist or album: the context plus where to start, so Spotify carries on afterwards.
const inAlbum = { context: "spotify:album:AAAAAAAAAAAAAAAAAAAAAA", items: [track(1), track(2), track(3)] };
assert.deepStrictEqual(M._playRequest(inAlbum, 1), { do: "play", context: inAlbum.context, offsetUri: track(2).uri });
// No context (liked songs, recently played): the chosen song and those after it, 50 at most.
const liked = { items: Array.from({ length: 70 }, (x, i) => track(i)) };
let r = M._playRequest(liked, 5);
assert.strictEqual(r.do, "play"); assert.strictEqual(r.uris.length, 50); assert.strictEqual(r.uris[0], track(5).uri);
assert.strictEqual(M._playRequest(liked, 65).uris.length, 5);
assert.strictEqual(r.context, undefined);
// Devices move the music; rows that are not playable ask for nothing.
assert.deepStrictEqual(M._playRequest({ items: [{ kind: "device", id: "abc", uri: "" }] }, 0), { do: "transfer", deviceId: "abc", play: true });
assert.strictEqual(M._playRequest({ items: [{ kind: "playlist", uri: "spotify:playlist:AAAAAAAAAAAAAAAAAAAAAA" }] }, 0), null);
assert.strictEqual(M._playRequest(liked, 99), null);

// Only https images (and the demo's inline pictures) are ever given to an <img>.
assert.strictEqual(M._artOk("https://i.example.com/a.jpg"), true);
assert.strictEqual(M._artOk("http://i.example.com/a.jpg"), false);
assert.strictEqual(M._artOk("javascript:alert(1)"), false);
assert.strictEqual(M._artOk(""), false);
assert.strictEqual(M._artOk(null), false);

// The LCD clock: m:ss with a blank in place of a leading zero, and it tops out at 99:59.
assert.deepStrictEqual(M._clockDigits(66000), [null, 1, 0, 6]);
assert.deepStrictEqual(M._clockDigits(754000), [1, 2, 3, 4]);
assert.deepStrictEqual(M._clockDigits(0), [null, 0, 0, 0]);
assert.deepStrictEqual(M._clockDigits(9e9), [9, 9, 5, 9]);

assert.strictEqual(typeof M._revealOnly(M.K.OK), "boolean");
console.log("music checks passed");
