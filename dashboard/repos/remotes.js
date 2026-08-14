'use strict'

// Where each repository came from, and whether this host can still reach it.
//
// Until now a repository was a folder with git in it and nothing said anything
// else about it. That was fine while they were local; it stopped being fine the
// moment they had somewhere to go, because the questions that decide whether a
// change can land are all about the far end: is the remote reachable, may this
// token push to it, and does what is here match what is there.
//
// NETWORK CALLS ARE NEVER ON A TIMER. The window redraws every three seconds, so
// anything it calls is on a timer -- a lesson this codebase has now paid for
// twice with git processes. Reaching GitHub on a timer would be the same fault
// with a worse constant: rate limits, latency measured in hundreds of
// milliseconds, and somebody else's service. So this file has two halves that
// never mix: `read()` is local and instant, and `check()` goes out, is asked for
// deliberately, and writes down what it found so nothing has to ask twice.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const serve = require('./serve')
const branches = require('./branches')
const workspaces = require('../core/workspaces')
const github = require('../core/github')

const FILE = () => path.join(workspaces.stateDir(), 'remotes.json')

const seen = () => {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')) || {} } catch { return {} }
}

const keep = all => {
  try { fs.mkdirSync(workspaces.stateDir(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(FILE(), JSON.stringify(all, null, 2)) } catch { /* the answer still stands for this call */ }
}

const git = (dir, args) => execFileSync('git', ['--git-dir', dir, ...args], {
  encoding: 'utf8', timeout: 30000, windowsHide: true
}).trim()

// THE SAME TRAP AS BEFORE, THROUGH A NEW DOOR. `read()` is called from a paint
// function, paint functions run every three seconds, and each read asked git
// nine times: a remote url, a head and a branch list per repository. A trace put
// spawn back up to 25% of the window's samples with nothing happening -- the
// third time this exact shape has cost something here.
//
// A second is the whole window, the same as branches.js: no single draw asks
// twice, and a remote changed underneath shows up before anybody has finished
// reading the sentence about it.
const brief = new Map()
const once1s = (key, make) => {
  const hit = brief.get(key)
  if (hit && Date.now() - hit.at < 1000) return hit.value
  const value = make()
  brief.set(key, { at: Date.now(), value })
  return value
}

// ---- what a remote URL says --------------------------------------------
//
// Both spellings, because both are ordinary and a repository cloned by ssh is
// the same repository as one cloned by https. What is wanted is the three facts
// underneath: which host, which owner, which name.
//
// A URL WITH A TOKEN IN IT is recognised and stripped rather than reported.
// Cloning with credentials embedded is a common habit and it puts a secret in a
// file this app reads and displays; showing it back would be this app leaking
// somebody else's mistake into a screenshot.
function parse (url) {
  if (!url) return null
  const clean = String(url).trim()

  // ssh: git@github.com:owner/name.git
  let m = clean.match(/^(?:ssh:\/\/)?(?:([^@]+)@)?([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?$/)
  if (/^https?:\/\//i.test(clean)) {
    // https://[anything@]host/owner/name[.git]
    m = clean.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/)
    if (!m) return { url: hide(clean), host: null, owner: null, repo: null, kind: 'unrecognised' }
    return { url: hide(clean), host: m[1], owner: m[2], repo: m[3], kind: kindOf(m[1]) }
  }
  if (!m) return { url: hide(clean), host: null, owner: null, repo: null, kind: 'unrecognised' }
  return { url: hide(clean), host: m[2], owner: m[3], repo: m[4], kind: kindOf(m[2]) }
}

const hide = url => String(url).replace(/\/\/[^@/]+@/, '//[redacted]@')
const kindOf = host => /(^|\.)github\.com$/i.test(host) ? 'github' : 'other'

function remoteOf (repo) {
  return once1s(`remote ${repo}`, () => {
    const dir = serve.gitDirOf(repo)
    if (!dir) return null
    try { return parse(git(dir, ['remote', 'get-url', 'origin'])) } catch { return null }
  })
}

// ---- the local half: instant, no network -------------------------------
function read () {
  const notes = seen()
  return serve.list().map(({ name }) => {
    const dir = serve.gitDirOf(name)
    const remote = remoteOf(name)
    const home = branches.defaultOf(name)
    const head = once1s(`head ${name} ${home}`, () => {
      try { return home ? git(dir, ['rev-parse', home]) : null } catch { return null }
    })

    const note = notes[name] || {}
    return {
      repo: name,
      dir,
      path: path.join(serve.DIR, name),
      default: home,
      head,
      branches: (() => { try { return branches.branchesIn(dir).length } catch { return 0 } })(),
      remote,
      // Everything below came from the last time somebody asked GitHub. It is
      // shown with WHEN, because a fact about a remote is only as true as the
      // moment it was read, and this one can be hours old.
      checked: note.checked || null,
      reachable: note.reachable == null ? null : note.reachable,
      why: note.why || null,
      may: note.may || null,
      accountMay: note.accountMay || null,
      parent: note.parent || null,
      source: note.source || null,
      chained: !!note.chained,
      intoParent: note.intoParent || null,
      intoSource: note.intoSource || null,
      branchesThere: note.branchesThere || null,
      privateRepo: note.privateRepo == null ? null : note.privateRepo,
      fork: note.fork == null ? null : note.fork,
      upstreamDefault: note.upstreamDefault || null,
      upstreamHead: note.upstreamHead || null,
      // COUNTED FROM THE LIST THAT IS SHOWN, not from a separate query.
      // The check counted pull requests on the FORK and the list reads them from
      // the PARENT, which is where they actually are -- so the badge said 0
      // beside a pane showing one. Two places knowing the same thing and
      // disagreeing is the fault this window keeps finding; the list wins,
      // because the list is what somebody reads.
      openPulls: note.pulls ? note.pulls.filter(x => x.state === 'open').length : (note.openPulls == null ? null : note.openPulls),
      // Gathered on the same trip as the check, and null until somebody asks --
      // which is different from an empty list, and the panes say so.
      pulls: note.pulls || null,
      issues: note.issues || null,
      openIssues: note.issues ? note.issues.length : null,
      issuesOn: note.parent || null,
      gathered: note.gathered || null,
      // Computed here rather than stored, so it is right even when the local
      // branch moved after the last check.
      inStep: note.upstreamHead && head ? note.upstreamHead === head : null
    }
  })
}

// ---- the far half: asked for, never polled -----------------------------
//
// One repository at a time, so a workspace where three of four are reachable
// says exactly that rather than failing as a set. Each answer is written down
// under the repository's name.
async function check (only = null) {
  const notes = seen()
  const list = serve.list().map(r => r.name).filter(n => !only || n === only)
  const out = []

  for (const name of list) {
    const remote = remoteOf(name)
    const at = new Date().toISOString()

    if (!remote) {
      notes[name] = { checked: at, reachable: false, why: 'no remote called origin' }
      out.push({ repo: name, ...notes[name] })
      continue
    }
    if (remote.kind !== 'github') {
      notes[name] = { checked: at, reachable: null, why: `origin is ${remote.host || 'somewhere'}, which this cannot ask about — only github.com is understood so far` }
      out.push({ repo: name, remote, ...notes[name] })
      continue
    }

    try {
      const r = await github.call('GET', `/repos/${remote.owner}/${remote.repo}`)
      if (r.status === 404) {
        // A FINE-GRAINED TOKEN GRANTS PER REPOSITORY, so 404 here usually means
        // "not in this token's list" rather than "does not exist" — and saying
        // the first is what stops somebody hunting for a typo in the URL.
        notes[name] = { checked: at, reachable: false, why: 'GitHub says 404 — either it does not exist, or this token was not granted it' }
      } else if (r.status === 401 || r.status === 403) {
        notes[name] = { checked: at, reachable: false, why: (r.body && r.body.message) || `GitHub answered ${r.status}` }
      } else if (r.status !== 200) {
        notes[name] = { checked: at, reachable: false, why: (r.body && r.body.message) || `GitHub answered ${r.status}` }
      } else {
        const upstreamDefault = r.body.default_branch || null

        // WHAT THE TOKEN MAY DO IS PROBED, NOT READ OFF THE REPOSITORY.
        //
        // `permissions` on a repository object describes THE ACCOUNT, not the
        // token acting for it. A fine-grained token reports `push: true,
        // admin: true` there and is then refused with "Resource not accessible
        // by personal access token" the moment it asks for anything — which is
        // exactly what happened here on the first real check: full permissions
        // reported, branches refused, and a "may push" this app would have
        // believed right up until a push failed.
        //
        // So each capability is established by asking for the thing itself. It
        // costs two more requests, on an action nobody runs on a timer, and it
        // is the difference between describing an account and describing what
        // will actually work.
        const branchList = await github.call('GET', `/repos/${remote.owner}/${remote.repo}/branches?per_page=100`)
        const canReadCode = branchList.status === 200

        const pulls = await github.call('GET', `/repos/${remote.owner}/${remote.repo}/pulls?state=open&per_page=100`)
        const canReadPulls = pulls.status === 200
        const openPulls = canReadPulls && Array.isArray(pulls.body) ? pulls.body.length : null

        const upstreamHead = canReadCode && Array.isArray(branchList.body)
          ? (branchList.body.find(b => b.name === upstreamDefault) || {}).commit &&
            branchList.body.find(b => b.name === upstreamDefault).commit.sha
          : null

        // Named the way GitHub names them in the token's own settings page, so
        // the missing one can be found without translating.
        const missing = []
        if (!canReadCode) missing.push('Contents')
        if (!canReadPulls) missing.push('Pull requests')

        // WHERE A PULL REQUEST WOULD ACTUALLY GO.
        //
        // A fork is not a detail about a repository, it is the answer to that
        // question — a pull request from a fork is created IN THE PARENT, with
        // `head: owner:branch`. So a token scoped to the forks can push a branch
        // and still be unable to open anything, which is a failure that would
        // arrive at the last possible moment and look like a bug in this app.
        //
        // The parent is asked about separately and on its own terms: reachable
        // is one question, and may-open-a-pull-request-there is another.
        // A FORK OF A FORK MAKES THIS A CHOICE RATHER THAN A FACT.
        //
        // GitHub reports two: `parent` is ONE level up, `source` is the root of
        // the whole network. In A <- B <- C they are different and nothing
        // reports the middle of a longer chain at all.
        //
        // Which one a change should go to is a decision — up the chain one step,
        // the way a fork's owner sends work to the person they forked from, or
        // straight to the root, which GitHub also allows since any two
        // repositories in one network can open a pull request between them.
        // Both are offered and the immediate parent is the default, because it
        // is the one that matches how a chain is normally worked.
        const parent = r.body.parent ? r.body.parent.full_name : null
        const source = r.body.source ? r.body.source.full_name : null
        const chained = !!(parent && source && parent !== source)

        // Asked of each separately, because a token can be granted one and not
        // the other — and in a chain that is the ordinary case rather than an
        // unlucky one.
        const canOpenIn = async full => {
          if (!full) return null
          const [o, n] = full.split('/')
          const up = await github.call('GET', `/repos/${o}/${n}/pulls?state=open&per_page=1`)
          return {
            repo: full,
            mayOpen: up.status === 200,
            why: up.status === 200 ? null : (up.status === 404
              ? 'this token was not granted it, so a pull request cannot be opened there'
              : (up.body && up.body.message) || `GitHub answered ${up.status}`)
          }
        }

        const intoParent = parent ? { ...(await canOpenIn(parent)), defaultBranch: r.body.parent.default_branch || null } : null
        const intoSource = chained ? { ...(await canOpenIn(source)), defaultBranch: r.body.source.default_branch || null } : null

        if (intoParent && !intoParent.mayOpen && !(intoSource && intoSource.mayOpen)) {
          missing.push(`Pull requests on ${parent}`)
        }

        notes[name] = {
          checked: at,
          reachable: true,
          parent,
          source,
          chained,
          intoParent,
          intoSource,
          why: missing.length
            ? `the token cannot use ${missing.join(' or ')} here — add ${missing.length === 1 ? 'that permission' : 'those permissions'} to it on GitHub`
            : null,
          may: { code: canReadCode, pulls: canReadPulls },
          // Kept and clearly labelled, because it is a true fact about a
          // different subject and somebody will otherwise read it as the token's.
          accountMay: (() => {
            const p = r.body.permissions || {}
            return { read: p.pull !== false, push: !!p.push, admin: !!p.admin }
          })(),
          privateRepo: !!r.body.private,
          fork: !!r.body.fork,
          upstreamDefault,
          upstreamHead: upstreamHead || null,
          openPulls,
          branchesThere: canReadCode && Array.isArray(branchList.body) ? branchList.body.map(b => b.name) : null
        }
      }
    } catch (e) {
      notes[name] = { checked: at, reachable: false, why: e.message }
    }
    out.push({ repo: name, remote, ...notes[name] })
  }

  keep(notes)
  return out
}

// ---- pushing a branch onward -------------------------------------------
//
// The one thing in this app that writes to somewhere it does not own. It is
// done from THIS HOST and never from a machine: a runner pushes to the
// dashboard's own git server, the host pushes onward, and no runner is ever
// handed a token it could take to a snapshot.
//
// THE TOKEN IS NEVER AN ARGUMENT. See tools/git-credential-okc.js — it arrives
// through the environment of the child process and leaves with it, rather than
// in the URL (which lands in .git/config and in every error git prints) or in
// `-c http.extraheader` (which any process running as this user can read out of
// the process list).
function pushBranch (repo, branch) {
  const at = path.join(serve.DIR, repo)
  const helper = path.join(__dirname, '..', 'tools', 'git-credential-okc.js')

  const said = execFileSync('git', [
    '-C', at,
    // The helper replaces whatever is configured, so a credential manager on
    // this machine cannot answer instead with somebody else's account.
    '-c', 'credential.helper=',
    '-c', `credential.helper=!node "${helper.split('\\').join('/')}"`,
    'push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`
  ], {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    env: {
      ...process.env,
      OKC_GIT_USER: 'x-access-token',
      OKC_GIT_TOKEN: github.tokenForPush(),
      // Never let git stop and ask a person who is not there. Without this a
      // wrong credential hangs the call until it times out.
      GIT_TERMINAL_PROMPT: '0'
    }
  })
  return String(said || '').trim()
}

// ---- opening a pull request --------------------------------------------
//
// IN THE PARENT, WHEN THERE IS ONE. A pull request from a fork is created in the
// repository being merged INTO, with the head written `owner:branch`. Getting
// this wrong does not fail loudly — it opens a pull request inside the fork,
// from the fork's branch into the fork's own default, which looks perfectly
// normal and lands the work nowhere anybody is watching.
async function openPull (repo, { branch, base, title, body, into = null }) {
  const remote = remoteOf(repo)
  if (!remote || remote.kind !== 'github') throw new Error(`"${repo}" has no GitHub remote to open a pull request on.`)

  const note = seen()[repo] || {}
  // Given, or the immediate parent, or itself. A fork of a fork of a fork makes
  // this a choice and not a fact — see `check`, which reports both the parent
  // one level up and the root of the network.
  const target = into || note.parent || `${remote.owner}/${remote.repo}`
  const [owner, name] = target.split('/')
  const crossing = target !== `${remote.owner}/${remote.repo}`
  const head = crossing ? `${remote.owner}:${branch}` : branch

  const r = await github.call('POST', `/repos/${owner}/${name}/pulls`, {
    title,
    body,
    head,
    base,
    // NAMED EXPLICITLY, because `owner:branch` stops being unique in a chain.
    // One account can own several repositories in the same fork network, and
    // then `owner:branch` describes more than one branch — GitHub resolves it
    // however it resolves it, which is not a thing to leave to chance when the
    // consequence is a change landing in the wrong repository. `head_repo`
    // removes the question.
    ...(crossing ? { head_repo: `${remote.owner}/${remote.repo}` } : {})
  })

  if (r.status === 201) {
    return {
      repo,
      opened: true,
      number: r.body.number,
      url: r.body.html_url,
      state: r.body.state,
      into: target,
      head,
      base
    }
  }

  // GitHub answers 422 for "already exists" and for "no commits between", and
  // they mean opposite things: one is done, the other is nothing to do. Both are
  // reported as themselves rather than as a failure to open.
  const said = (r.body && r.body.errors && r.body.errors.map(e => e.message).filter(Boolean).join('; ')) ||
    (r.body && r.body.message) || `GitHub answered ${r.status}`
  const already = /already exists/i.test(said)
  return { repo, opened: false, already, why: said, into: target, head, base }
}

// CHANGING ONE OF THEM, which is the point of holding N as one.
//
// A pull request cut across three repositories is one piece of work with three
// descriptions of it, and keeping those three in step by hand is the thing
// nobody does — so the second repository ends up with last week's title and a
// reviewer reads a different story depending on which one they opened.
//
// `state` is here too, because closing a change means closing all of it. Closing
// two of three leaves a change that is neither in nor withdrawn, and the one
// still open is the one somebody merges by accident a month later.
async function updatePull (repo, number, fields) {
  const note = seen()[repo] || {}
  const remote = remoteOf(repo)
  if (!remote) throw new Error(`"${repo}" has no remote.`)
  const into = note.parent ? note.parent.split('/') : [remote.owner, remote.repo]

  const r = await github.call('PATCH', `/repos/${into[0]}/${into[1]}/pulls/${number}`, fields)
  if (r.status === 200) return { repo, number, ok: true, state: r.body.state, url: r.body.html_url }
  return { repo, number, ok: false, why: (r.body && r.body.message) || `GitHub answered ${r.status}` }
}

// Everything open on a repository right now, so a landing can be re-read rather
// than remembered. What GitHub says about a pull request outranks what was
// written down here when it was opened.
async function pullsOn (repo) {
  const note = seen()[repo] || {}
  const remote = remoteOf(repo)
  if (!remote) return []
  const into = note.parent ? note.parent.split('/') : [remote.owner, remote.repo]
  const r = await github.call('GET', `/repos/${into[0]}/${into[1]}/pulls?state=all&per_page=100`)
  if (r.status !== 200 || !Array.isArray(r.body)) return []
  return r.body.map(p => ({
    number: p.number,
    url: p.html_url,
    state: p.state,
    merged: !!p.merged_at,
    draft: !!p.draft,
    title: p.title,
    head: p.head && p.head.label,
    base: p.base && p.base.ref
  }))
}

// What is being ASKED of a repository, as opposed to what is waiting to go into
// it. Issues are the one thing in this app that arrives from outside: everything
// else begins with somebody writing a task, and an issue is work that turned up.
//
// ON THE SAME REPOSITORY A PULL REQUEST WOULD GO TO, because that is where a
// conversation about the project happens. A fork's own issue tracker is usually
// empty and usually disabled, and listing it would be a column of nothing beside
// a parent full of work.
//
// GITHUB'S ISSUES ENDPOINT RETURNS PULL REQUESTS TOO — a pull request IS an
// issue there, with an extra field. Left unfiltered, every pull request would
// appear in both lists and every count would be wrong in the same direction.
async function issuesOn (repo) {
  const note = seen()[repo] || {}
  const remote = remoteOf(repo)
  if (!remote) return []
  const into = note.parent ? note.parent.split('/') : [remote.owner, remote.repo]
  const r = await github.call('GET', `/repos/${into[0]}/${into[1]}/issues?state=open&per_page=100`)
  if (r.status !== 200 || !Array.isArray(r.body)) return []
  return r.body
    .filter(i => !i.pull_request)
    .map(i => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      state: i.state,
      by: i.user && i.user.login,
      at: i.created_at,
      updated: i.updated_at,
      comments: i.comments,
      labels: (i.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
      on: `${into[0]}/${into[1]}`,
      body: i.body || null
    }))
}

// Everything asked for in one go, and written down. One button, because
// "reachable", "what is open" and "what is being asked" are the same trip.
async function gather (only = null) {
  const rows = await check(only)
  const notes = seen()

  for (const row of rows) {
    if (row.reachable !== true) continue
    try {
      notes[row.repo] = { ...notes[row.repo], pulls: await pullsOn(row.repo), issues: await issuesOn(row.repo), gathered: new Date().toISOString() }
    } catch (e) {
      notes[row.repo] = { ...notes[row.repo], gatherWhy: e.message }
    }
  }
  keep(notes)
  return rows
}

module.exports = { read, check, gather, remoteOf, parse, pushBranch, openPull, updatePull, pullsOn, issuesOn }
