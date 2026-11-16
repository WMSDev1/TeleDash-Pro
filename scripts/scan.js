#!/usr/bin/env node
// Personal-data and secret scan for scripts/check.sh. This file is public, so every rule is
// generic; anything specific to one person goes in a local denylist that never enters the repo:
//   $TELEDASH_DENYLIST, else ~/.config/teledash/denylist.txt  (one term per line, # = comment)
// Usage: node scripts/scan.js <file>...   or a newline-separated file list on stdin.
// Prints "path:line: rule" per finding (never the matched text) and exits 1 if anything is found.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

// Documentation-style examples that may appear in docs and tests.
const ALLOWED_PRIVATE_IP = /^192\.168\.[01]\.\d{1,3}$/;
const ALLOWED_EMAIL_DOMAIN = /(^|\.)example\.(com|org|net)$/i;
const FILE_LIKE_TLD = /\.(png|jpe?g|gif|svg|webp|ico|js|css|json|html?|ipk)$/i;   // icon@2x.png etc.
// Coordinates are only looked for in config and defaults files, where a home location would live.
const COORD_FILE = /(^|\/)[^/]*(config|default)[^/]*\.(js|json)$/i;
const TEST_FILE = /(^|\/)tests?\/|\.test\.js$/;

function isPrivateIPv4(ip) {
  const o = ip.split(".").map(Number);
  if (o.some(n => n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

const RULES = [
  { name: "private IPv4 address (use 192.168.1.x in examples)",
    re: /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d]|\.\d)/g,
    hit: m => isPrivateIPv4(m) && !ALLOWED_PRIVATE_IP.test(m) },
  { name: "email address (use name@example.com)",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    hit: m => {
      const [local, domain] = m.split("@");
      if (/^no-?reply/i.test(local) || ALLOWED_EMAIL_DOMAIN.test(domain)) return false;
      if (m === "git@github.com" || FILE_LIKE_TLD.test(m)) return false;
      return true;
    } },
  { name: "Google calendar private address",
    re: /private-[0-9a-f]{16,}|calendar\/ical\/[^/\s]+%40[^/\s]+\/private/gi },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { name: "Google OAuth client secret", re: /GOCSPX-[A-Za-z0-9_-]{10,}/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: "private key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { name: "coordinates with 2+ decimals in a config/defaults file (round to 1 decimal or use null)",
    only: f => COORD_FILE.test(f) && !TEST_FILE.test(f),
    re: /\b(?:lat|latitude|lon|lng|longitude)["']?\s*[:=]\s*-?\d{1,3}\.\d{2,}|\[\s*-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}\s*\]/gi },
];

function loadDenylist(env, home) {
  const file = env.TELEDASH_DENYLIST || path.join(home, ".config", "teledash", "denylist.txt");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return { file: null, terms: [] }; }
  const terms = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  return { file, terms };
}

function scanText(name, text, denyTerms) {
  const found = [];
  const lines = text.split("\n");
  const lower = denyTerms.map(t => t.toLowerCase());
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.only && !rule.only(name)) continue;
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line))) {
        if (!rule.hit || rule.hit(m[0])) { found.push({ line: i + 1, rule: rule.name }); break; }
      }
    }
    const l = line.toLowerCase();
    lower.forEach((t, n) => { if (l.includes(t)) found.push({ line: i + 1, rule: "denylist entry " + (n + 1) }); });
  });
  return found;
}

function main() {
  let files = process.argv.slice(2);
  if (!files.length) files = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
  const deny = loadDenylist(process.env, os.homedir());
  if (deny.file) console.log("scan: using denylist " + deny.file + " (" + deny.terms.length + " terms)");
  let count = 0;
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(f); } catch (e) { continue; }   // listed but deleted
    if (buf.length > 4 * 1024 * 1024 || buf.includes(0)) continue;  // binary or huge
    for (const hit of scanText(f, buf.toString("utf8"), deny.terms)) {
      console.log(f + ":" + hit.line + ": " + hit.rule);
      count++;
    }
  }
  process.exit(count ? 1 : 0);
}

if (require.main === module) main();
module.exports = { scanText, isPrivateIPv4, loadDenylist };
