'use strict'

// Everything the action files are built out of.
//
// Nine files would otherwise repeat one block of thirty requires, and the day
// somebody adds a module they would add it to whichever file they were in. This
// is that block, once, and each group file destructures what it needs.
//
// It is deliberately NOT a place for logic. The helpers below are here because
// entries in more than one group call them; anything used by one group belongs
// in that group's file.

const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')

const log = require('../core/log')
const keys = require('../core/keys')
const ssh = require('../core/ssh')
const data = require('../core/data')
const secret = require('../core/secret')
const github = require('../core/github')
const remotes = require('../repos/remotes')
const landings = require('../repos/landings')
const judgements = require('../repos/judgements')
const prtemplate = require('../repos/prtemplate')
const drafts = require('../repos/drafts')
const vbox = require('../machines/vbox')
const vms = require('../machines/vms')
const provisioner = require('../machines/provisioner')
const scripts = require('../machines/scripts')
const channel = require('../machines/channel')
const tasks = require('../tasks/store')
const artifact = require('../tasks/artifact')
const prompts = require('../tasks/prompts')
const jobs = require('../tasks/jobs')
const contracts = require('../tasks/contracts')
const sessions = require('../tasks/sessions')
const jobrun = require('../tasks/jobrun')
const archive = require('../tasks/archive')
const files = require('../tasks/files')
const workspaces = require('../core/workspaces')

// Everything that ties a machine, or work in flight, to the workspace being
// served right now.
//
// One list, used twice: to refuse a switch, and to say why a switch would be
// refused before anybody tries. Those must be the same list or the window offers
// something the action turns down.
function inTheWay () {
  const out = []
  for (const vm of vms.read()) {
    if (vm.borrowed) out.push({ what: vm.name, why: `${vm.name} is borrowed — ${vm.borrowed.why || 'somebody is using it'}` })
    else if (vm.branch) out.push({ what: vm.name, why: `${vm.name} is set up on "${vm.branch}"` })
  }
  for (const task of tasks.read()) {
    if (task.state === 'given') out.push({ what: task.id, why: `#${task.number} is out on ${task.machine || 'a machine'}` })
  }
  return out
}
const queue = require('../tasks/queue')
const machines = require('../machines/store')
const { provision, reach } = require('../machines/provision')
const editor = require('../machines/editor')
const repos = require('../repos/serve')
const busy = require('../machines/busy')
const session = require('../machines/session')
const dispatch = require('../machines/dispatch')
const auth = require('../machines/auth')
const branches = require('../repos/branches')
const workspace = require('../repos/workspace')


// The port we actually ended up on. A guest is told to fetch its scripts from
// here, so this has to be what is really listening rather than a default.

// The one thing served without encryption, on a port of its own.
//
// It has to be. A machine being built has nothing yet -- no certificate, no
// authority, nothing to check anything against -- so the very first fetch cannot
// be verified by any means it already holds. What it CAN hold is a fingerprint,
// passed on the installer's command line, which is short and not a secret.
//
// So this serves exactly one thing: the authority's certificate, which is public
// by design. Everything with anything at stake in it -- the machine's token, its
// scripts, its repositories -- is on the encrypted port, fetched only once the
// authority has been checked against that fingerprint.

// THE PORTS THIS SERVER ACTUALLY ENDED UP ON, in an object rather than as two
// values.
//
// A guest is told where to fetch its scripts from, so this has to be what is
// really listening rather than what was asked for -- and it is not known until
// `start` has bound. Destructured at load time it would be captured before that
// and every machine would be sent to the default, which is right until the day
// it is not and then is wrong in a way nobody can see from here.
const net = {
  port: Number(process.env.PORT || 7373),
  channelPort: Number(process.env.OKC_CHANNEL_PORT || 7374),
  // The one thing served without encryption, on a port of its own. See start().
  caPort: Number(process.env.OKC_CA_PORT || 7375)
}

const started = new Date().toISOString()

// The window's own mutable bits, in one object so the actions that read them and
// the ones that write them are looking at the same thing across files: the
// pending photograph, how long a loading state is held, and the function the
// window hands back so it can photograph itself on demand.
const win = { wantedShot: null, slowMs: 0, capture: null, quit: null }

async function refuseIfThatTitleIsTaken (name, title) {
  const wanted = String(title || '').trim().toLowerCase()
  const { snapshots = [] } = await vbox.snapshots(name)
  const flat = []
  const walk = list => list.forEach(s => { flat.push(s.name); if (s.children) walk(s.children) })
  walk(snapshots)
  if (flat.some(s => String(s).trim().toLowerCase() === wanted)) {
    throw new Error(`"${name}" already has a snapshot called "${title}". VirtualBox would allow a second one, and then restoring by that name is a coin toss between them — pick another name, or throw the old one away first with vmSnapshotDelete.`)
  }
}

function refuseIfItHoldsACredential (name) {
  const vm = vms.read().find(v => v.name === name)
  if (vm && vm.holdsCredential) {
    throw new Error(`"${name}" is holding a worker credential, and a snapshot would keep a copy of it for as long as the snapshot exists. Take it back first: vmCredentialsForget --name ${name}`)
  }
}

// A path that is meant to be on the guest, checked for having been eaten on the
// way here.
//
// Git Bash rewrites anything shaped like an absolute unix path in a command
// line into a Windows one, so `--folder /home/okc/work` arrives as
// `C:/Program Files/Git/home/okc/work`. Nothing rejects it: the machine simply
// cannot find that directory, falls back to the home folder, and the work
// happens somewhere nobody asked for -- silently, and looking like success.
//
// Caught here rather than fixed here, because guessing what was meant is how a
// task lands in a third wrong place. `MSYS_NO_PATHCONV=1` or a leading `//` stops
// the shell doing it.
function guestPath (p, what) {
  if (!p) return p
  if (/^[A-Za-z]:[\\/]/.test(p) || p.includes('\\')) {
    throw new Error(`"${p}" is a path on this host, not on the machine. If you are in Git Bash it rewrote ${what} on the way here; run it as MSYS_NO_PATHCONV=1 okc.js ... or write the path with two leading slashes.`)
  }
  return p
}

// WHERE THE WORK IS, on the machine, as an absolute path.
//
// Lifted out of vmEditor because a second door now needs the same answer. The
// folder can be written `$HOME/workspace` -- that is what the script that makes
// it calls it -- and an editor needs a real path to open, a terminal needs one
// to `cd` into, and the two must not be allowed to disagree about which folder a
// task is being worked in.
//
// The expansion is done here in JS rather than by echoing the folder through a
// shell on the machine, because a folder can be typed into a dialog and
// interpolating that into a remote command is how a text field becomes a way to
// run things.
//
// Short timeout, because everything calling this is a button somebody is waiting
// on. The channel's own default is measured in half hours, which is right for a
// setup script and wrong for a person looking at nothing.
async function workFolder (name, where) {
  const vm = vms.get(name)
  const home = (await channel.run(name, 'printf "%s\\n" "$HOME"', { what: 'where its home is', timeout: 15000 }))
    .output.trim().split('\n').pop().trim()
  const folder = where || (vm.spec && vm.spec.folder) || workspace.FOLDER
  return folder.replace(/^\$HOME\b/, home).replace(/^~(?=\/|$)/, home)
}

// HOW LONG A STORED WORKER CREDENTIAL HAS LEFT, without using it.
//
// TWO CLOCKS, and confusing them is the whole difficulty.
//
//   the access token   short-lived, hours. EXPIRED IS ITS NORMAL STATE — Claude
//                      Code refreshes it whenever it needs to, so an expired one
//                      says nothing at all about whether the credential works.
//   the refresh token  weeks. This is the one that matters: when it goes, the
//                      credential is dead and only a person at a sign-in page
//                      can replace it.
//
// SO A CLOCK IS NOT PROOF, IN ONE DIRECTION ONLY. Expired refresh token means
// definitely dead — worth refusing on, because nothing can recover it. Unexpired
// means "no reason to think it is broken", which is weaker than it looks: an
// OAuth refresh ROTATES the refresh token, so a credential grabbed from a machine
// that has refreshed since is holding a superseded one. It reads as valid for
// weeks and fails immediately. That is exactly what this host has: a refresh
// token dated four weeks out, and a worker answering "OAuth session expired and
// could not be refreshed".
//
// Hence `usable` is true/false/null and not a boolean: false is knowledge, true
// is only the absence of one kind of bad news, and the definitive answer comes
// from a machine trying it.
function credentialLife (file) {
  let oauth = null
  try {
    const parsed = JSON.parse(secret.read(file).toString('utf8'))
    oauth = parsed.claudeAiOauth || parsed
  } catch {
    return { readable: false, why: 'the stored credential could not be read or is not the shape this knows' }
  }

  const at = Number(oauth.expiresAt) || null
  const refresh = Number(oauth.refreshTokenExpiresAt) || null
  const now = Date.now()

  return {
    readable: true,
    // Non-secret facts about the account, useful for telling two apart.
    plan: oauth.subscriptionType || null,
    scopes: Array.isArray(oauth.scopes) ? oauth.scopes.length : null,
    access: at ? { at: new Date(at).toISOString(), left: at - now, expired: at <= now } : null,
    refresh: refresh ? { at: new Date(refresh).toISOString(), left: refresh - now, expired: refresh <= now } : null,
    // The only certain answer available from a clock.
    usable: refresh ? (refresh > now ? null : false) : null,
    why: !refresh
      ? 'it does not say when its refresh token expires, so nothing can be told from here'
      : refresh <= now
        ? 'its refresh token has expired — this credential cannot be recovered, only replaced'
        : 'its refresh token has not expired, which is not the same as it working: a refresh rotates the token, so one grabbed from a machine that refreshed since is already superseded'
  }
}

// The last time a machine actually tried the stored credential, kept beside it.
//
// Written into the same `about.json` that records where it came from, because
// that file already exists to answer "why has this stopped working" and this is
// the other half of that answer. Best-effort: failing to record a check is not a
// reason to fail the call that made it.
function rememberCredentialCheck (checked) {
  const at = path.join(data.sub('credentials'), 'about.json')
  let meta = {}
  try { meta = JSON.parse(fs.readFileSync(at, 'utf8')) } catch { /* older ones have none */ }
  try { fs.writeFileSync(at, JSON.stringify({ ...meta, checked }, null, 2)) } catch { /* the answer still stands for this call */ }
}

// ---- reading two lines against each other ------------------------------
//
// A group is one branch per repository, so a pair of groups is a pair of
// branches per repository — and only where BOTH name that repository. A line
// that reached two repositories cannot land in a third, and a target that covers
// a repository the source never touched has nothing to receive there. Neither is
// an error; both are facts worth returning, because "why is this repository not
// listed" is the first thing somebody asks.
function twoLines (source, target) {
  const all = branches.groups()
  const from = all.find(g => g.name === String(source || '').trim())
  const into = all.find(g => g.name === String(target || '').trim())
  const known = all.map(g => g.name).join(', ') || 'none are named yet'
  if (!from) throw new Error(`There is no line called "${source}". There is: ${known}.`)
  if (!into) throw new Error(`There is no line called "${target}". There is: ${known}.`)
  if (from.name === into.name) throw new Error(`"${from.name}" cannot be landed into itself.`)
  if (from.broken.length) throw new Error(`"${from.name}" cannot be read: ${from.broken.join('; ')}.`)
  if (into.broken.length) throw new Error(`"${into.name}" cannot be read: ${into.broken.join('; ')}.`)

  const heads = new Map(from.on.filter(p => p.stillHere).map(p => [p.repo, p.branch]))
  const bases = new Map(into.on.filter(p => p.stillHere).map(p => [p.repo, p.branch]))

  const on = []
  for (const [repo, head] of heads) {
    if (!bases.has(repo)) continue
    // The same branch on both sides is not a comparison, and git would answer
    // "nothing", which reads as "this line is empty" rather than "these are the
    // same thing". Kept in the list and marked, so the row can say which.
    on.push({ repo, head, base: bases.get(repo), same: head === bases.get(repo) })
  }

  return {
    source: from,
    target: into,
    on,
    onlyInSource: [...heads.keys()].filter(r => !bases.has(r)),
    onlyInTarget: [...bases.keys()].filter(r => !heads.has(r))
  }
}

// A git helper lived here briefly, along with a conflict check. Both moved into
// `repos/branches.js`, where git is already written -- and, more to the point,
// where the function that RUNS the landing lives. The dry run and the act have
// to be the same code or they drift, and the first sign of the drift is somebody
// trusting the dry run.

module.exports = {
  log, keys, ssh, data, secret, github, remotes, landings, prtemplate, drafts, judgements,
  judgements,
  vbox, vms, provisioner, scripts, channel, tasks, artifact,
  archive, files, sessions, prompts, contracts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace,
  fs, path, https,
  started, net, win,
  inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
}
