#!/usr/bin/env node
'use strict'

// THE ONLY THING THE SUPERVISOR'S MODEL CAN DO.
//
// This runs on a supervisor machine, beside Claude Code, and speaks MCP over
// stdin and stdout. Every tool it offers is one verb of the dashboard's
// supervisor API, and it offers nothing else — no shell, no file, no fetch.
//
// WHY A TOOL SERVER RATHER THAN A PERMISSION RULE. The obvious way to restrict a
// model is to give it Bash and allow only `okc ...`. That is a rule about a
// STRING, on a tool that runs anything: it holds until somebody writes
// `okc tasks; cat ~/.ssh/id_ed25519`, or a prompt injected through an issue
// title does. What a model cannot do is safer than what it is asked not to do,
// so the shell is not there at all. "No filesystem" is then a fact about what
// exists rather than a promise about what will be typed.
//
// THREE FENCES, AND EACH WOULD DO ON ITS OWN:
//
//   1. this server offers only the verbs the HOST says a supervisor may ask for.
//      It fetches that list at startup — it does not carry its own copy — so a
//      verb removed on the host disappears here on the next start.
//   2. Claude Code is launched with --strict-mcp-config and an allowlist naming
//      only these tools, and every built-in tool denied. See okc-supervisor.
//   3. the host refuses anything off the list anyway, whatever asked. See
//      core/supervisor.js. This file being edited on the machine gains nothing.
//
// NO DEPENDENCIES, which is this project's rule everywhere and matters more here:
// a supervisor machine holds no repositories and runs no package manager after
// provisioning. Node and the machine's own certificate, nothing else.

const fs = require('node:fs')
const https = require('node:https')
const readline = require('node:readline')

// Where this machine keeps what it needs to talk to the dashboard. Written by
// provision/supervisor-user.sh, readable only by this user.
const env = (() => {
  const out = {}
  try {
    for (const line of fs.readFileSync(`${process.env.HOME}/.okc/env`, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)='(.*)'$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
  } catch { /* reported below, as a tool listing of nothing */ }
  return out
})()

const BASE = env.OKC_BASE || ''
const VM = env.OKC_VM || ''
const TOKEN = env.OKC_TOKEN || ''
const CA = env.OKC_CA || '/etc/okc/ca.pem'

// Everything goes through here, and it is the only network this process does.
// The certificate is the machine's own authority — see core/keys.js — so nothing
// here is ever told to skip verification.
function ask (method, path, body) {
  return new Promise((resolve, reject) => {
    let url
    try { url = new URL(BASE + path) } catch (e) { return reject(new Error(`no dashboard address: ${e.message}`)) }
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = https.request({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      ca: (() => { try { return fs.readFileSync(CA) } catch { return undefined } })(),
      headers: {
        authorization: 'Basic ' + Buffer.from(`${VM}:${TOKEN}`).toString('base64'),
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {})
      },
      timeout: 120000
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = text ? JSON.parse(text) : null } catch { /* handed back as text */ }
        resolve({ status: res.statusCode, body: json, text })
      })
    })
    req.on('timeout', () => req.destroy(new Error('the dashboard did not answer within two minutes')))
    req.on('error', e => reject(new Error(`could not reach the dashboard: ${e.message}`)))
    if (payload) req.write(payload)
    req.end()
  })
}

// ---- what this offers, which is what the host says it may ------------------
//
// Asked once at startup. A list carried in this file would be a second copy of
// the allowlist, and two copies of a permission list is how one of them ends up
// wrong in the generous direction.
let TOOLS = []

async function learnWhatIsAllowed () {
  const said = await ask('GET', `/supervisor?vm=${encodeURIComponent(VM)}`)
  if (said.status !== 200 || !said.body || !Array.isArray(said.body.may)) {
    throw new Error(`the dashboard did not say what a supervisor may do (${said.status}): ${String(said.text || '').slice(0, 200)}`)
  }
  TOOLS = said.body.may.map(one => ({
    name: one.what,
    description: one.why,
    inputSchema: {
      type: 'object',
      // The named arguments the action takes, all optional and all free-form:
      // this server is a pipe, and the action on the other end is what decides
      // whether an argument makes sense. Duplicating its validation here would
      // be a second opinion that goes stale.
      properties: Object.fromEntries((one.takes || []).map(t => [t, { description: `the "${t}" argument` }])),
      additionalProperties: true
    }
  }))
}

// ---- MCP, which is JSON-RPC over stdio -------------------------------------

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n')
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
const bad = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } })

async function handle (msg) {
  const { id, method, params } = msg

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'okc', version: '1' }
    })
  }

  // A notification: no id, no reply. Replying to one is a protocol error that
  // some clients tolerate and some do not.
  if (method === 'notifications/initialized') return

  if (method === 'tools/list') return ok(id, { tools: TOOLS })

  if (method === 'tools/call') {
    const what = params && params.name
    const args = (params && params.arguments) || {}

    // REFUSED HERE AS WELL AS THERE. The host refuses anything off its list, so
    // this is not the boundary — it is the boundary being legible: a model that
    // asks for something it cannot have gets a sentence rather than a 403 out of
    // a proxy, and the sentence says what it may do instead.
    if (!TOOLS.some(t => t.name === what)) {
      return ok(id, {
        isError: true,
        content: [{ type: 'text', text: `There is no tool called "${what}". What you have: ${TOOLS.map(t => t.name).join(', ')}. Nothing else on this host exists for you — no shell, no files, no network.` }]
      })
    }

    try {
      const said = await ask('POST', `/supervisor/do?vm=${encodeURIComponent(VM)}&what=${encodeURIComponent(what)}`, args)
      const text = said.body ? JSON.stringify(said.body, null, 2) : String(said.text || '')
      // A refusal is an ANSWER, not a crash: the model is meant to read it and
      // do something else. `isError` is how MCP says "this did not work" without
      // ending the conversation.
      return ok(id, { isError: said.status >= 400, content: [{ type: 'text', text }] })
    } catch (e) {
      return ok(id, { isError: true, content: [{ type: 'text', text: e.message }] })
    }
  }

  if (id != null) bad(id, `this server does not implement "${method}"`)
}

async function main () {
  await learnWhatIsAllowed()
  const lines = readline.createInterface({ input: process.stdin })
  for await (const line of lines) {
    if (!line.trim()) continue
    let msg = null
    try { msg = JSON.parse(line) } catch { continue }
    try { await handle(msg) } catch (e) { if (msg && msg.id != null) bad(msg.id, e.message) }
  }
}

main().catch(e => {
  // To stderr, which the client shows as the server failing to start. Stdout is
  // the protocol and anything written there that is not JSON-RPC breaks it.
  process.stderr.write(`okc-mcp: ${e.message}\n`)
  process.exit(1)
})
