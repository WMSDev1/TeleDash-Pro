"use strict";
// A small HTTP(S) client: overall timeout, at most 3 redirects, a size limit on the answer.
// Errors carry plain-English messages that never include the address (it may be a secret link).
var http = require("http");
var https = require("https");
var URL = require("url").URL;           // a global only from Node 10
var util = require("./util");

function fail(message, code) {
  var e = util.httpError(502, message);
  if (code) e.code = code;
  return e;
}

function dropHeader(headers, name) {
  Object.keys(headers).forEach(function (k) { if (k.toLowerCase() === name) delete headers[k]; });
}

// opts: { url, method, headers, body (string|Buffer), timeout (ms), maxBytes, maxRedirects }
// Resolves { status, headers, body: Buffer } for any HTTP status; rejects on network trouble.
function request(opts) {
  var timeout = opts.timeout || 20000;
  var maxBytes = opts.maxBytes || 4 * 1024 * 1024;
  var maxRedirects = opts.maxRedirects === undefined ? 3 : opts.maxRedirects;
  var deadline = Date.now() + timeout;

  return new Promise(function (resolve, reject) {
    function go(url, method, body, headers, hops) {
      var u;
      try { u = new URL(url); } catch (e) { return reject(fail("That is not a valid web address.")); }
      if (u.protocol !== "https:" && u.protocol !== "http:") return reject(fail("Only http and https addresses are supported."));
      var h = Object.assign({ "User-Agent": "TeleDashPro", "Accept-Encoding": "identity" }, headers);
      if (body !== null && body !== undefined) h["Content-Length"] = Buffer.byteLength(body);
      var left = deadline - Date.now();
      if (left <= 0) return reject(fail(u.hostname + " took too long to answer.", "ETIMEDOUT"));

      var req = (u.protocol === "https:" ? https : http).request({
        hostname: u.hostname.replace(/^\[|\]$/g, ""),
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: method,
        headers: h
      }, function (res) {
        var status = res.statusCode;
        if ([301, 302, 303, 307, 308].indexOf(status) >= 0 && res.headers.location) {
          res.resume();
          clearTimeout(timer);
          if (hops >= maxRedirects) return reject(fail(u.hostname + " redirected too many times."));
          var next;
          try { next = new URL(res.headers.location, u); } catch (e) { return reject(fail(u.hostname + " sent a bad redirect.")); }
          if (u.protocol === "https:" && next.protocol !== "https:") return reject(fail(u.hostname + " tried to redirect to an insecure address."));
          var nh = Object.assign({}, headers);
          if (next.host !== u.host) dropHeader(nh, "authorization");   // never hand a token to another host
          var nm = method, nb = body;
          if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
            nm = "GET"; nb = null; dropHeader(nh, "content-type");
          }
          return go(next.href, nm, nb, nh, hops + 1);
        }
        var chunks = [], size = 0;
        res.on("data", function (c) {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            clearTimeout(timer);
            reject(fail(u.hostname + " sent more data than expected (over " + Math.round(maxBytes / 1024) + " KB)."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", function () {
          clearTimeout(timer);
          if (size <= maxBytes) resolve({ status: status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", function () { clearTimeout(timer); reject(fail("The connection to " + u.hostname + " broke off.")); });
      });
      var timer = setTimeout(function () {
        req.destroy();
        reject(fail(u.hostname + " took too long to answer.", "ETIMEDOUT"));
      }, left);
      req.on("error", function (e) {
        clearTimeout(timer);
        if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") reject(fail("Could not find " + u.hostname + ". Is the TV online?", e.code));
        else if (e.code === "ECONNREFUSED") reject(fail(u.hostname + " refused the connection.", e.code));
        else reject(fail("Could not reach " + u.hostname + ".", e.code));
      });
      if (body !== null && body !== undefined) req.write(body);
      req.end();
    }
    go(opts.url, opts.method || "GET", opts.body, opts.headers || {}, 0);
  });
}

// Fetches JSON; non-2xx answers reject with the status attached (e.status), the parsed body in e.data.
function json(opts) {
  return request(opts).then(function (r) {
    var data = null;
    try { data = JSON.parse(r.body.toString("utf8")); } catch (e) { data = null; }
    if (r.status < 200 || r.status > 299) {
      var e2 = fail(describeStatus(r.status, opts.url));
      e2.upstreamStatus = r.status;
      e2.data = data;
      throw e2;
    }
    if (data === null) throw fail("The answer from " + host(opts.url) + " was not valid JSON.");
    return data;
  });
}

function host(url) { try { return new URL(url).hostname; } catch (e) { return "the server"; } }

function describeStatus(status, url) {
  var h = host(url);
  if (status === 401 || status === 403) return h + " refused access (HTTP " + status + "). Check the token or sign in again.";
  if (status === 404) return h + " says the address was not found (HTTP 404).";
  if (status === 429) return h + " is asking us to slow down (HTTP 429). It will retry later.";
  if (status >= 500) return h + " is having trouble (HTTP " + status + "). It will retry later.";
  return h + " answered with an error (HTTP " + status + ").";
}

function form(obj) {
  return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
}

module.exports = { request: request, json: json, form: form, describeStatus: describeStatus };
