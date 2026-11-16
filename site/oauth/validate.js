// Google sign-in return page logic (CONTRACT.md, "Google sign-in", step 3).
// Google sends the phone here with ?code&state (or ?error). The state names the TV's setup
// address; we only forward to it when it is plain http to a private IPv4 address and a port,
// so this public page can never be used as an open redirect.
// ES5 and dependency-free: it also runs under node for scripts/test-oauth.js.
var TeleDashOAuth = (function () {
  "use strict";

  function decodeBase64Url(s) {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return null;
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    while (b64.length % 4) b64 += "=";
    try {
      if (typeof atob === "function") return atob(b64);
      return Buffer.from(b64, "base64").toString("binary");
    } catch (e) {
      return null;
    }
  }

  // state = base64url(JSON {"t": "http://<lan-ip>:<port>", "n": "<nonce>"})
  function parseState(state) {
    var text = decodeBase64Url(state);
    if (text === null) return null;
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return null; }
    if (!obj || typeof obj !== "object" || typeof obj.t !== "string" || typeof obj.n !== "string") return null;
    return obj;
  }

  // Decimal octet 0-255 without leading zeros: browsers read "010" as octal, so reject it.
  function octet(s) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(s)) return -1;
    var n = parseInt(s, 10);
    return n <= 255 ? n : -1;
  }

  // 10/8, 172.16/12, 192.168/16 only.
  function isPrivateIPv4(host) {
    var p = String(host).split(".");
    if (p.length !== 4) return false;
    var o = [];
    for (var i = 0; i < 4; i++) {
      o[i] = octet(p[i]);
      if (o[i] < 0) return false;
    }
    return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
  }

  // Returns the TV origin ("http://a.b.c.d:port") or null. Exact shape only: no path,
  // no user info, no trailing slash, nothing a URL parser could reinterpret.
  function targetOrigin(t) {
    var m = /^http:\/\/([0-9.]+):([0-9]{1,5})$/.exec(t);
    if (!m || !isPrivateIPv4(m[1])) return null;
    if (!/^[1-9]/.test(m[2])) return null;
    var port = parseInt(m[2], 10);
    if (port < 1 || port > 65535) return null;
    return t;
  }

  function getParam(search, name) {
    var q = String(search || "").replace(/^\?/, "").split("&");
    for (var i = 0; i < q.length; i++) {
      var kv = q[i].split("=");
      if (kv[0] === name) {
        try { return decodeURIComponent((kv[1] || "").replace(/\+/g, " ")); } catch (e) { return null; }
      }
    }
    return null;
  }

  // Decides what the page does with a given location.search:
  //   { action: "redirect", url }                    forward to the TV
  //   { action: "error", message, setupUrl|null }    show a message, never redirect
  function decide(search) {
    var state = getParam(search, "state");
    var parsed = state ? parseState(state) : null;
    var origin = parsed ? targetOrigin(parsed.t) : null;
    var error = getParam(search, "error");

    if (error) {
      var msg = error === "access_denied"
        ? "Google sign-in was cancelled. Nothing was changed."
        : "Google reported a problem with sign-in (" + error.slice(0, 60) + ").";
      return { action: "error", message: msg, setupUrl: origin ? origin + "/setup" : null };
    }
    if (!state || !getParam(search, "code")) {
      return { action: "error", message: "This page is only used during Google sign-in from the TeleDash Pro setup page. Start again from there.", setupUrl: null };
    }
    if (!parsed) {
      return { action: "error", message: "The sign-in link was damaged on the way back from Google. Start again from the setup page.", setupUrl: null };
    }
    if (!origin) {
      return { action: "error", message: "The sign-in did not point back to a TV on your home network, so this page will not continue. Start again from the setup page on your TV's network.", setupUrl: null };
    }
    // The query always starts with "?", so it can only ever extend the path on the TV's origin.
    var qs = String(search).charAt(0) === "?" ? String(search) : "?" + search;
    return { action: "redirect", url: origin + "/oauth/return" + qs };
  }

  function run(doc, loc) {
    var d = decide(loc.search);
    if (d.action === "redirect") {
      doc.getElementById("status").textContent = "Returning to your TV...";
      loc.replace(d.url);
      return d;
    }
    doc.getElementById("status").textContent = d.message;
    if (d.setupUrl) {
      var a = doc.getElementById("setup");
      a.href = d.setupUrl;
      a.className = "button";
    }
    return d;
  }

  return { decide: decide, parseState: parseState, isPrivateIPv4: isPrivateIPv4, targetOrigin: targetOrigin, run: run };
})();

if (typeof module !== "undefined" && module.exports) module.exports = TeleDashOAuth;
if (typeof document !== "undefined" && document.getElementById("td-oauth")) TeleDashOAuth.run(document, window.location);
