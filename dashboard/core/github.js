'use strict'

// The token this host uses to reach GitHub, and the requests it makes with it.
//
// ONLY THIS HOST HOLDS IT. A machine pushes to the dashboard's own git server
// and never to GitHub, so no machine is ever handed this token — which is the
// whole reason the arrangement is worth the extra hop. A runner is rolled back
// to a snapshot after every task; anything it held is on a disk that gets
// discarded, and a token that was never there cannot be discarded wrongly.
//
// It is also the second unregenerable secret this app keeps. The certificate and
// the ssh key can be remade from the Keys tab at the cost of re-provisioning;
// this one cannot be remade here at all, and neither can the Claude credential
// beside it. So it is sealed at rest the same way, through core/secret.js, and
// it is never returned by any action — not once, not redacted, not in an error.
//
// NO DEPENDENCY, which rules out octokit and the `gh` CLI. GitHub's REST API is
// https and JSON, and node has both. `node:https` rather than fetch because this
// runs inside NW.js's node context and the module has been there since forever,
// where a global is a thing to check for.

const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const data = require('./data')
const secret = require('./secret')

const DIR = () => data.sub('credentials')
const FILE = () => path.join(DIR(), 'github.json')
const ABOUT = () => path.join(DIR(), 'github-about.json')

// github.com unless something says otherwise. An Enterprise host answers the
// same API at a different address, and knowing that now costs one field and
// saves finding out later that every path was hardcoded.
const PUBLIC = 'api.github.com'

const about = () => {
  try { return JSON.parse(fs.readFileSync(ABOUT(), 'utf8')) } catch { return {} }
}

const remember = next => {
  try { fs.mkdirSync(DIR(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(ABOUT(), JSON.stringify({ ...about(), ...next }, null, 2)) } catch { /* the answer still stands for this call */ }
}

const has = () => fs.existsSync(FILE())

// Read only where it is used, and never returned.
const token = () => secret.read(FILE()).toString('utf8').trim()

// ---- the request -------------------------------------------------------
//
// One place that talks to GitHub, so there is one place that adds the token, one
// place that sets the headers GitHub requires, and one place that could ever
// leak it. Everything else asks this.
function call (method, at, body = null, { host = null } = {}) {
  if (!has()) return Promise.reject(new Error('This host holds no GitHub token. Add one on the Keys tab.'))
  const api = host || about().api || PUBLIC
  const payload = body == null ? null : Buffer.from(JSON.stringify(body))

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: api,
      path: at,
      method,
      headers: {
        // Required by GitHub, and refused without one.
        'user-agent': 'okc-dashboard',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${token()}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {})
      },
      timeout: 30000
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = text ? JSON.parse(text) : null } catch { /* GitHub answers HTML for some errors */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text })
      })
    })
    req.on('timeout', () => { req.destroy(new Error(`GitHub did not answer within 30 seconds (${api}).`)) })
    // The message must not carry the request, because the request carries the
    // token in a header and an error message is a thing that gets logged.
    req.on('error', e => reject(new Error(`Could not reach ${api}: ${e.message}`)))
    if (payload) req.write(payload)
    req.end()
  })
}

// ---- is it any good ----------------------------------------------------
//
// THE ONLY PROOF IS ASKING GITHUB. A token is an opaque string; nothing about
// its shape says whether it works, what it can do, or whether somebody revoked
// it this morning. So this is the same lesson the Claude credential taught: a
// file on disk is not a working credential, and the answer is worth keeping so
// nothing has to ask twice.
async function check () {
  const r = await call('GET', '/user')

  if (r.status === 401) {
    remember({ checked: { at: new Date().toISOString(), ok: false, why: 'GitHub rejected it — it has been revoked, or it expired' } })
    return { ok: false, status: r.status, why: 'GitHub rejected it — it has been revoked, or it expired' }
  }
  if (r.status !== 200) {
    const why = (r.body && r.body.message) || `GitHub answered ${r.status}`
    remember({ checked: { at: new Date().toISOString(), ok: false, why } })
    return { ok: false, status: r.status, why }
  }

  // Classic tokens report their scopes in a header; fine-grained ones report
  // nothing there, and an empty string is not the same as "no permissions". It
  // is reported as unknown, because guessing here would be guessing about what
  // this app is allowed to do to somebody's repositories.
  const scopes = r.headers['x-oauth-scopes']
  const expires = r.headers['github-authentication-token-expiration'] || null

  const found = {
    login: r.body && r.body.login,
    name: (r.body && r.body.name) || null,
    kind: scopes == null ? 'fine-grained' : 'classic',
    scopes: scopes == null ? null : String(scopes).split(',').map(s => s.trim()).filter(Boolean),
    expires,
    api: about().api || PUBLIC,
    checked: { at: new Date().toISOString(), ok: true, why: null }
  }
  remember(found)
  return { ok: true, status: 200, ...found }
}

// Kept, sealed, and checked before it is believed.
//
// Verified BEFORE it replaces anything: a token that does not work should not
// evict one that does, and finding that out afterwards is how somebody ends up
// with neither.
async function put (raw, { api = null } = {}) {
  const value = String(raw || '').trim()
  if (!value) throw new Error('Paste a GitHub token.')
  if (/\s/.test(value)) throw new Error('That has whitespace in it, so it is not a token — check what was copied.')

  const was = has() ? fs.readFileSync(FILE()) : null
  const wasAbout = about()

  try { fs.mkdirSync(DIR(), { recursive: true }) } catch { /* it exists */ }
  const sealed = secret.write(FILE(), Buffer.from(value, 'utf8'))
  remember({ api: api ? String(api).trim() : (wasAbout.api || PUBLIC), added: new Date().toISOString() })

  try {
    const said = await check()
    if (!said.ok) throw new Error(said.why)
    return { held: true, sealed, ...said }
  } catch (e) {
    // Put back exactly what was there, including nothing.
    if (was) fs.writeFileSync(FILE(), was)
    else { try { fs.unlinkSync(FILE()) } catch { /* it was never written */ } }
    try { fs.writeFileSync(ABOUT(), JSON.stringify(wasAbout, null, 2)) } catch { /* best effort */ }
    throw new Error(`That token was not kept: ${e.message}`)
  }
}

function forget () {
  let gone = false
  try { fs.unlinkSync(FILE()); gone = true } catch { /* there was none */ }
  try { fs.unlinkSync(ABOUT()) } catch { /* nor its notes */ }
  return { forgotten: gone }
}

// Everything worth knowing about it, and never the token.
function held () {
  if (!has()) return { held: false, api: about().api || PUBLIC, dir: DIR() }
  const meta = about()
  const stat = fs.statSync(FILE())
  return {
    held: true,
    dir: DIR(),
    api: meta.api || PUBLIC,
    login: meta.login || null,
    name: meta.name || null,
    kind: meta.kind || null,
    scopes: meta.scopes || null,
    expires: meta.expires || null,
    added: meta.added || stat.mtime.toISOString(),
    checked: meta.checked || null,
    sealed: secret.isSealed(FILE()),
    protection: secret.isSealed(FILE())
      ? 'encrypted for this Windows account — the file alone is not enough'
      : 'file permissions only — readable by anything running as you'
  }
}

module.exports = { held, put, forget, check, call, has, PUBLIC }
