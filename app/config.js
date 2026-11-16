// Built-in defaults. They apply when the setup helper is not running (no root, or not installed),
// and every saved setting is layered on top of them (settings.js). The shape matches the settings
// schema in CONTRACT.md exactly; set things up from your phone instead of editing this file.
var DEFAULTS = {
  rev: 0,
  // null = automatic: the TV's own installed apps, ordered by use, then HDMI 1, Set up, All apps.
  // Or a list: [{ id: "<TV app id>", title: "Name", color: "#123456" }].
  apps: null,
  columns: 6,
  // Seconds without a button press before the dim idle view (time + weather) takes over.
  idleSeconds: 120,
  // null = off, or { latitude, longitude, label, fahrenheit } (open-meteo.com, no account needed).
  weather: null,
  // National Weather Service warnings (US only) and the US air-quality index, for the weather location.
  alerts: { warnings: true, airQuality: true },
  market: {
    show: true,
    indexes: [
      { symbol: "^GSPC", label: "S&P 500" },
      { symbol: "^IXIC", label: "Nasdaq" },
      { symbol: "^DJI", label: "Dow" }
    ]
  },
  // A JSON or CSV data feed shown as chips in the market strip (fetched by the setup helper).
  feed: { enabled: false, title: "", url: "", format: "json",
    csv: { date: "date", value: "value", flows: "", time: "" } },
  calendar: { source: "none", calendars: ["primary"] },
  // Morning brief hours, "HH:MM" 24-hour; null for a group turns it off on those days.
  morning: {
    weekdays: { from: "06:30", to: "09:00" },
    weekends: { from: "07:30", to: "10:00" }
  },
  // Holiday countdowns plus your own dates: [{ title, date: "MM-DD" (yearly) or "YYYY-MM-DD" }].
  countdowns: { holidays: true, withinDays: 45, dates: [] },
  // "daily" re-sorts the tiles once a day by time in use over the last 30 days; "fixed" keeps list order.
  tileOrder: "daily",
  pinned: ["com.webos.app.hdmi1", "com.webos.app.home"],
  home: { opensDashboard: false, delaySeconds: 1 },
  updates: { auto: false }
};
if (typeof module !== "undefined") module.exports = DEFAULTS;
