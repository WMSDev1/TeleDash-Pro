"use strict";
// The inspector client that repairs Spotify's player (lib/inspector.js), against a stand-in
// inspector on a local port: page list, WebSocket handshake and framing, and which frames the
// fix is run in. The fix script itself is run in a sandbox with a fake fetch.
var t = require("./harness");
var assert = require("assert");
var http = require("http");
var crypto = require("crypto");
var vm = require("vm");
var inspector = require("../lib/inspector");

var APP = "com.example.dashboard";

function serverFrame(opcode, payload, fin) {
  var len = payload.length, head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = (fin === false ? 0 : 0x80) | opcode;
  return Buffer.concat([head, payload]);
}

// A stand-in inspector. frames: what each frame of the page answers to Runtime.evaluate
// (a string, or null for a frame that throws). Records the expressions it was asked to run.
function fakeInspector(pages, frames) {
  var seen = { expressions: [], pongs: 0, sockets: 0 };
  var open = [];
  var server = http.createServer(function (req, res) {
    if (req.url !== "/json") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pages(server.address().port)));
  });
  server.on("upgrade", function (req, socket) {
    seen.sockets++;
    open.push(socket);
    var accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
    var buf = Buffer.alloc(0);
    function say(obj) { socket.write(serverFrame(1, Buffer.from(JSON.stringify(obj), "utf8"))); }
    socket.on("error", function () {});
    socket.on("data", function (chunk) {
      buf = Buffer.concat([buf, chunk]);
      var out = inspector._decodeFrames(buf);
      buf = out.rest;
      out.frames.forEach(function (f) {
        if (f.opcode === 10) { seen.pongs++; return; }
        if (f.opcode !== 1) return;
        var msg = JSON.parse(f.payload.toString("utf8"));
        if (msg.method === "Runtime.enable") {
          frames.forEach(function (_, i) { say({ method: "Runtime.executionContextCreated", params: { context: { id: i + 1, origin: "x" } } }); });
          say({ id: msg.id, result: {} });
        } else if (msg.method === "Runtime.evaluate") {
          seen.expressions.push(msg.params.expression);
          assert.strictEqual(msg.params.returnByValue, true);
          var v = frames[msg.params.contextId - 1];
          var reply = Buffer.from(JSON.stringify({ id: msg.id, result: v === null ? { exceptionDetails: { text: "Uncaught" } } : { result: { type: "string", value: v } } }), "utf8");
          // In two fragments with a ping between them, as the protocol allows.
          var cut = Math.floor(reply.length / 2);
          socket.write(Buffer.concat([serverFrame(1, reply.slice(0, cut), false), serverFrame(9, Buffer.from("hi")), serverFrame(0, reply.slice(cut), true)]));
        }
      });
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      // An upgraded socket stays half open after the client leaves, so close() ends them itself.
      resolve({ port: server.address().port, seen: seen, close: function () {
        open.forEach(function (s) { s.destroy(); });
        return new Promise(function (r) { server.close(r); });
      } });
    });
  });
}

function page(port, url, withSocket) {
  var p = { type: "page", url: url, id: "A1" };
  if (withSocket !== false) p.webSocketDebuggerUrl = "ws://127.0.0.1:" + port + "/devtools/page/A1";
  return p;
}

t.test("frames: round trip at every length encoding", function () {
  [0, 1, 125, 126, 65535, 65536, 70000].forEach(function (n) {
    var payload = crypto.randomBytes(n);
    var out = inspector._decodeFrames(inspector._encodeFrame(1, payload));
    assert.strictEqual(out.frames.length, 1, "length " + n);
    assert.strictEqual(out.rest.length, 0);
    assert.strictEqual(out.frames[0].opcode, 1);
    assert.strictEqual(out.frames[0].fin, true);
    assert.ok(out.frames[0].payload.equals(payload), "payload of " + n);
  });
});

t.test("frames: a partial frame waits for the rest", function () {
  var whole = inspector._encodeFrame(1, Buffer.from("hello there"));
  var out = inspector._decodeFrames(whole.slice(0, whole.length - 3));
  assert.strictEqual(out.frames.length, 0);
  assert.strictEqual(out.rest.length, whole.length - 3);
  var two = inspector._decodeFrames(Buffer.concat([whole, whole.slice(0, 4)]));
  assert.strictEqual(two.frames.length, 1);
  assert.strictEqual(two.rest.length, 4);
});

t.test("fixPlayer: runs the fix in every frame, counts only Spotify's player", function () {
  return fakeInspector(function (port) {
    return [page(port, "file:///apps/other.app/index.html"), page(port, "file:///apps/" + APP + "/index.html")];
  }, ["skip", "fixed", null, "skip"]).then(function (fake) {
    return inspector.fixPlayer(APP, { port: fake.port, timeout: 2000 }).then(function (r) {
      assert.deepStrictEqual(r, { available: true, fixed: 1 });
      assert.strictEqual(fake.seen.expressions.length, 4);
      fake.seen.expressions.forEach(function (e) {
        assert.ok(e.indexOf("location.host === '" + inspector.FRAME_HOST + "'") >= 0, "guarded by the frame's host");
        assert.ok(e.indexOf(inspector.FIX) >= 0);
      });
      assert.ok(fake.seen.pongs >= 1, "answers a ping");
      return fake.close();
    });
  });
});

t.test("fixPlayer: a frame that already has the fix still counts", function () {
  return fakeInspector(function (port) { return [page(port, "file:///apps/" + APP + "/index.html")]; }, ["skip", "already"]).then(function (fake) {
    return inspector.fixPlayer(APP, { port: fake.port, timeout: 2000 }).then(function (r) {
      assert.deepStrictEqual(r, { available: true, fixed: 1 });
      return fake.close();
    });
  });
});

t.test("fixPlayer: the player has not loaded yet", function () {
  return fakeInspector(function (port) { return [page(port, "file:///apps/" + APP + "/index.html")]; }, ["skip"]).then(function (fake) {
    return inspector.fixPlayer(APP, { port: fake.port, timeout: 2000 }).then(function (r) {
      assert.deepStrictEqual(r, { available: true, fixed: 0 });
      return fake.close();
    });
  });
});

t.test("fixPlayer: says why when the inspector cannot be used", function () {
  return fakeInspector(function (port) { return [page(port, "file:///apps/other.app/index.html")]; }, []).then(function (fake) {
    return inspector.fixPlayer(APP, { port: fake.port, timeout: 2000 }).then(function (r) {
      assert.deepStrictEqual(r, { available: false, reason: "no page" });
      assert.strictEqual(fake.seen.sockets, 0);
      return fake.close();
    });
  }).then(function () {
    // Someone else is already inspecting the page: Chromium then lists it without a socket address.
    return fakeInspector(function (port) { return [page(port, "file:///apps/" + APP + "/index.html", false)]; }, []);
  }).then(function (fake) {
    return inspector.fixPlayer(APP, { port: fake.port, timeout: 2000 }).then(function (r) {
      assert.deepStrictEqual(r, { available: false, reason: "busy" });
      return fake.close();
    });
  }).then(function () {
    // Nothing listening: take a port, close it, and use its number.
    return fakeInspector(function () { return []; }, []);
  }).then(function (fake) {
    var port = fake.port;
    return fake.close().then(function () { return inspector.fixPlayer(APP, { port: port, timeout: 2000 }); });
  }).then(function (r) {
    assert.deepStrictEqual(r, { available: false, reason: "closed" });
  });
});

// ---------- the fix itself ----------

function sandbox() {
  var calls = [];
  function AbortSignal() { this.aborted = false; this.listeners = []; }
  AbortSignal.prototype.addEventListener = function (type, fn) { this.listeners.push(fn); };
  function AbortController() {
    var signal = new AbortSignal();
    this.signal = signal;
    this.abort = function () { signal.aborted = true; signal.listeners.forEach(function (fn) { fn(); }); };
  }
  var window = { fetch: function (u, o) { calls.push({ self: this, u: u, o: o, n: arguments.length }); return "response"; } };
  return { window: window, AbortSignal: AbortSignal, AbortController: AbortController, calls: calls };
}

t.test("the fix: swaps a signal the TV would refuse for a real one, and still cancels", function () {
  var s = sandbox();
  assert.strictEqual(vm.runInNewContext(inspector.FIX, s), "fixed");
  var fake = { aborted: false, fns: [], addEventListener: function (type, fn) { assert.strictEqual(type, "abort"); this.fns.push(fn); } };
  var init = { method: "GET", headers: { a: "b" }, signal: fake };
  assert.strictEqual(s.window.fetch("https://example.invalid/x", init), "response");
  var call = s.calls[0];
  assert.strictEqual(call.u, "https://example.invalid/x");
  assert.ok(call.o.signal instanceof s.AbortSignal, "a real signal reaches fetch");
  assert.strictEqual(call.o.method, "GET");
  assert.strictEqual(call.o.headers, init.headers);
  assert.strictEqual(init.signal, fake, "the caller's object is left alone");
  assert.strictEqual(call.o.signal.aborted, false);
  fake.fns[0]();                                           // the player cancels
  assert.strictEqual(call.o.signal.aborted, true, "the cancel is passed on");
});

t.test("the fix: a signal that was already cancelled stays cancelled", function () {
  var s = sandbox();
  vm.runInNewContext(inspector.FIX, s);
  s.window.fetch("https://example.invalid/x", { signal: { aborted: true } });
  assert.strictEqual(s.calls[0].o.signal.aborted, true);
});

t.test("the fix: leaves every other request exactly as it was", function () {
  var s = sandbox();
  vm.runInNewContext(inspector.FIX, s);
  var real = new s.AbortController().signal;
  var init = { signal: real };
  s.window.fetch("https://example.invalid/a", init);
  s.window.fetch("https://example.invalid/b");
  s.window.fetch("https://example.invalid/c", { method: "POST" });
  assert.strictEqual(s.calls[0].o, init, "a real signal is passed straight through");
  assert.strictEqual(s.calls[1].n, 1);
  assert.strictEqual(s.calls[2].o.signal, undefined);
});

t.test("the fix: running it twice wraps fetch once", function () {
  var s = sandbox();
  assert.strictEqual(vm.runInNewContext(inspector.FIX, s), "fixed");
  var wrapped = s.window.fetch;
  assert.strictEqual(vm.runInNewContext(inspector.FIX, s), "already");
  assert.strictEqual(s.window.fetch, wrapped);
});

t.run();
