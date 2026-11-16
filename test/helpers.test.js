// Pure helpers in app/ (helpers.js, config.js, usage.js with calendar.js). Run by scripts/check.sh.
const assert = require("assert"), path = require("path"), A = path.join(__dirname, "..", "app") + "/";
const H = require(A + "helpers.js"), D = require(A + "config.js");
// merge
const m = H.merge(D, { weather: { latitude: 1.2, longitude: 3.4, label: "X", fahrenheit: false }, morning: { weekends: null }, market: { indexes: [] }, rev: 3 });
assert.strictEqual(m.rev, 3); assert.strictEqual(m.morning.weekends, null); assert.deepStrictEqual(m.morning.weekdays, { from: "06:30", to: "09:00" });
assert.deepStrictEqual(m.market.indexes, []); assert.strictEqual(m.market.show, true); assert.strictEqual(D.weather, null);
assert.strictEqual(H.merge(D, { weather: null }).weather, null);
assert.notStrictEqual(H.merge(D, {}).alerts, D.alerts);  // no shared objects
// config matches schema keys
assert.deepStrictEqual(Object.keys(D), ["rev","apps","columns","idleSeconds","weather","alerts","market","feed","calendar","morning","countdowns","tileOrder","pinned","home","updates"]);
// parseIso
assert.strictEqual(H.parseIso("2026-11-15").getTime(), new Date(2026, 10, 15).getTime());
assert.strictEqual(H.parseIso("2026-11-15T09:30:00Z").getTime(), Date.UTC(2026, 10, 15, 9, 30));
assert.strictEqual(H.parseIso("2026-11-15T09:30:00-06:00").getTime(), Date.UTC(2026, 10, 15, 15, 30));
assert.strictEqual(H.parseIso("2026-11-15T09:30:00.250+0530").getTime(), Date.UTC(2026, 10, 15, 4, 0, 0, 250));
assert.strictEqual(H.parseIso("nope"), null);
// googleEvents
const g = H.googleEvents([{ summary: "A", start: "2026-11-15", end: "2026-11-16", allDay: true }, { summary: "B", start: "2026-11-15T10:00:00Z", end: "2026-11-15T11:00:00Z" }, { start: "bad" }]);
assert.strictEqual(g.length, 2); assert.strictEqual(g[0].allDay, true); assert.strictEqual(g[1].allDay, false);
const Cal = require(A + "calendar.js");
const on = Cal.eventsOn(g, new Date(2026, 10, 15)); assert.strictEqual(on.length, 2); assert.strictEqual(on[0].summary, "A");
assert.strictEqual(Cal.eventsOn(g, new Date(2026, 10, 16)).length, 0);
// fmt
assert.strictEqual(H.fmt(1234.5, "usd"), "$1,234.50"); assert.strictEqual(H.fmt(-12.3, "usd"), "-$12.30");
assert.strictEqual(H.fmt(1.234, "percent"), "1.23%"); assert.strictEqual(H.fmt(1234567, "number"), "1,234,567");
assert.strictEqual(H.fmt(12.345), "12.35"); assert.strictEqual(H.fmt("x"), "");
// tiles
const tv = [{ id: "a.app", title: "A", largeIcon: "/usr/palm/applications/a.app/largeIcon.png", bgColor: "#111111" },
  { id: "b.app", title: "B", icon: "/x/icon.png" }, { id: "hid", title: "H", visible: false }, { id: "nw", title: "N", noWindow: true },
  { id: "com.webos.app.settings", title: "S" }, { id: "com.webos.app.hdmi1", title: "HDMI1" }, { id: "com.teledashpro.dashboard", title: "Us" }];
let t = H.tiles(null, tv);
assert.deepStrictEqual(t.map(x => x.id), ["a.app", "b.app", "com.webos.app.hdmi1", "teledash.setup", "com.webos.app.home"]);
assert.strictEqual(t[0].logo, "file:///usr/palm/applications/a.app/largeIcon.png"); assert.strictEqual(t[0].color, "#111111");
assert.strictEqual(t[1].color, "#3d4450"); assert.strictEqual(t[4].exit, true); assert.strictEqual(t[3].setup, true);
// A chosen list keeps its order; HDMI 1 only when listed; Set up always just before All apps.
t = H.tiles([{ id: "com.webos.app.hdmi1", title: "Console" }, { id: "b.app", title: "Bee", color: "#222" }], tv);
assert.deepStrictEqual(t.map(x => x.title), ["Console", "Bee", "Set up", "All apps"]); assert.strictEqual(t[1].logo, "file:///x/icon.png");
t = H.tiles([{ id: "com.webos.app.home", title: "All apps", exit: true }, { id: "b.app", title: "B" }], tv);
assert.deepStrictEqual(t.map(x => x.id), ["teledash.setup", "com.webos.app.home", "b.app"]); assert.strictEqual(t[1].exit, true);
assert.deepStrictEqual(H.tiles([{ id: "b.app", title: "B" }], tv).map(x => x.id), ["b.app", "teledash.setup", "com.webos.app.home"]);
assert.deepStrictEqual(H.tiles(null, null).map(x => x.id), H.FIXED);
// installAction
assert.strictEqual(H.installAction("1.0.0\n", "1.0.0", 0, 0), "none");
assert.strictEqual(H.installAction("0.9.0", "1.0.0", 0, 0), "silent");
assert.strictEqual(H.installAction("", "1.0.0", 0, 0), "consent");
assert.strictEqual(H.installAction("", "1.0.0", 100, 50), "none");
assert.strictEqual(H.installAction("", "1.0.0", 100, 150), "consent");
assert.strictEqual(H.installAction("", null, 0, 0), "none");
// inMorning
assert.strictEqual(H.inMorning(D.morning, new Date(2026, 10, 16, 7, 0)), true);   // Monday
assert.strictEqual(H.inMorning(D.morning, new Date(2026, 10, 15, 7, 0)), false);  // Sunday before 07:30
assert.strictEqual(H.inMorning({ weekdays: null, weekends: null }, new Date(2026, 10, 16, 7, 0)), false);
// Usage.order with fixed tiles
const U = require(A + "usage.js");
assert.deepStrictEqual(U.order(H.tiles(null, tv), { "b.app": 10 }, H.pinnedIds(null, D.pinned)).map(x => x.id),
  ["b.app", "a.app", "com.webos.app.hdmi1", "teledash.setup", "com.webos.app.home"]);
const picked = [{ id: "b.app", title: "B" }, { id: "a.app", title: "A" }, { id: "com.webos.app.home", title: "All apps", exit: true }];
assert.deepStrictEqual(U.order(H.tiles(picked, tv), { "a.app": 10 }, H.pinnedIds(picked, ["com.webos.app.home"])).map(x => x.id),
  ["a.app", "b.app", "teledash.setup", "com.webos.app.home"]);
console.log("helpers ok");
