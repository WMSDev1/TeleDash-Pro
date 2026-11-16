#!/usr/bin/env node
// ES5 check for app/*.js (the TV's browser engine is Chromium ~79 and the app is kept to ES5).
// Parses with acorn at ecmaVersion 5 when acorn can be found (CI installs it; ares-package's
// own copy is used on a developer machine); otherwise falls back to a rough check for
// =>, template literals, let and const outside comments and strings.
// Usage: node scripts/es5.js <file>...   Exits 1 on any problem.
"use strict";
const fs = require("fs");
const path = require("path");

function findAcorn() {
  try { return require("acorn"); } catch (e) { /* not on NODE_PATH */ }
  // ares-package on PATH links to <...>/@webos-tools/cli/bin/ares-package.js, which ships acorn.
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    try {
      const real = fs.realpathSync(path.join(dir, "ares-package"));
      return require(path.join(path.dirname(real), "..", "node_modules", "acorn"));
    } catch (e) { /* try the next PATH entry */ }
  }
  return null;
}

// Blank out comments and string contents (keeping line breaks) so prose cannot trip the regexes.
// Template literals are kept: a backtick is itself a violation. Regex literals are not handled.
function strip(src) {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2), stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " "); i = stop; continue;
    }
    if (c === "'" || c === '"') {
      out += c; i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") { out += " "; i++; }
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      out += c; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

const FALLBACK = [
  [/=>/, "arrow function"],
  [/`/, "template literal"],
  [/\blet\s+[A-Za-z_$[{]/, "let"],
  [/\bconst\s+[A-Za-z_$[{]/, "const"],
];

function checkFallback(src) {
  const problems = [];
  strip(src).split("\n").forEach((line, i) => {
    for (const [re, what] of FALLBACK) if (re.test(line)) problems.push((i + 1) + ": " + what + " is not ES5");
  });
  return problems;
}

function check(file, src, acorn) {
  if (!acorn) return checkFallback(src);
  try {
    acorn.parse(src, { ecmaVersion: 5, sourceType: "script", locations: true });
    return [];
  } catch (e) {
    return [(e.loc ? e.loc.line : "?") + ": " + e.message.replace(/\s*\(\d+:\d+\)$/, "")];
  }
}

function main() {
  const acorn = findAcorn();
  console.log("es5: " + (acorn ? "acorn " + acorn.version + " (ecmaVersion 5)" : "regex fallback (acorn not found)"));
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    for (const p of check(f, fs.readFileSync(f, "utf8"), acorn)) { console.log(f + ":" + p); bad++; }
  }
  process.exit(bad ? 1 : 0);
}

if (require.main === module) main();
module.exports = { check, checkFallback, strip, findAcorn };
