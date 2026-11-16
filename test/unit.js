// Unit checks for the app's pure logic (countdown.js, usage.js). Run by scripts/check.sh.
const fs = require("fs"), assert = require("assert");
global.CONFIG = { countdowns: { holidays: true, dates: [{ title: "Trip", date: "2027-02-12" }, { title: "Bday", date: "11-16" }] } };
eval(fs.readFileSync(__dirname + "/../app/countdown.js", "utf8") + ";global.Countdown=Countdown;");
eval(fs.readFileSync(__dirname + "/../app/usage.js", "utf8") + ";global.Usage=Usage;");
const d = x => x.toDateString();
assert.strictEqual(d(Countdown._easter(2027)), "Sun Mar 28 2027");
assert.strictEqual(d(Countdown._easter(2026)), "Sun Apr 05 2026");
assert.strictEqual(d(Countdown._nth(2026, 10, 4, 4)), "Thu Nov 26 2026");      // Thanksgiving
assert.strictEqual(d(Countdown._nth(2027, 4, 1, -1)), "Mon May 31 2027");      // Memorial Day
assert.deepStrictEqual(Countdown.upcoming(new Date(2026, 10, 15), 45).map(Countdown.label),
  ["Tomorrow: Bday", "11 days to Thanksgiving", "40 days to Christmas"]);
assert.strictEqual(Countdown.upcoming(new Date(2026, 11, 31), 45)[0].title, "New Year's Day");
const now = Date.UTC(2026, 10, 15), t = now / 1000 - 36000;
const log = [`${t} boot`, `${t + 100} youtube`, `${t + 86500} netflix`, `${t + 87100} boot`, `${t + 87200} hulu`, `${t + 87800} x`].join("\n");
assert.deepStrictEqual(Usage.minutes(log, now, 30), { youtube: 240, netflix: 10, hulu: 10 });   // 4-hour cap; boot gap not counted
const apps = [{ id: "a" }, { id: "b" }, { id: "hdmi" }, { id: "c" }];
assert.deepStrictEqual(Usage.order(apps, { c: 50, b: 5 }, ["hdmi"]).map(a => a.id), ["c", "b", "hdmi", "a"]);   // pinned keeps its place
console.log("unit checks passed");
