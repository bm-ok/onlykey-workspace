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
async function openPull (repo, { branch, base, title, body, into = null, draft = false }) {
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
    ...(draft ? { draft: true } : {}),
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

// MERGING IT, which until now was the one step of the flow that had to happen in
// a browser.
//
// The gap showed up the moment the order was written down as something that
// runs: cut a branch, work on it, open a pull request — and then a person, a
// tab, and a green button, after which this app is looking at a fork that is
// behind and cannot say why.
//
// ON THE PARENT, like everything else about a pull request here. The branch is
// on the fork; the pull request, its reviews and its merge are on the repository
// it was opened against.
//
// The method is asked for rather than assumed. A squash rewrites the commits,
// which is what makes `git cherry` the right question afterwards and what makes
// a fork look diverged from a change it already carries — worth choosing on
// purpose rather than discovering.
async function mergePull (repo, number, { how = 'merge', title = null, message = null } = {}) {
  const note = seen()[repo] || {}
  const remote = remoteOf(repo)
  if (!remote) throw new Error(`"${repo}" has no remote.`)
  const into = note.parent ? note.parent.split('/') : [remote.owner, remote.repo]

  const r = await github.call('PUT', `/repos/${into[0]}/${into[1]}/pulls/${number}/merge`, {
    merge_method: how,
    ...(title ? { commit_title: title } : {}),
    ...(message ? { commit_message: message } : {})
  })
  if (r.status === 200) {
    return { repo, number, merged: true, sha: r.body && r.body.sha, into: into.join('/'), how }
  }
  // 405 is "not mergeable" — a conflict, a required check, a protected branch —
  // and 409 is "the head moved since you looked". Both are answers about the
  // pull request rather than failures to ask, and both are said as themselves.
  const why = (r.body && r.body.message) || `GitHub answered ${r.status}`
  return { repo, number, merged: false, status: r.status, why, into: into.join('/') }
}

// DELETING IT FROM THE FORK, which is the button GitHub offers the moment a
// pull request is merged and which this app has never had.
//
// The branch on the fork is what the pull request was opened FROM. Once it is
// merged the branch has done its work, and leaving it is how a fork accumulates
// a page of branches that are all in master already — `drillSweep` reports them
// and deliberately does not remove them, because a push is not a tidy-up.
//
// On the FORK, not the parent: that is where the branch is.
async function deleteBranch (repo, branch) {
  const remote = remoteOf(repo)
  if (!remote || remote.kind !== 'github') throw new Error(`"${repo}" has no GitHub remote.`)
  const r = await github.call('DELETE', `/repos/${remote.owner}/${remote.repo}/git/refs/heads/${branch}`)
  // 204 is gone, 422 is "it was not there" — which is the same state and not a
  // failure to report as one.
  if (r.status === 204) {
    // AND THE MIRROR OF IT HERE, in the same act.
    //
    // `refs/remotes/origin/<branch>` is this host's copy of what the fork has.
    // Deleting the branch there and leaving the copy is a second opinion about
    // the same fact, and every panel that reads "where origin has it" believes
    // the copy — which is how a drill that had cleaned up after itself was
    // reported as having left something behind.
    try {
      const dir = serve.gitDirOf(repo)
      if (dir) git(dir, ['update-ref', '-d', `refs/remotes/origin/${branch}`])
    } catch { /* there was no mirror of it here, which is the state wanted */ }
    return { repo, branch, gone: true, on: `${remote.owner}/${remote.repo}` }
  }
  if (r.status === 422 || r.status === 404) return { repo, branch, gone: false, already: true, on: `${remote.owner}/${remote.repo}` }
  throw new Error(`Could not delete "${branch}" on ${remote.owner}/${remote.repo}: ${(r.body && r.body.message) || `GitHub answered ${r.status}`}`)
}

// SYNC FORK, the button on the fork's front page.
//
// The other half of the same gap. After a pull request is merged the parent has
// moved and the fork has not, so every branch cut here starts from something out
// of date and every comparison reads as diverged — which is exactly the state
// somebody described as "a PR does something weird that I do not understand".
//
// GitHub calls it merge-upstream: it pulls the parent's branch into the fork's
// branch of the same name, on GitHub, without a clone. The local repository is a
// separate matter — `syncDefault` fetches and fast-forwards this host afterwards.
//
// Only the fork can do this, so it goes to the ORIGIN rather than to the parent.
async function syncFork (repo, branch = null) {
  const remote = remoteOf(repo)
  if (!remote || remote.kind !== 'github') throw new Error(`"${repo}" has no GitHub remote to sync.`)
  const note = seen()[repo] || {}
  if (!note.parent) throw new Error(`"${repo}" is not a fork of anything this app knows about, so there is nothing upstream to pull from.`)

  const want = branch || note.default || branches.defaultOf(repo)
  if (!want) throw new Error(`Nothing says which branch of "${repo}" to sync.`)

  const r = await github.call('POST', `/repos/${remote.owner}/${remote.repo}/merge-upstream`, { branch: want })
  if (r.status === 200) {
    return {
      repo,
      branch: want,
      from: note.parent,
      // GitHub says which of three happened: fast-forward, merge, or none.
      // "none" is not a failure — it is a fork that was already up to date, and
      // reporting it as an error would make the ordinary case look wrong.
      how: (r.body && r.body.merge_type) || 'none',
      already: !!(r.body && r.body.merge_type === 'none'),
      said: (r.body && r.body.message) || null
    }
  }
  // 409 is a conflict the fork cannot resolve on its own, and 422 is a branch
  // GitHub will not merge into. Said as itself, because both need a person and
  // neither is this app being wrong.
  const why = (r.body && r.body.message) || `GitHub answered ${r.status}`
  throw new Error(`Could not sync "${repo}" from ${note.parent}: ${why}`)
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
    base: p.base && p.base.ref,

    // WHOSE CODE, AND WHICH COMMIT. GitHub sends all three of these and this
    // dropped them, which was fine while every pull request here was one this
    // host had cut. It stops being fine the moment one ARRIVES: deciding
    // whether a judge may read somebody else's change needs to know whose it
    // is, and an allowance to read it has to name the commit or it carries
    // silently onto whatever the author pushes next. See repos/allowed.js.
    by: p.user && p.user.login,
    headRepo: p.head && p.head.repo && p.head.repo.full_name,
    headSha: p.head && p.head.sha,
    // GitHub's own word for how close the author is to the repository: OWNER,
    // MEMBER, COLLABORATOR, CONTRIBUTOR, NONE. Carried and never interpreted --
    // "is this person trusted" is not a question this app should answer, and
    // the answer it could give is somebody's permissions rather than their
    // intentions.
    association: p.author_association || null
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

// ---- issues, a page at a time ---------------------------------------------
//
// `issuesOn` above asks for one hundred and takes what comes, which is right for
// the overview it feeds: a count and a handful of rows beside each repository.
// It is wrong for reading an issue tracker. A busy repository has thousands —
// anthropics/claude-code has over five — and one hundred of them, silently, is
// worse than a refusal: it reads as the whole list, and anything deciding from
// it is deciding from the first page of a list it does not know is longer.
//
// So this is the same request, paged, and it says where it is: which page, how
// many pages there are, and whether there is another. GitHub does not return a
// total for this endpoint, and it does not have to — the Link header names the
// last page, which is the answer to the question anybody actually has.
//
// WHERE THE ISSUES LIVE is the same rule as everywhere else here: a fork's own
// tracker is usually empty and usually disabled, so it asks the PARENT, which is
// where a conversation about the project happens. `on` names any repository
// instead, for reading a tracker this workspace does not hold.

// THE LINK HEADER, WHICH IS HOW GITHUB SAYS "THERE IS MORE" — and on this
// endpoint it no longer says how much more.
//
// It used to answer with rel="next" AND rel="last", and the number in the last
// one was the page count. GitHub has moved big trackers to CURSOR paging, and
// what comes back for anthropics/claude-code is only:
//
//   <https://api.github.com/repositories/937253475/issues?...&page=2&after=Y3Vyc29yOnYy...>; rel="next"
//
// No last, so there is no page count to report. The first version of this
// invented one — it reported "Page 1 of 1" beside a next page, which is a
// sentence that is wrong twice. What it says now is what is true: this is page
// one, there is another, and nobody knows how many.
//
// THE CURSOR IS CARRIED AS AN OPAQUE STRING. It is GitHub's, it means nothing
// here, and it is handed back exactly as it arrived — which is the only way to
// walk a tracker whose pages are not numbered.
const paramIn = (url, key) => {
  try { return new URL(String(url)).searchParams.get(key) } catch { return null }
}
function paging (link, page) {
  let next = null
  let last = null
  for (const part of String(link || '').split(',')) {
    const m = /<([^>]+)>;\s*rel="(\w+)"/.exec(part)
    if (!m) continue
    if (m[2] === 'next') next = m[1]
    if (m[2] === 'last') last = m[1]
  }
  const lastPage = last ? Number(paramIn(last, 'page')) || null : null
  return {
    page,
    more: !!next,
    // What to pass back to get the next one, in whichever way this repository is
    // paged. A caller hands back whichever it was given; both are accepted.
    nextPage: next ? Number(paramIn(next, 'page')) || null : null,
    nextAfter: next ? paramIn(next, 'after') : null,
    // Null rather than a guess. "How many pages" has no answer on a cursor-paged
    // tracker, and saying so is the difference between a list that is short and a
    // list that is truncated.
    pages: lastPage
  }
}

const oneIssue = (i, where) => ({
  number: i.number,
  title: i.title,
  url: i.html_url,
  state: i.state,
  by: i.user && i.user.login,
  at: i.created_at,
  updated: i.updated_at,
  comments: i.comments,
  labels: (i.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
  on: where,
  body: i.body || null
})

const onePull = (p, where) => ({
  number: p.number,
  title: p.title,
  url: p.html_url,
  state: p.state,
  merged: !!p.merged_at,
  draft: !!p.draft,
  by: p.user && p.user.login,
  at: p.created_at,
  updated: p.updated_at,
  head: p.head && p.head.label,
  base: p.base && p.base.ref,
  labels: (p.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
  on: where
})

const asOwnerRepo = where => {
  const at = String(where || '').split('/')
  if (at.length !== 2 || !at[0] || !at[1]) throw new Error(`"${where}" is not a repository — it is written owner/name.`)
  return at
}

// One paged read, for the two lists that get long. Issues and pull requests are
// different endpoints with the same problem: a busy repository has thousands of
// one and hundreds of the other, and a hundred of five thousand is not a short
// list, it is a wrong one.
async function pageOf (kind, where, { state = 'open', page = 1, after = null, perPage = 30, labels = null, sort = null, since = null } = {}) {
  const at = asOwnerRepo(where)

  // Bounded here rather than passed on: GitHub's own limit is 100, and a caller
  // asking for a thousand should be told what it got rather than quietly handed
  // a hundred.
  const want = Math.max(1, Math.min(100, Number(perPage) || 30))
  const which = Math.max(1, Number(page) || 1)

  const q = new URLSearchParams({
    state: ['open', 'closed', 'all'].includes(state) ? state : 'open',
    per_page: String(want),
    page: String(which)
  })
  // The cursor wins where there is one: it is what a cursor-paged tracker
  // answers with, and page numbers on one of those go nowhere useful.
  //
  // And the page number goes with it. GitHub takes both and honours the cursor,
  // so a second page fetched by cursor came back saying "page 1" — a number that
  // is true about the request and false about the answer. A walk by cursor has
  // no page numbers at all, and reporting none is the honest version.
  if (after) { q.set('after', String(after)); q.delete('page') }
  if (labels && kind === 'issues') q.set('labels', String(labels))
  if (sort) q.set('sort', String(sort))
  if (since && kind === 'issues') q.set('since', String(since))

  const r = await github.call('GET', `/repos/${at[0]}/${at[1]}/${kind}?${q}`)
  if (r.status === 404) throw new Error(`GitHub has no repository called "${where}", or this host's token cannot see it.`)
  if (r.status !== 200 || !Array.isArray(r.body)) {
    throw new Error(`GitHub answered ${r.status} for the ${kind} on "${where}"${r.body && r.body.message ? ` — ${r.body.message}` : ''}`)
  }

  const on = `${at[0]}/${at[1]}`
  // A PULL REQUEST IS AN ISSUE ON GITHUB, with an extra field, so the issues
  // endpoint returns both. Left unfiltered every pull request appears here as
  // well as in the pull request list, and every count is wrong the same way.
  //
  // Filtered AFTER the page is taken, which is why what was asked for and what
  // was dropped are both reported: a page of thirty can come back as twenty-two
  // issues and eight pull requests, and pretending otherwise would make the
  // paging lie.
  const rows = kind === 'issues'
    ? r.body.filter(i => !i.pull_request).map(i => oneIssue(i, on))
    : r.body.map(p => onePull(p, on))

  return {
    on,
    state,
    [kind]: rows,
    asked: want,
    dropped: kind === 'issues' ? r.body.length - rows.length : 0,
    // Which cursor this page came after, so a caller that lost track can see
    // where it is. Null on the first page, which is the only page with a number.
    after: after ? String(after) : null,
    ...paging(r.headers && r.headers.link, after ? null : which)
  }
}

const issuePage = (where, opts) => pageOf('issues', where, opts)
const pullPage = (where, opts) => pageOf('pulls', where, opts)

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

// ---- bringing the default branches back -------------------------------
//
// The other direction, and the only one this app has ever had. It pushes a line
// onward and opens pull requests; what it could not do is take the answer back.
// So after the pull requests are merged and the fork is synced, every default
// branch here is behind, and stays behind — a branch cut afterwards is cut from
// a stale point, silently, and the first sign is a diff full of somebody else's
// commits.
//
// FAST-FORWARD ONLY, EVERYWHERE. Never a merge, never a reset. If a default
// branch here has commits the remote does not, that is a real thing that
// happened and this is not the place to decide what to do about it — it is
// reported and skipped. The whole point of the button is that it can be pressed
// without reading anything first.
//
// TWO SHAPES, because a repository here is either a working tree or bare, and
// git treats the branch that HEAD points at differently:
//
//   not checked out   git fetch origin b:b   — refuses a non-fast-forward
//                                              itself, which is what we want
//   checked out       fetch, then merge --ff-only in the tree, because git will
//                     not fetch into the branch you are standing on
//
// A dirty working tree is left alone and said out loud. Somebody's uncommitted
// work is not something a sync button gets to have an opinion about.
// ONE BRANCH, and `syncDefault` is this with the branch filled in. Written as
// the general thing because the panel that lists a repository's branches wants
// to move any one of them, and two copies of "fetch and fast-forward" would be
// two places for the refusals to stop matching.
function syncBranch (repo, branch) {
  const at = path.join(serve.DIR, repo)
  const helper = path.join(__dirname, '..', 'tools', 'git-credential-okc.js')

  // The same credential path as pushing, and for the same reasons — see the note
  // above pushBranch. A public repository needs none of it and is unharmed by
  // it; a private one cannot be fetched without it.
  let token = null
  try { token = github.tokenForPush() } catch { /* public remotes still work */ }

  const run = args => execFileSync('git', [
    '-C', at,
    '-c', 'credential.helper=',
    '-c', `credential.helper=!node "${helper.split('\\').join('/')}"`,
    ...args
  ], {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    env: {
      ...process.env,
      ...(token ? { OKC_GIT_USER: 'x-access-token', OKC_GIT_TOKEN: token } : {}),
      GIT_TERMINAL_PROMPT: '0'
    }
  })

  if (!branch) return { repo, moved: false, why: 'no branch was named' }

  const before = String(run(['rev-parse', branch])).trim()
  // PRUNED, because a branch deleted on origin is otherwise still here for ever.
  //
  // A fetch adds and never removes: delete a branch on the fork — which is what
  // GitHub offers the moment a pull request is merged, and what
  // `branchDeleteRemote` does — and this host keeps `refs/remotes/origin/<it>`
  // with nothing behind it. Every panel that reads "where origin has it" then
  // reports a branch that is gone, and the one place it showed was the sweeper
  // saying a drill had left something behind after the drill had removed it.
  run(['fetch', '--quiet', '--prune', 'origin'])
  const onto = String(run(['rev-parse', `refs/remotes/origin/${branch}`])).trim()

  if (before === onto) return { repo, branch, moved: false, why: 'already up to date' }

  // Behind is fast-forwardable; anything else is a divergence and is not this
  // button's business. `merge-base --is-ancestor` answers exactly that.
  try {
    run(['merge-base', '--is-ancestor', before, onto])
  } catch {
    return { repo, branch, moved: false, why: `"${branch}" here has commits origin does not — this only fast-forwards, so it was left alone` }
  }

  const head = String(run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (head === branch) {
    // Standing on it. Refuse rather than stash: uncommitted work belongs to
    // whoever left it there.
    const dirty = String(run(['status', '--porcelain'])).trim()
    if (dirty) return { repo, branch, moved: false, why: `"${branch}" is checked out here with uncommitted changes — left alone` }
    run(['merge', '--ff-only', `refs/remotes/origin/${branch}`])
  } else {
    run(['fetch', 'origin', `${branch}:${branch}`])
  }

  const after = String(run(['rev-parse', branch])).trim()
  const count = Number(String(run(['rev-list', '--count', `${before}..${after}`])).trim()) || 0
  return { repo, branch, moved: after !== before, commits: count, from: before.slice(0, 7), to: after.slice(0, 7) }
}

// The default branch is the common case and has its own name, because "sync the
// repositories" means this and a caller should not have to look the branch up.
const syncDefault = repo => {
  const branch = branches.defaultOf(repo)
  if (!branch) return { repo, moved: false, why: 'no default branch could be read' }
  return syncBranch(repo, branch)
}

module.exports = { read, check, gather, remoteOf, parse, pushBranch, syncBranch, syncDefault, openPull, updatePull, mergePull, syncFork, deleteBranch, pullsOn, issuesOn, issuePage, pullPage }
