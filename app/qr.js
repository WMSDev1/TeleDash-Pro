// QR Code encoder (ISO/IEC 18004), self-contained ES5 so it runs on the TV's old browser.
// Byte mode (UTF-8), error correction level M, smallest version 1-40 that fits, best of 8 masks.
// QR.matrix(text) -> rows of booleans (true = dark), no quiet zone.
// QR.svg(text, sizePx) -> '<svg ...>' with a 4-module quiet zone on a white background.
// The structure follows Project Nayuki's reference encoder (MIT), rewritten small.
var QR = (function () {
  // Level M only. Index = version. From the ISO tables.
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  var FORMAT_ECL_M = 0;                        // the 2-bit level code for M is 00

  function utf8(text) {
    var out = [], i, c, d;
    text = String(text);
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < text.length) {   // surrogate pair -> one code point
        d = text.charCodeAt(i + 1);
        if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  // Modules available for data + ECC after all function patterns are drawn.
  function rawModules(ver) {
    var n = (16 * ver + 128) * ver + 64, a;
    if (ver >= 2) {
      a = Math.floor(ver / 7) + 2;
      n -= (25 * a - 10) * a - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }
  function dataCodewords(ver) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  // Reed-Solomon over GF(256) with the QR polynomial 0x11D.
  function gfMul(x, y) {
    var z = 0, i;
    for (i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    var r = [], i, j, root = 1;
    for (i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    for (i = 0; i < degree; i++) {
      for (j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, divisor) {
    var r = [], i, j, f;
    for (i = 0; i < divisor.length; i++) r.push(0);
    for (i = 0; i < data.length; i++) {
      f = data[i] ^ r.shift();
      r.push(0);
      for (j = 0; j < divisor.length; j++) r[j] ^= gfMul(divisor[j], f);
    }
    return r;
  }

  // Bits -> padded data codewords -> blocks with ECC -> interleaved codewords.
  function codewords(bytes, ver) {
    var cap = dataCodewords(ver) * 8, bits = [], i, data = [], pad;
    function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    put(4, 4);                                  // byte mode indicator 0100
    put(bytes.length, ver < 10 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
    put(0, Math.min(4, cap - bits.length));     // terminator
    put(0, (8 - bits.length % 8) % 8);
    for (pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    for (i = 0; i < bits.length; i += 8) {
      data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    }

    var nb = NUM_BLOCKS[ver], ecLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var shortCount = nb - raw % nb, shortLen = Math.floor(raw / nb) - ecLen;
    var div = rsDivisor(ecLen), dBlocks = [], eBlocks = [], k = 0, len, out = [], j;
    for (i = 0; i < nb; i++) {
      len = shortLen + (i < shortCount ? 0 : 1);   // later blocks carry one extra data byte
      dBlocks.push(data.slice(k, k + len));
      eBlocks.push(rsRemainder(data.slice(k, k + len), div));
      k += len;
    }
    for (i = 0; i <= shortLen; i++) {
      for (j = 0; j < nb; j++) if (i < dBlocks[j].length) out.push(dBlocks[j][i]);
    }
    for (i = 0; i < ecLen; i++) for (j = 0; j < nb; j++) out.push(eBlocks[j][i]);
    return out;
  }

  function alignPositions(ver, size) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var r = [6], pos;
    for (pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  // Builds the symbol for one mask. m[y][x] = dark?, fn[y][x] = function module (not data).
  function build(ver, cw, mask) {
    var size = ver * 4 + 17, m = [], fn = [], x, y, i, j;
    for (y = 0; y < size; y++) { m.push([]); fn.push([]); for (x = 0; x < size; x++) { m[y].push(false); fn[y].push(false); } }
    function set(x, y, dark) { m[y][x] = dark; fn[y][x] = true; }

    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // timing
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPositions(ver, size), last = ap.length - 1;
    for (i = 0; i < ap.length; i++) for (j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;  // finder corners
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    drawFormat(set, size, mask);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bit = ((vb >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }

    // Data in two-column zigzag from the bottom right, skipping the vertical timing column.
    var bitIdx = 0, total = cw.length * 8, right, vert, up;
    for (right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        x = right - j;
        up = ((right + 1) & 2) === 0;
        y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bitIdx < total) {
          m[y][x] = ((cw[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
      }
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      if (!fn[y][x] && maskBit(mask, x, y)) m[y][x] = !m[y][x];
    }
    return m;
  }

  function drawFormat(set, size, mask) {
    var data = (FORMAT_ECL_M << 3) | mask, rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function b(k) { return ((bits >>> k) & 1) === 1; }
    for (i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true);                    // the always-dark module
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  }

  // Standard penalty: long runs (N1=3), 2x2 blocks (N2=3), finder-like 1:1:3:1:1 with 4 light (N3=40),
  // dark/light balance (N4=10). Lowest score wins. Outside the symbol counts as light for rule 3,
  // as in the reference encoder, so the chosen mask matches it.
  function penalty(m) {
    var size = m.length, score = 0, dark = 0, x, y, k;
    // Rule 1 per line, plus rule 3 over run lengths: light, n, n, 3n, n, n, light (n may be > 1).
    function lineScore(get) {
      var ls = 0, i, r = 0, color = false, runs = [], n, core;
      for (i = 0; i < size; i++) {
        if (get(i) === color) { r++; if (r === 5) ls += 3; else if (r > 5) ls++; }
        else { runs.push(r); color = !color; r = 1; }
      }
      runs.push(r);
      if (color) runs.push(0);                 // runs alternate light/dark and end light
      runs[0] += size; runs[runs.length - 1] += size;
      for (i = 0; i + 6 < runs.length; i += 2) {
        n = runs[i + 1];
        core = n > 0 && runs[i + 2] === n && runs[i + 3] === 3 * n && runs[i + 4] === n && runs[i + 5] === n;
        if (core && runs[i] >= 4 * n && runs[i + 6] >= n) ls += 40;
        if (core && runs[i + 6] >= 4 * n && runs[i] >= n) ls += 40;
      }
      return ls;
    }
    for (k = 0; k < size; k++) {
      score += lineScore(function (i) { return m[k][i]; });
      score += lineScore(function (i) { return m[i][k]; });
    }
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
    var total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  // mask is optional (0-7) and only for tests; normally the lowest-penalty mask is chosen.
  function matrix(text, mask) {
    var bytes = utf8(text), ver, cw, best = null, bestScore = Infinity, k, cand, sc;
    for (ver = 1; ver <= 40; ver++) {
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 40) throw new Error("Text too long for a QR code");
    cw = codewords(bytes, ver);
    if (mask >= 0 && mask <= 7) return build(ver, cw, mask);
    for (k = 0; k < 8; k++) {
      cand = build(ver, cw, k);
      sc = penalty(cand);
      if (sc < bestScore) { best = cand; bestScore = sc; }
    }
    return best;
  }

  function svg(text, sizePx) {
    var m = matrix(text), n = m.length + 8, d = "", x, y, run;
    sizePx = sizePx || n * 4;
    for (y = 0; y < m.length; y++) {
      for (x = 0; x < m.length; x++) {
        if (!m[y][x]) continue;
        for (run = 1; x + run < m.length && m[y][x + run]; run++) {}   // merge horizontal runs
        d += "M" + (x + 4) + " " + (y + 4) + "h" + run + "v1h-" + run + "z";
        x += run - 1;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + sizePx + '" height="' + sizePx +
      '" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges">' +
      '<rect width="' + n + '" height="' + n + '" fill="#fff"/>' +
      '<path d="' + d + '" fill="#000"/></svg>';
  }

  return { matrix: matrix, svg: svg };
})();
if (typeof module !== "undefined") module.exports = QR;
