"use strict";
// Spotify: sign-in (authorization code + PKCE, no client secret) and the Web API calls behind the
// Music view (CONTRACT.md "Spotify"). The owner brings their own Spotify developer app: Spotify
// caps a development-mode app at five users, so no client can be built into the package.
// Spotify sends the phone back through the project's GitHub Pages site (<pagesBase>/oauth/), the
// same return page Google uses; the server tells the two apart by the state's nonce (owns()).
// Tokens stay in secrets.json: the dashboard only ever sees the normalised results below.
//
// INTERFACE (fixed by CONTRACT.md; server.js and the tests are written against it):
//
//   redirectUri(pagesBase)        -> "<pagesBase>/oauth/"
//   start(origin, pagesBase)      -> { authUrl, state }      throws httpError 400/500 like google.start
//   owns(state)                   -> true when this state's nonce is one of ours and not expired
//                                    (does not consume it)
//   finish(query, pagesBase)      -> Promise; stores tokens, sets settings music.tile = true
//   accessToken()                 -> Promise<string>; refreshed when within a minute of expiring
//   state()                       -> Promise<now-playing object>, cached for 1 second
//   command(body)                 -> Promise<{ ok: true }>; empties the state cache
//   list(kind, opts)              -> Promise<{ items: [...], next: <offset>|null }>
//
// Not implemented yet: every function rejects (or throws) with a 501.
var util = require("./util");

function todo() { return util.httpError(501, "Spotify support is not built yet."); }

function redirectUri(pagesBase) { return pagesBase.replace(/\/+$/, "") + "/oauth/"; }
function start() { throw todo(); }
function owns() { return false; }
function finish() { return Promise.reject(todo()); }
function accessToken() { return Promise.reject(todo()); }
function state() { return Promise.reject(todo()); }
function command() { return Promise.reject(todo()); }
function list() { return Promise.reject(todo()); }

module.exports = {
  redirectUri: redirectUri, start: start, owns: owns, finish: finish, accessToken: accessToken,
  state: state, command: command, list: list
};
