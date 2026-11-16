"use strict";
// The data feed (CONTRACT.md "Data feed"): a TeleDash feed v1 JSON file, or the last row of a CSV.
// The address is an https:// URL or github:<owner>/<repo>/<path>[@ref]; the optional token is
// sent as a Bearer token and never leaves this machine any other way.
var URL = require("url").URL;
var http = require("./http");
var util = require("./util");

// -> { url, headers } for an address saved in settings.feed.url
function resolve(address, token) {
  var headers = {};
  var url = address;
  var g = /^github:([^/]+)\/([^/]+)\/([^@]+?)(?:@(.+))?$/.exec(address || "");
  if (g) {
    var path = g[3].split("/").map(encodeURIComponent).join("/");
    url = "https://api.github.com/repos/" + encodeURIComponent(g[1]) + "/" + encodeURIComponent(g[2]) + "/contents/" + path +
      (g[4] ? "?ref=" + encodeURIComponent(g[4]) : "");
    headers.Accept = "application/vnd.github.raw";
  }
  if (token) headers.Authorization = "Bearer " + token;
  return { url: url, headers: headers };
}

// "https://host[:port]" that a feed address is fetched from ("" when there is none). The token is
// tied to this, so pointing the feed somewhere else can never send it to another site.
function originOf(address) {
  if (!address) return "";
  try { return new URL(resolve(address).url).origin; } catch (e) { return ""; }
}

function bad(msg) { return util.httpError(502, msg); }

// Accepts 1234.5, "1234.5", "$1,234.50", "-12.3%".
function number(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  var s = v.replace(/[$,\s%]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

function round(n, places) { var f = Math.pow(10, places); return Math.round(n * f) / f; }

function shortText(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : ""; }

// TeleDash feed v1 -> cleaned copy with only the documented fields.
function parseJson(text, title) {
  var d;
  try { d = JSON.parse(text); } catch (e) { throw bad("The data feed is not valid JSON."); }
  if (!util.isObject(d) || !Array.isArray(d.items)) throw bad("The data feed has no \"items\" list.");
  var items = [];
  d.items.slice(0, 12).forEach(function (it) {
    if (!util.isObject(it)) return;
    var value = number(it.value);
    if (isNaN(value)) return;
    var out = { label: shortText(it.label, 40) || "Value", value: value };
    var change = number(it.change);
    if (it.change !== undefined && it.change !== null && !isNaN(change)) out.change = change;
    if (["usd", "number", "percent"].indexOf(it.format) >= 0) out.format = it.format;
    items.push(out);
  });
  if (!items.length) throw bad("The data feed has no items with a numeric value.");
  return { title: title || shortText(d.title, 40), asOf: shortText(d.asOf, 40), items: items };
}

// RFC 4180-style CSV: quoted fields, doubled quotes, commas and line breaks inside quotes.
function csvRows(text) {
  var rows = [], row = [], field = "", q = false;
  text = String(text).replace(/^﻿/, "");
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.length > 1 || (r[0] || "").trim() !== ""; });
}

function compareDates(a, b) {
  var x = Date.parse(a), y = Date.parse(b);
  if (!isNaN(x) && !isNaN(y)) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

// cols: settings.feed.csv { date, value, flows, time }; title: settings.feed.title
function parseCsv(text, cols, title) {
  var rows = csvRows(text);
  if (rows.length < 2) throw bad("The CSV needs a header row and at least one row of data.");
  var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  function col(name, required) {
    if (!name) return -1;
    var i = header.indexOf(String(name).trim().toLowerCase());
    if (i < 0 && required !== false) throw bad("The CSV has no column called \"" + name + "\".");
    return i;
  }
  var di = col(cols.date), vi = col(cols.value), fi = col(cols.flows), ti = col(cols.time);
  function cell(r, i) { return i >= 0 && r[i] !== undefined ? String(r[i]).trim() : ""; }

  var data = rows.slice(1).filter(function (r) { return cell(r, vi) !== ""; });
  if (!data.length) throw bad("The CSV has no rows with a value in the \"" + cols.value + "\" column.");
  var last = data[data.length - 1];
  var value = number(cell(last, vi));
  if (isNaN(value)) throw bad("The last value in the CSV is not a number.");

  var item = { label: title || "Value", value: round(value, 2), format: "usd" };
  var prev = null;
  for (var k = data.length - 2; k >= 0; k--) {
    if (compareDates(cell(data[k], di), cell(last, di)) < 0) { prev = data[k]; break; }
  }
  if (prev) {
    var pv = number(cell(prev, vi));
    if (!isNaN(pv)) {
      var change = value - pv;
      // Deposits and withdrawals are not gains: subtract the change in the flows column.
      if (fi >= 0) {
        var f1 = number(cell(last, fi) || "0"), f0 = number(cell(prev, fi) || "0");
        if (!isNaN(f1) && !isNaN(f0)) change -= f1 - f0;
      }
      item.change = round(change, 2);
    }
  }
  var asOf = cell(last, di) + (ti >= 0 && cell(last, ti) ? " " + cell(last, ti) : "");
  return { title: title || "", asOf: asOf, items: [item] };
}

// feedSettings: settings.feed; token, tokenOrigin: secrets.feedToken and feedTokenOrigin (optional).
// The token is sent only when the feed still points at the site it was saved for.
function fetchFeed(feedSettings, token, tokenOrigin) {
  if (!feedSettings.enabled || !feedSettings.url) return Promise.reject(util.httpError(404, "No data feed is set up."));
  var send = token && tokenOrigin && originOf(feedSettings.url) === tokenOrigin;
  var r = resolve(feedSettings.url, send ? token : null);
  return http.request({ url: r.url, headers: r.headers, timeout: 20000, maxBytes: 2 * 1024 * 1024 }).then(function (res) {
    if (res.status < 200 || res.status > 299) {
      var msg = http.describeStatus(res.status, r.url);
      if (res.status === 404 && /^github:/.test(feedSettings.url)) msg += " For a private repository, add a token that can read it.";
      throw bad("Data feed: " + msg);
    }
    var text = res.body.toString("utf8");
    return feedSettings.format === "csv" ? parseCsv(text, feedSettings.csv, feedSettings.title) : parseJson(text, feedSettings.title);
  });
}

module.exports = { resolve: resolve, originOf: originOf, parseJson: parseJson, parseCsv: parseCsv, csvRows: csvRows, number: number, fetchFeed: fetchFeed };
