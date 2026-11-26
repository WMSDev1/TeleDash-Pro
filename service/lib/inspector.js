"use strict";
// The TV's own web inspector (Chromium's DevTools protocol on 127.0.0.1:9998), used for one job:
// repairing Spotify's player inside the dashboard (CONTRACT.md "Playing on the TV").
//
// Why it is needed. Spotify's Web Playback SDK runs in a frame served from sdk.scdn.co. Before each
// song it asks Spotify where to fetch the song's licence, and passes fetch() a cancel signal that
// is not a real AbortSignal. Current browsers accept that; the TV's Chromium 79 refuses the whole
// request ("member signal is not of type AbortSignal"), so no licence is ever requested and every
// song stops after its unprotected first ten seconds. The dashboard cannot reach into another
// site's frame, but the inspector can run a script there. The script only swaps that signal for a
// real one; nothing else about the player changes.
//
// The inspector port is open on TVs with developer mode on (how Homebrew Channel TVs are set up).
// Where it is closed, fixPlayer() says so and the Music view stays a remote control.
// Zero dependencies and Node 8 compatible, so the WebSocket client is written out here.
var http = require("http");
var net = require("net");
var crypto = require("crypto");

var HOST = "127.0.0.1";
var PORT = 9998;
var FRAME_HOST = "sdk.scdn.co";            // the only frame the script is allowed to run in
var MAX_MESSAGE = 4 * 1024 * 1024;

// Runs inside Spotify's frame. ES5, no logging, safe to run twice.
var FIX = "(function () {" +
  "if (window.__teledashSignalFix) return 'already';" +
  "window.__teledashSignalFix = 1;" +
  "var f0 = window.fetch;" +
  "window.fetch = function (u, o) {" +
    "if (o && o.signal && !(o.signal instanceof AbortSignal)) {" +
      "var s = o.signal, o2 = {}, k;" +
      "for (k in o) { o2[k] = o[k]; }" +
      "var ac = new AbortController();" +
      "o2.signal = ac.signal;" +
      "try { if (s.aborted) { ac.abort(); } else if (s.addEventListener) { s.addEventListener('abort', function () { ac.abort(); }); } } catch (e) {}" +
      "return f0.call(this, u, o2);" +
    "}" +
    "return f0.apply(this, arguments);" +
  "};" +
  "return 'fixed';" +
"})()";

function fail(reason) { var e = new Error(reason); e.reason = reason; return e; }

// ---------- the list of inspectable pages ----------

function targets(opts) {
  return new Promise(function (resolve, reject) {
    // agent: false: one request, then the connection closes (no idle socket left behind).
    var req = http.get({ host: opts.host, port: opts.port, path: "/json", timeout: opts.timeout, agent: false }, function (res) {
      var chunks = [], size = 0;
      res.on("data", function (c) { size += c.length; if (size > MAX_MESSAGE) req.abort(); else chunks.push(c); });
      res.on("end", function () {
        try {
          var list = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(Array.isArray(list) ? list : []);
        } catch (e) { reject(fail("unreadable")); }
      });
    });
    req.on("timeout", function () { req.abort(); });
    req.on("error", function () { reject(fail("closed")); });
  });
}

// ---------- a minimal WebSocket client (RFC 6455, text messages only) ----------

function encodeFrame(opcode, payload) {
  var len = payload.length, head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = 0x80 | len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = 0x80 | opcode;                                // FIN + opcode
  var mask = crypto.randomBytes(4), body = Buffer.alloc(len);
  for (var i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];   // clients must mask
  return Buffer.concat([head, mask, body]);
}

// Takes complete frames off the front of buf. Returns { frames: [{fin, opcode, payload}], rest }.
function decodeFrames(buf) {
  var frames = [];
  for (;;) {
    if (buf.length < 2) break;
    var len = buf[1] & 0x7f, at = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); at = 4; }
    else if (len === 127) {
      if (buf.length < 10) break;
      if (buf.readUInt32BE(2) !== 0) throw fail("too large");
      len = buf.readUInt32BE(6); at = 10;
    }
    if (len > MAX_MESSAGE) throw fail("too large");
    var masked = (buf[1] & 0x80) !== 0;
    if (masked) at += 4;
    if (buf.length < at + len) break;
    var payload = Buffer.from(buf.slice(at, at + len));
    if (masked) { for (var i = 0; i < len; i++) payload[i] ^= buf[at - 4 + (i & 3)]; }
    frames.push({ fin: (buf[0] & 0x80) !== 0, opcode: buf[0] & 0x0f, payload: payload });
    buf = buf.slice(at + len);
  }
  return { frames: frames, rest: buf };
}

// Opens a WebSocket. Resolves { send(text), close(), onmessage, onclose }.
function connect(opts, path) {
  return new Promise(function (resolve, reject) {
    var socket = net.connect(opts.port, opts.host);
    var key = crypto.randomBytes(16).toString("base64");
    var buf = Buffer.alloc(0), open = false, parts = [], partsSize = 0, done = false;
    var conn = {
      onmessage: null, onclose: null,
      send: function (text) { socket.write(encodeFrame(1, Buffer.from(String(text), "utf8"))); },
      close: function () { if (!done) { done = true; try { socket.end(encodeFrame(8, Buffer.alloc(0))); } catch (e) {} socket.destroy(); } }
    };
    function drop(e) {
      if (!done) { done = true; socket.destroy(); }
      if (!open) reject(e || fail("closed")); else if (conn.onclose) conn.onclose();
    }
    socket.setTimeout(opts.timeout, function () { drop(fail("timeout")); });
    socket.on("error", function () { drop(fail("closed")); });
    socket.on("close", function () { drop(fail("closed")); });
    socket.on("connect", function () {
      socket.write("GET " + path + " HTTP/1.1\r\nHost: " + opts.host + ":" + opts.port + "\r\nUpgrade: websocket\r\n" +
        "Connection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
    });
    socket.on("data", function (chunk) {
      buf = Buffer.concat([buf, chunk]);
      if (!open) {
        var end = buf.indexOf("\r\n\r\n");
        if (end < 0) { if (buf.length > 16384) drop(fail("refused")); return; }
        var head = buf.slice(0, end).toString("latin1");
        var want = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        if (!/^HTTP\/1\.1 101/.test(head) || head.toLowerCase().indexOf(("sec-websocket-accept: " + want).toLowerCase()) < 0) return drop(fail("refused"));
        buf = buf.slice(end + 4);
        open = true;
        resolve(conn);
      }
      var out;
      try { out = decodeFrames(buf); } catch (e) { return drop(e); }
      buf = out.rest;
      for (var i = 0; i < out.frames.length; i++) {
        var f = out.frames[i];
        if (f.opcode === 8) return drop();                                        // close
        if (f.opcode === 9) { socket.write(encodeFrame(10, f.payload)); continue; }   // ping -> pong
        if (f.opcode === 10) continue;                                            // pong
        parts.push(f.payload); partsSize += f.payload.length;                     // text, or a continuation
        if (partsSize > MAX_MESSAGE) return drop(fail("too large"));
        if (f.fin) {
          var text = Buffer.concat(parts).toString("utf8");
          parts = []; partsSize = 0;
          if (conn.onmessage) conn.onmessage(text);
        }
      }
    });
  });
}

// ---------- the DevTools protocol, as far as it is needed ----------

// Runs expression in every frame of the page whose address contains match. Resolves the list of
// values the frames returned (frames that threw, or returned nothing a string can carry, are left
// out). Rejects with .reason: "closed" (no inspector), "no page", "busy" (someone else is
// inspecting it), "timeout", "refused".
function evaluateInFrames(match, expression, options) {
  var opts = { host: (options && options.host) || HOST, port: (options && options.port) || PORT, timeout: (options && options.timeout) || 4000 };
  return targets(opts).then(function (list) {
    var page = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i].url === "string" && list[i].url.indexOf(match) >= 0) { page = list[i]; break; }
    }
    if (!page) throw fail("no page");
    var m = /^ws:\/\/[^/]+(\/.*)$/.exec(String(page.webSocketDebuggerUrl || ""));
    if (!m) throw fail("busy");
    return connect(opts, m[1]);
  }).then(function (conn) {
    return new Promise(function (resolve, reject) {
      var nextId = 0, waiting = {}, contexts = [], finished = false;
      var timer = setTimeout(function () { finish(fail("timeout")); }, opts.timeout);
      function finish(err, value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        conn.close();
        if (err) reject(err); else resolve(value);
      }
      function call(method, params) {
        return new Promise(function (res) {
          var id = ++nextId;
          waiting[id] = res;
          conn.send(JSON.stringify({ id: id, method: method, params: params || {} }));
        });
      }
      conn.onclose = function () { finish(fail("closed")); };
      conn.onmessage = function (text) {
        var msg;
        try { msg = JSON.parse(text); } catch (e) { return; }
        if (msg.id && waiting[msg.id]) { var w = waiting[msg.id]; delete waiting[msg.id]; return w(msg.result || {}); }
        if (msg.method === "Runtime.executionContextCreated" && msg.params && msg.params.context) contexts.push(msg.params.context.id);
      };
      // Runtime.enable reports every existing frame before it answers.
      call("Runtime.enable").then(function () {
        var values = [], chain = Promise.resolve();
        contexts.forEach(function (id) {
          chain = chain.then(function () {
            return call("Runtime.evaluate", { expression: expression, contextId: id, returnByValue: true });
          }).then(function (r) {
            if (r && r.result && typeof r.result.value === "string") values.push(r.result.value);
          });
        });
        return chain.then(function () { finish(null, values); });
      }).catch(function (e) { finish(e); });
    });
  });
}

// Repairs Spotify's player in the dashboard page of the app appId. Never rejects:
//   { available: true, fixed: n }   n player frames now carry the fix (0: the player has not loaded yet)
//   { available: false, reason }    the inspector cannot be used on this TV right now
function fixPlayer(appId, options) {
  var guarded = "(typeof location === 'object' && location.host === '" + FRAME_HOST + "') ? " + FIX + " : 'skip'";
  return evaluateInFrames(String(appId), guarded, options).then(function (values) {
    var n = 0;
    for (var i = 0; i < values.length; i++) { if (values[i] === "fixed" || values[i] === "already") n++; }
    return { available: true, fixed: n };
  }, function (e) {
    return { available: false, reason: (e && e.reason) || "failed" };
  });
}

module.exports = {
  fixPlayer: fixPlayer, evaluateInFrames: evaluateInFrames,
  FIX: FIX, FRAME_HOST: FRAME_HOST, PORT: PORT,
  _encodeFrame: encodeFrame, _decodeFrames: decodeFrames
};
