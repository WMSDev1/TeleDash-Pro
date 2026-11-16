// Structural checks for app/qr.js. CI has no QR decoder, so this checks the parts a scanner relies on
// (finders, timing, format info, version sizing) and locks one matrix that was decoded independently.
const assert = require("assert");
const QR = require("../app/qr.js");

const URL_EXAMPLE = "http://192.168.1.50:8770/s/Ab3dEf9h";
const versionOf = (m) => (m.length - 17) / 4;

// Size is 17 + 4 * version, and the smallest version is chosen (byte mode, level M capacities).
for (const [len, ver] of [[0, 1], [1, 1], [14, 1], [15, 2], [26, 2], [27, 3], [42, 3], [150, 8], [213, 10], [214, 11], [2331, 40]]) {
  const m = QR.matrix("x".repeat(len));
  assert.strictEqual(m.length, 17 + 4 * ver, `length ${len} should be version ${ver}`);
  assert.ok(m.every((row) => row.length === m.length && row.every((b) => typeof b === "boolean")), "square boolean rows");
}
assert.throws(() => QR.matrix("x".repeat(2332)), /too long/);

// Length counts UTF-8 bytes: 7 x "é" = 14 bytes fits version 1, 8 x "é" = 16 bytes does not.
assert.strictEqual(versionOf(QR.matrix("é".repeat(7))), 1);
assert.strictEqual(versionOf(QR.matrix("é".repeat(8))), 2);

// Version 7+ symbols carry version info: two 6x3 copies that must mirror each other.
function checkVersionInfo(m) {
  const n = m.length;
  for (let i = 0; i < 18; i++) {
    const a = n - 11 + (i % 3), b = Math.floor(i / 3);
    assert.strictEqual(m[b][a], m[a][b], "version info copies match");
  }
}

// Format info: 15 bits, BCH(15,5) with mask 0x5412; level M is 00. Re-derived here independently.
const validFormats = [];
for (let mask = 0; mask < 8; mask++) {
  const data = mask;                           // (00 << 3) | mask
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  validFormats.push(((data << 10) | rem) ^ 0x5412);
}

function checkStructure(m, label) {
  const n = m.length;
  // Finder patterns: 7x7 rings (dark border, light ring, dark 3x3 core) plus a light separator.
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      assert.strictEqual(m[y][x], d !== 2 && d !== 4, `${label}: finder at ${cx},${cy} module ${x},${y}`);
    }
  }
  // Timing patterns alternate between the finders on row 6 and column 6.
  for (let i = 8; i < n - 8; i++) {
    assert.strictEqual(m[6][i], i % 2 === 0, `${label}: timing row at ${i}`);
    assert.strictEqual(m[i][6], i % 2 === 0, `${label}: timing column at ${i}`);
  }
  assert.strictEqual(m[n - 8][8], true, `${label}: dark module`);
  // Both format-info copies hold the same valid level-M code.
  let a = 0, b = 0;
  const bit = (v, k) => (v ? 1 << k : 0);
  for (let i = 0; i <= 5; i++) a |= bit(m[i][8], i);
  a |= bit(m[7][8], 6) | bit(m[8][8], 7) | bit(m[8][7], 8);
  for (let i = 9; i < 15; i++) a |= bit(m[8][14 - i], i);
  for (let i = 0; i < 8; i++) b |= bit(m[8][n - 1 - i], i);
  for (let i = 8; i < 15; i++) b |= bit(m[n - 15 + i][8], i);
  assert.strictEqual(a, b, `${label}: format copies match`);
  assert.ok(validFormats.indexOf(a) >= 0, `${label}: format info is a valid level-M code`);
  if (versionOf(m) >= 7) checkVersionInfo(m);
}

for (const t of [URL_EXAMPLE, "a", "", "Héllo wörld ✓ 😀", "x".repeat(150), "y".repeat(400), "z".repeat(2331)]) {
  checkStructure(QR.matrix(t), JSON.stringify(t.slice(0, 20)));
}

// Deterministic output.
assert.deepStrictEqual(QR.matrix(URL_EXAMPLE), QR.matrix(URL_EXAMPLE));

// Known-good matrix: this exact output was decoded by jsQR and by Chrome's BarcodeDetector, and is
// identical to the matrix from an independent reference encoder (rows top to bottom, hex of bits).
const GOLDEN = "fe621bfc1045506e98d6bb745835dba480aec1488d07faaaafe00cb80096abbd0560241a559bb77dc96a5ce2713535822778920f9a84edb01e9a8adc7053c7b6706f8a911678d6da39e10cfa0049e45ff920aa505f771dba20cfcdd78274ae930f7304b8b8afea0fc10";
const gm = QR.matrix(URL_EXAMPLE), bits = gm.map((r) => r.map((v) => (v ? 1 : 0)).join("")).join("");
let hex = "";
for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4).padEnd(4, "0"), 2).toString(16);
assert.strictEqual(gm.length, 29);
assert.strictEqual(hex, GOLDEN, "URL example matrix changed");

// Larger versions (multiple ECC blocks, 16-bit length from version 10, version info from 7), locked by
// hash. Each was identical to the reference encoder's matrix and decoded by jsQR when recorded.
const crypto = require("crypto");
const hash = (m) => crypto.createHash("sha256").update(m.map((r) => r.map((v) => (v ? 1 : 0)).join("")).join("\n")).digest("hex").slice(0, 16);
const gen = (n, seed) => { let s = ""; for (let i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyz-./:"[(i * 7 + seed * 13 + ((i * i) % 11)) % 30]; return s; };
for (const [n, ver, h] of [[1, 1, "f151639f37b08eee"], [150, 8, "ba71ebe7203b0c4f"], [160, 9, "b467fe641b98fe8a"],
  [213, 10, "569866b8ec83ef01"], [214, 11, "aee423dc6b502428"], [400, 15, "bde42eee19d2271d"],
  [1000, 26, "e9538b720289909e"], [2331, 40, "a85a8e963a0bc349"]]) {
  const m = QR.matrix(gen(n, n));
  assert.strictEqual(versionOf(m), ver, `${n} bytes -> version ${ver}`);
  assert.strictEqual(hash(m), h, `${n}-byte matrix changed`);
}

// SVG: white background, dark path, 4-module quiet zone in the viewBox, requested pixel size.
const svg = QR.svg(URL_EXAMPLE, 300);
assert.ok(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg), "svg root");
assert.ok(svg.indexOf('width="300"') > 0 && svg.indexOf('height="300"') > 0, "svg size");
assert.ok(svg.indexOf('viewBox="0 0 37 37"') > 0, "viewBox = 29 modules + 2 x 4 quiet zone");
assert.ok(/<rect[^>]+fill="#fff"/.test(svg) && /<path d="M4 4h7v1h-7z/.test(svg), "background rect and path");
assert.ok(svg.indexOf('shape-rendering="crispEdges"') > 0, "crisp edges");
assert.ok(/<\/svg>$/.test(svg), "closed svg");

console.log("qr checks passed");
