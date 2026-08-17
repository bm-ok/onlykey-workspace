'use strict'

// The API. It hosts no page.
//
// NW.js opens the window from disk as an app page, and that page requires this
// module and calls the same `actions` table directly -- one process, no socket in
// between. So the HTTP side exists for exactly one client: a machine being
// provisioned, which fetches its scripts over it and reports back the same way.
//
// `node server.js` runs the same thing with no window, for driving it by hand.

const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')

const log = require('./core/log')
const ipc = require('./core/ipc')
const data = require('./core/data')
const keys = require('./core/keys')
const vbox = require('./machines/vbox')
const vms = require('./machines/vms')
const channel = require('./machines/channel')
const provisioner = require('./machines/provisioner')
const scripts = require('./machines/scripts')
const repos = require('./repos/serve')
const branches = require('./repos/branches')
const workspaces = require('./core/workspaces')
// Read by `call` below, for the actions that only exist while the drills are
// switched on. See `needs: 'testing'`.
const settings = require('./core/settings')
// What a supervisor machine may ask this host for — a named list, not a filter.
const supervisor = require('./core/supervisor')
const tasks = require('./tasks/store')
const queue = require('./tasks/queue')
// Only the HTTP handler below uses this — a guest handing a file over. It went
// missing when the require block was rebuilt around what the ACTIONS needed,
// and nothing said so: a ReferenceError inside a request handler does not crash
// anything, it leaves the socket open with no response. The guest saw a POST
// that never answered, and the artifact endpoint had been dead since the split.
const files = require('./tasks/files')
const sessions = require('./tasks/sessions')
const shared = require('./actions/shared')

// ---- the actions ------------------------------------------------------
//
// One flat table: everything the tool can do, each with a line saying what it is
// for. /api/actions serves this table and the window builds its own list of
// every capability from it, so nothing can exist here without showing up there.
//
// IT IS STILL ONE TABLE. It was one object literal of four thousand lines, which
// is not a shape anybody can hold -- so it is nine files now, grouped by what
// each action is ABOUT, and filled into the one object every caller already
// reaches. Nothing about the surface changed: the same names, the same listing,
// the same refusals.
//
// Filled rather than built, because actions call each other and across files
// that would be a cycle. See actions/table.js.
const actions = require('./actions/table')
Object.assign(actions,
  require('./actions/app'),
  require('./actions/workspaces'),
  require('./actions/machines'),
  require('./actions/runs'),
  require('./actions/host'),
  require('./actions/credentials'),
  // The Claude identities this host holds, one per name. See core/guests.js.
  require('./actions/guests'),
  require('./actions/branches'),
  require('./actions/tasks'),
  require('./actions/repos'),
  // Talking to the supervisor, and it talking back. See core/chat.js.
  require('./actions/chat'),
  // This app run against itself. Last, because every drill in it drives the
  // table above and there has to be a table first.
  require('./actions/tests')
)

// The ports this server actually ended up on, shared with the actions so a guest
// is told where something is really listening. See actions/shared.js.
const net = shared.net

// What the window hands back so it can be photographed on demand rather than
// polled at. The action that uses it lives in actions/app.js; this is only the
// door it is registered through, because server.js is what a window requires.
const onCapture = fn => {
  shared.win.capture = typeof fn === 'function' ? fn : null
  // The moment a window exists, said once. `start` cannot report this -- the
  // window requires this file and gets here afterwards -- and "was anybody
  // looking at it" is the difference between a headless run and somebody
  // working, which is worth knowing when reading back what happened.
  if (shared.win.capture) log.on('app').good('a window attached')
}

// And how it closes itself. Registered the same way and for the same reason:
// `nw.App.quit()` exists in the page and nowhere else, and the alternative from
// outside is killing the process — which takes the window down mid-write rather
// than letting it close.
const onQuit = fn => { shared.win.quit = typeof fn === 'function' ? fn : null }

// AND HOW IT IS DRIVEN FROM OUTSIDE — read what is on screen, press a button,
// fill a field. Registered the same way as the other two, because all three are
// the same shape: something only the page can do, handed to the actions.
//
// This is for TESTING THE WINDOW, which was the one half of this app that could
// not be exercised from the command line. Everything else has an action; the
// window had a camera and nothing else, so a panel could be photographed and
// never operated, and every fault in a click handler was found by a person
// clicking it.
//
// WHAT IT IS NOT is a way around the approval rules. A press driven from here is
// still a press made by whatever is on the other end of the pipe, and the window
// says so — see `drivenFromTheWire` in ui/base.js, which puts `_overTheWire` on
// everything a driven press causes. Without that this action would hand a model
// the approve button, which is the one thing the wire is refused.
const onDrive = fn => { shared.win.drive = typeof fn === 'function' ? fn : null }

// ---- serving ----------------------------------------------------------

// This port is for machines. Two things are on it, and both name the machine
// they are for and make it prove that:
//
//   /provision/*  a machine's own setup scripts, and its progress. Proved with
//                 the machine's token, or -- while it is still being installed
//                 and has no token yet -- the install ticket it was given on the
//                 installer's command line.
//   /git/*        the repositories, proved with the same token.
//
// There is deliberately no third entry. The actions used to be here behind a
// loopback check, and both the check and `body()` that parsed their arguments
// went with them: dead the moment the route did, and a helper kept "in case"
// is how a route grows back.

// Which machine is asking, by the token it was made with, or null.
//
// HTTP Basic because it is the one scheme git speaks with nothing installed in
// the guest: the credentials sit in the clone URL and git replays them on each
// request. The machine's name is the username, so a push -- when there is one --
// is attributable to a machine rather than to whoever could reach the port.
function machineAsking (req) {
  const m = /^Basic (.+)$/i.exec(req.headers.authorization || '')
  if (!m) return null
  const raw = Buffer.from(m[1], 'base64').toString('utf8')
  const at = raw.indexOf(':')
  if (at === -1) return null
  const name = raw.slice(0, at)
  const token = raw.slice(at + 1)
  // From the registry, so a machine this app did not make has no token that
  // works -- the same boundary every other action is drawn on.
  const vm = vms.read().find(v => v.name === name)
  return vm && vm.spec && vm.spec.token && vm.spec.token === token ? vm : null
}

// Which machine is asking for a machine's scripts, or null.
//
// TWO WAYS TO PROVE IT, because a machine's life has two halves and only the
// second has a secret in it.
//
// Once it has been built it holds its token, and that is the answer -- the same
// credential /git/* already takes.
//
// Before that it holds nothing at all: the script it is fetching is where the
// token comes from, which is the whole chicken-and-egg. So an install carries a
// TICKET, made when the install starts and put on the installer's command line,
// which is the one channel that reaches a machine with nothing on it.
//
// The ticket dies the moment the machine dials in. That matters because the
// command line outlives the install -- VirtualBox writes it into
// `vboxpostinstall.sh` in the machine's folder, where it sits for as long as the
// machine exists. A token there would be a live secret in a plain file; a spent
// ticket is a string that opens nothing.
//
// Named for a machine, always. "Is this a machine we know" is not the question;
// "is this THAT machine" is, and answering the first was how one machine could
// read another's token.
function guestAsking (req, url) {
  const name = url.searchParams.get('vm') || ''
  if (!name) return null

  let vm
  try { vm = vms.get(name) } catch { return null }

  const who = machineAsking(req)
  if (who && who.name === name) return vm

  const ticket = String(url.searchParams.get('ticket') || '')
  if (ticket && vm.installTicket && ticket === vm.installTicket) return vm

  return null
}

// A WORKER, WHICH IS NOT THE SAME AS A MACHINE THIS HOST MADE.
//
// There are two APIs here and they are for two different things:
//
//   the jobs API      a machine that is DOING work — it fetches what it
//                     remembers, hands back an artifact, clones the repositories
//   the supervisor    a machine that DECIDES what work there is — it writes
//   API               tasks and queues them, and holds no repositories at all
//
// A supervisor is a machine with a token, so `guestAsking` says yes to it, and
// most of the jobs API would then refuse it for the wrong reason: it is not
// running a task, so there is no session to fetch and nowhere for an artifact to
// belong. True, accidental, and it would stop being true the day something gave
// a supervisor a task by hand.
//
// So it is refused for what it IS. A supervisor asking the jobs API is asking
// for somebody else's surface, and the answer should not depend on what it
// happens to be doing this minute.
function workerAsking (req, url) {
  const vm = guestAsking(req, url)
  if (!vm) return null
  if ((vm.tags || []).some(t => String(t).toLowerCase() === vms.SUPERVISOR)) return null
  return vm
}

// One refusal, worded once. ASCII, because curl and wget put it in front of
// somebody with no other information about what went wrong.
function refuseGuest (res, name, why) {
  log.on('provision').warn(`refused ${why} for "${name || 'no machine named'}"`)
  res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    .end('this asks for the machine it is for, and proof of being that machine.\nan installing machine proves it with its install ticket; a built one with its token.\n')
}

// Serving the workspace's repositories. Read-only for now: cloning is built and
// pushing is not, and the difference is stated rather than left to a 404 that
// would read as "no such repository".
function gitRoute (req, res, url) {
  const who = machineAsking(req)
  if (!who) {
    // Git asks once with no credentials and expects to be challenged -- that is
    // the handshake, and every ordinary clone does it. Warning about it puts a
    // line that reads as a fault in front of the operator twice per clone, so
    // only credentials that were OFFERED AND REFUSED are worth saying anything
    // about.
    if (req.headers.authorization) {
      log.on('git').warn(`refused ${url.pathname} from ${req.socket.remoteAddress} — no machine of this app answers to that name and token`)
    }
    res.writeHead(401, {
      'www-authenticate': 'Basic realm="the workspace repositories"',
      'content-type': 'text/plain'
    }).end('this asks for the name and token of a machine this app made\n')
    return
  }

  // AND A SUPERVISOR HAS NO BUSINESS HERE AT ALL.
  //
  // This serves the workspace's repositories to a machine that is DOING work. A
  // supervisor decides what work there is and holds no repositories — its whole
  // provisioning skips the project's half for that reason — so a supervisor
  // cloning from here is a supervisor with a copy of the work it is supposed to
  // be handing out, which is the difference between deciding and doing.
  //
  // The same 401 as a stranger, deliberately: from this route it IS one.
  if ((who.tags || []).some(t => String(t).toLowerCase() === vms.SUPERVISOR)) {
    log.on('git').warn(`refused ${url.pathname} for "${who.name}" — a supervisor holds no repositories`)
    res.writeHead(401, {
      'www-authenticate': 'Basic realm="the workspace repositories"',
      'content-type': 'text/plain'
    }).end('this is for a machine doing work. a supervisor holds no repositories.\n')
    return
  }

  // `<name>` and `<name>.git` are both spelled by git clients; the same
  // repository answers to either.
  const rest = url.pathname.slice('/git/'.length)
  const cut = rest.indexOf('/')
  const repo = (cut === -1 ? rest : rest.slice(0, cut)).replace(/\.git$/, '')
  const tail = cut === -1 ? '' : rest.slice(cut)

  const dir = repos.gitDirOf(repo)
  if (!dir) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`no repository called "${repo}" in the workspace\n`)
    return
  }

  // AND ONLY THE REPOSITORIES ITS BRANCH IS ABOUT.
  //
  // Being a machine this app made was the whole of the authorization: any token
  // reached any repository in the workspace, for reading as well as writing. So
  // the scope enforced when the workspace was built -- two repositories out of
  // three -- was a decision about what got CHECKED OUT, and nothing stopped a
  // worker cloning the third itself. A limit that only holds while nobody tries
  // is not a limit.
  //
  // Read from the branch every time rather than recorded against the machine,
  // for the same reason the protected check below is: a recorded permission is
  // not evidence, it is a copy of a decision that may have changed since.
  //
  // A machine with no branch yet is left to the checks further down, which say
  // "you have not been set up" -- a better answer than one about repositories.
  if (who.branch) {
    const scope = branches.scopeOf(who.branch)
    if (!scope.repos.includes(repo)) {
      log.on('git', who.name).warn(`${who.name} asked for ${repo}, which is not part of "${who.branch}"`)
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        .end(`refused: ${repo} is not part of the work you were given.\n"${who.branch}" is about ${scope.repos.join(', ')}.\nnothing was taken - your commits are still on your own copy.\n`)
      return
    }
  }

  const service = tail === '/info/refs'
    ? url.searchParams.get('service')
    : (tail === '/git-upload-pack' && 'git-upload-pack') || (tail === '/git-receive-pack' && 'git-receive-pack')

  if (!repos.SERVICES[service]) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('this serves git\'s smart http protocol and nothing else\n')
    return
  }

  // A push may only ever land on the branch this machine was set up on, and the
  // rule is carried to git rather than checked here: the refs being pushed are
  // inside the packfile stream, so reading them at this layer would mean
  // implementing the protocol to find out. The hook sees them for free, and runs
  // on this host, where no guest can edit or skip it.
  //
  // Refused before any of that when there is no branch recorded, so the failure
  // is "you have not been set up" rather than a hook talking about a branch
  // nobody chose.
  //
  // ASCII ONLY for anything that crosses to a git client, and that is not
  // fussiness. Git relays a remote's message as raw bytes and transcodes
  // nothing, so an em-dash in this sentence reached the operator's terminal as
  // `â` -- a message about a refusal, itself looking broken. The live log is
  // ours and keeps its punctuation.
  const env = {}
  if (service === 'git-receive-pack') {
    if (!who.branch) {
      log.on('git', who.name).warn(`${who.name} tried to push to ${repo} without being set up on a branch`)
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        .end('no branch is recorded for this machine.\nset it up on a branch from the dashboard, then push again.\nnothing was taken - your commits are still on your own copy.\n')
      return
    }
    // Checked again at the push, and not only when the machine was set up.
    // A machine set up before this rule existed still carries whatever branch it
    // was given, and a branch can become protected afterwards -- checking one
    // out on the host is enough. The recorded permission is therefore not
    // evidence on its own; it is re-read against the rule every time it is used.
    const guarded = branches.whyProtected(who.branch)
    if (guarded) {
      log.on('git', who.name).warn(`${who.name} tried to push ${who.branch}, which is protected`)
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        .end(`refused: ${who.branch} is protected and cannot be pushed to.\nnothing was taken - your commits are still on your own copy.\n`)
      return
    }

    // Git refuses a push to a branch that is checked out, so a review left open
    // here would fail the machine's push for a reason that has nothing to do
    // with the machine -- and say so in terms of a configuration variable. If
    // that checkout is clean it is worth nothing, so this steps off it. If it is
    // not, the push is refused naming the work that is in the way, which is the
    // one thing the machine's own error could never have said.
    try {
      for (const f of branches.freeEverywhere(who.branch)) {
        if (f.busy) {
          log.on('git', who.name).warn(f.why)
          res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' })
            .end(`refused: ${f.why}\nnothing was taken - your commits are still on your own copy.\n`)
          return
        }
        if (f.freed) log.on('git', who.name).info(`${f.repo} was on ${f.from} here; moved it back to ${f.to} so the push can land`)
      }
    } catch (e) {
      log.on('git', who.name).warn(`could not clear the way for ${who.branch}: ${e.message}`)
    }

    env.OKC_ALLOW_BRANCH = who.branch
    env.OKC_MACHINE = who.name
    // READ-ONLY WHERE THE BRANCH IS A LINE.
    //
    // A machine may now be set up on a protected branch on purpose: a task that
    // reads, measures or reports has to be somewhere, and a line is where the
    // work it is reading actually is. What it must not do is push back.
    //
    // The hook already refuses anything that is not the machine's branch, which
    // is exactly why this is needed: on a line, the branch being pushed to IS
    // the machine's branch, so the existing test says yes. Told here rather than
    // worked out in the hook, because only this side knows what is protected --
    // and told as a fact rather than a name, so the hook has nothing to look up.
    if (branches.isProtected(who.branch)) env.OKC_READ_ONLY = '1'
  }

  if (tail === '/info/refs') return repos.advertise(res, { dir, service, repo, env })
  return repos.rpc(req, res, { dir, service, repo, env })
}

function handler (req, res) {
  const url = new URL(req.url, 'http://localhost')

  // ---- what a guest talks to -----------------------------------------
  //
  // Plain GETs with no body, because they are called by curl inside an installer.

  if (url.pathname === '/provision/report') {
    const name = url.searchParams.get('vm') || ''
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'a progress report')
    try { provisioner.report(name, url.searchParams.get('stage') || 'running') } catch { /* never worth an error */ }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n')
    return
  }

  // A line from inside a machine, into the same live log as everything else. This
  // is what makes a long install watchable instead of silent.
  //
  // Authenticated like the rest, and it matters more here than it looks: this
  // writes into the operator's log wearing a machine's name, so without it
  // anything on the network could put convincing sentences in front of them and
  // sign them as a machine it is not.
  if (url.pathname === '/provision/say') {
    const name = url.searchParams.get('vm') || ''
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'a line for the log')
    log.on('vm', name, 'guest').out(url.searchParams.get('text') || '')
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n')
    return
  }

  // Handing something over that is not a commit.
  //
  // A machine pushes here; this decides where it lands. THE GUEST SENDS A NAME
  // AND NOTHING ELSE -- no task, no branch, no directory -- because the host
  // already knows which task that machine is running and is the only side that
  // should be deciding. A guest that could name its destination could name
  // somebody else's, and the defence against a path would then be a list of
  // spellings of "the parent directory" that somebody has to keep complete.
  //
  // It is the same shape as everything else a guest talks to: prove which
  // machine you are, then be told what you get.
  // ---- what a supervisor may ask this host to do -------------------------
  //
  // THE OTHER DIRECTION FROM EVERYTHING ELSE HERE. A runner is GIVEN work and
  // hands results back; a supervisor ASKS for work to exist. It is a machine
  // running Claude Code whose job is to drive this app — write a task, queue it,
  // read what came back, decide what to write next.
  //
  // Three gates, in this order, and each is a different question:
  //
  //   1. is it the machine it says it is    the same proof every guest gives
  //   2. is that machine a SUPERVISOR       the tag it was built with; a runner
  //                                         asking gets the same 401 as a
  //                                         stranger, because from here it IS one
  //   3. is what it asks for on the list    core/supervisor.js, an allowlist
  //
  // The third is the one that matters and the one that keeps mattering: it is a
  // named list, so adding an action to this app never adds a supervisor
  // capability. See core/supervisor.js for what is on it and what is deliberately
  // not.
  if (url.pathname === '/supervisor' || url.pathname.startsWith('/supervisor/')) {
    const name = url.searchParams.get('vm') || ''
    const asking = guestAsking(req, url)
    if (!asking) return refuseGuest(res, name, 'to drive this dashboard as a supervisor')

    // A RUNNER IS NOT A SUPERVISOR, and the refusal is the same 401 rather than a
    // 403 that would tell a machine what it is not. Read from the tag, which is
    // what everything else reads and is what the machine was built with.
    const isSupervisor = ((asking.tags || [])).some(t => String(t).toLowerCase() === vms.SUPERVISOR)
    if (!isSupervisor) {
      log.on('supervisor', name).warn(`${name} asked to drive the dashboard and is not a supervisor machine`)
      return refuseGuest(res, name, 'to drive this dashboard as a supervisor')
    }

    // WHAT IT MAY DO, asked for rather than remembered. A model that has to guess
    // the list will guess, and every wrong guess is a refusal in the log that
    // looks like something trying doors.
    if (url.pathname === '/supervisor' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        vm: name,
        may: supervisor.list().map(one => ({ ...one, takes: (actions[one.what] || {}).takes || [] })),
        how: 'POST /supervisor/do?vm=<name>&what=<action> with a JSON object of arguments as the body.',
        note: 'This is a named list, not a filter over what this host can do. Anything not on it does not exist here.'
      }, null, 2))
      return
    }

    if (url.pathname === '/supervisor/do' && req.method === 'POST') {
      const what = url.searchParams.get('what') || ''
      if (!supervisor.may(what)) {
        log.on('supervisor', name).warn(`refused "${what}" — a supervisor may not ask for it`)
        res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: supervisor.refuse(what) }, null, 2))
        return
      }

      const chunks = []
      let size = 0
      let refused = false
      req.on('data', c => {
        if (refused) return
        size += c.length
        // A task brief is prose and can be long; a megabyte is not a brief.
        if (size > 1024 * 1024) {
          refused = true
          res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'that is more than a megabyte of arguments' }))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', async () => {
        if (refused) return
        const body = Buffer.concat(chunks).toString('utf8').trim()
        let args = {}
        if (body) {
          try { args = JSON.parse(body) } catch (e) {
            res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `the body is not JSON: ${e.message}` }))
            return
          }
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'the body is a JSON object of arguments, or nothing at all' }))
          return
        }

        // IT IS OVER THE WIRE, AND IT DOES NOT GET TO SAY OTHERWISE.
        //
        // Several actions behave differently depending on who asked. A job,
        // prompt or contract written AT THE WINDOW is approved by whoever wrote
        // it, because a person read it; written OVER THE WIRE it waits. And
        // approving is refused over the wire outright — "a model may write one
        // and may not approve its own".
        //
        // That is decided from `_overTheWire`, which the caller passes. This
        // route calls `call()` in process, exactly as the window does, so
        // without this a supervisor writing a job would have produced an
        // APPROVED one: a machine writing a program and marking it read.
        //
        // Two halves, and the second is the one that would have been forgotten:
        // every key the machine sent that starts with `_` is dropped before the
        // flag is set, so a supervisor cannot claim to be the window by putting
        // `_overTheWire: false` or `_driven: true` in its own body. What arrives
        // over the wire is data, and data does not get to say where it came from.
        const clean = {}
        for (const [k, v] of Object.entries(args)) if (!k.startsWith('_')) clean[k] = v
        clean._overTheWire = true
        // AND WHICH MACHINE IS TALKING, stamped here rather than claimed there.
        // A message on the Chat tab says who said it, and the one question that
        // record has to answer later is who asked for a thing — so the name comes
        // from the token that authenticated the call, and anything the machine
        // sent under a `_` key was dropped a line ago.
        clean._fromMachine = name

        try {
          // THROUGH THE SAME DOOR EVERY OTHER CALLER USES. This decides whether;
          // `call` decides how, and every refusal, workspace gate and record that
          // applies to a person at the window applies here unchanged.
          const said = await call(what, clean)
          // KEPT, because this is the record of a machine deciding something. It
          // is the one log line that answers "why is there a task nobody wrote".
          log.on('supervisor', name).good(`${name} asked for "${what}" and it was done`)
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(said === undefined ? { ok: true } : said, null, 2))
        } catch (e) {
          log.on('supervisor', name).warn(`${name} asked for "${what}" and was refused: ${e.message}`)
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }, null, 2))
        }
      })
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: 'a supervisor asks GET /supervisor for what it may do, and POST /supervisor/do?what=<action> to do one of them' }))
    return
  }

  // ---- the transcript, both ways ----------------------------------------
  //
  // A worker's session is the only record of why it did what it did, and the
  // machine that holds it is rolled back the moment the work ends. So it comes
  // here when a run finishes, and goes back down before the next one starts --
  // which is what makes a task given out twice a second attempt at the same
  // conversation rather than a stranger starting fresh.
  //
  // WHICH SESSION IS NOT ASKED, IT IS LOOKED UP, exactly like an artifact's
  // task. The guest sends bytes and says nothing about where they belong; this
  // side decides, from the task the machine is running. A machine that talks its
  // way into another task's transcript is not a thing that can happen if it is
  // never asked.
  if (url.pathname === '/session' && req.method === 'GET') {
    const name = url.searchParams.get('vm') || ''
    if (!workerAsking(req, url)) return refuseGuest(res, name, 'to fetch its session')

    const task = tasks.read().find(t => t.machine === name && t.state === 'given') || null
    if (!task) {
      // 204 rather than 404: "there is no session to continue" is an ordinary
      // answer to this question, and the first run of every task gives it.
      res.writeHead(204).end()
      return
    }
    const kept = sessions.get(task.uid)
    if (!kept) { res.writeHead(204).end(); return }
    try {
      const body = require('node:fs').readFileSync(kept.path)
      res.writeHead(200, {
        'content-type': 'application/gzip',
        // The conversation it is carrying on, so the guest can pass --resume
        // without having to look inside the archive it was just handed. It is
        // told which; it does not choose.
        'x-okc-session': kept.id || ''
      }).end(body)
      log.on('vm', name, 'guest').info(`sent #${task.number} what it remembers — ${Math.round(kept.bytes / 1024)} KB, ${kept.runs} run(s) so far`)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(`${e.message}\n`)
    }
    return
  }

  if (url.pathname === '/session' && req.method === 'POST') {
    const name = url.searchParams.get('vm') || ''
    if (!workerAsking(req, url)) return refuseGuest(res, name, 'to hand back its session')

    const id = url.searchParams.get('id') || ''
    if (!sessions.okId(id)) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('that is not a session id\n')
      return
    }

    const task = tasks.read().find(t => t.machine === name && t.state === 'given') || null
    if (!task) {
      res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' })
        .end('this machine is not running a task, so a transcript has nothing to belong to.\n')
      return
    }

    const chunks = []
    let size = 0
    let refused = false
    req.on('data', chunk => {
      if (refused) return
      size += chunk.length
      if (size > sessions.MOST) {
        refused = true
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' })
          .end(`the most this takes is ${sessions.MOST / 1048576} MB\n`)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (refused) return
      try {
        // WHICH SIGN-IN SPENT THIS, taken from the machine rather than asked of
        // the guest. The machine is told which credential it holds when one is
        // put on it — see actions/credentials.js — and a worker naming its own
        // identity would be a worker choosing which one to bill.
        const on = vms.read().find(v => v.name === name) || {}

        const kept = sessions.keep(task.uid, Buffer.concat(chunks), {
          id: id || null,
          run: task.run || null,
          machine: name,
          taskId: task.id,
          number: task.number,
          guest: on.guest || null,
          folder: url.searchParams.get('folder') || null
        })
        // A TRANSCRIPT ARRIVING IS PROOF A WORKER RAN. It is the only proof a
        // job's task gets: the job itself is a node script, so nothing else
        // about the run says whether it started a worker or only moved files
        // around. Recorded on the task, because "was Claude used for this" is a
        // question about the work and not about the archive.
        try { tasks.update(task.id, { usedClaude: true }) } catch { /* the board may have moved on */ }
        log.on('vm', name, 'guest').good(`kept what #${task.number} remembers — ${Math.round(kept.bytes / 1024)} KB, run ${kept.runs}`)
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('kept\n')
      } catch (e) {
        log.on('vm', name, 'guest').bad(`could not keep that transcript: ${e.message}`)
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(`${e.message}\n`)
      }
    })
    return
  }

  if (url.pathname === '/artifact' && req.method === 'POST') {
    const name = url.searchParams.get('vm') || ''
    if (!workerAsking(req, url)) return refuseGuest(res, name, 'to hand over an artifact')

    const called = url.searchParams.get('name') || ''
    const why = files.whyNot(called)
    if (why) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(`${why}\n`)
      return
    }

    // WHICH TASK IT BELONGS TO IS NOT ASKED, IT IS LOOKED UP. A machine is
    // running exactly one task or it is not running one at all, and an artifact
    // from a machine doing nothing has nowhere to belong -- so that is refused
    // with the reason rather than filed somewhere plausible.
    //
    // From the task record rather than from the queue, because the queue only
    // knows about work IT dispatched: a task handed straight to a named machine
    // with taskGive is just as real, and looking in the wrong place would have
    // refused every artifact from one. Both paths write the same two fields.
    const task = tasks.read().find(t => t.machine === name && t.state === 'given') || null

    // A JOB IS NOT A TASK, and it hands things back too.
    //
    // A run says which it is in its own id, and a job's is unique by
    // construction, so it can be the thing the file is filed under. Without this
    // every artifact from a job was refused for the honest but useless reason
    // that the machine was not running a task -- true, and not what it was doing.
    //
    // The task is still preferred where there is one: a machine running a task
    // that ALSO runs a job is filing against the work, which is what somebody
    // reading it afterwards is looking for.
    const run = String(url.searchParams.get('run') || '')
    const job = !task && /^job-/.test(run) ? run : null

    if (!task && !job) {
      res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' })
        .end('this machine is not running a task or a job, so there is nothing for an artifact to belong to.\n')
      return
    }

    const chunks = []
    let size = 0
    let refused = false
    req.on('data', chunk => {
      if (refused) return
      size += chunk.length
      // Stopped at the door rather than after it is all in memory, because the
      // point of a cap is not to have accepted the thing it refuses.
      if (size > files.MOST) {
        refused = true
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' })
          .end(`the most this takes is ${files.MOST / 1048576} MB\n`)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (refused) return
      try {
        // Filed under the task's uid where there is a task, and under the run's
        // own id where it is a job. Both are unique and neither is reused, which
        // is the only property this needs of them.
        const kept = task
          ? files.keep(task.uid, called, Buffer.concat(chunks), {
            run: task.run || null,
            // Written into the record beside the file so the folder says which
            // task it belonged to. The uid is still what it is keyed on.
            taskId: task.id, number: task.number, title: task.title
          })
          : files.keep(job, called, Buffer.concat(chunks), { run: job })
        log.on('vm', name, 'guest').good(`handed over "${called}" (${Math.round(kept.bytes / 1024)} KB) for ${task ? `#${task.number}` : job}`)
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('kept\n')
      } catch (e) {
        log.on('vm', name, 'guest').bad(`could not keep "${called}": ${e.message}`)
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(`${e.message}\n`)
      }
    })
    return
  }

  // ---- provisioning files that are not shell ------------------------------
  //
  // Served exactly as they are on disk, because a shell header would break every
  // one of them: the agent is python, the supervisor's tool server is a node
  // program, and its skill is a document a model reads. What a shell script gets
  // from that header — its name, its token, where this host is — the agent gets
  // through its service unit and the tool server gets from ~/.okc/env.
  //
  // ONE ROUTE RATHER THAN A CASE PER FILE. There was a hand-written branch for
  // agent.py, and adding two more would have been two more; what they have in
  // common is "a registered provisioning file that is not shell", which is a
  // thing this app can already answer — see machines/scripts.js.
  //
  // The same proof as every other provisioning file: name the machine, and prove
  // you are it.
  if (/^\/provision\/[^/]+\.(py|js|md)$/.test(url.pathname)) {
    const file = path.basename(url.pathname)
    const name = url.searchParams.get('vm') || ''
    const asking = guestAsking(req, url)
    if (!asking) return refuseGuest(res, name, file)
    try {
      const stage = scripts.stageOfFile(file)
      if (!stage) throw new Error(`"${file}" is not a provisioning file this app serves`)
      log.on('vm', name, 'guest').good(`${name} asked for ${file}`)
      res.writeHead(200, {
        'content-type': file.endsWith('.py')
          ? 'text/x-python'
          : file.endsWith('.js') ? 'application/javascript' : 'text/markdown'
      })
      res.end(scripts.raw(asking, stage))
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`# ${e.message}\n`)
    }
    return
  }

  // Any script in provision/, by filename, so a swapped-in one is served the same
  // way as a default. The name is resolved inside that folder and nowhere else.
  //
  // THIS is the one that mattered. A script carries the machine's token, so
  // serving it to anyone that asked meant any machine could read any other
  // machine's secret and then be that machine -- dial in as it, push to its
  // branch. Encryption settled who could read it in transit and did nothing
  // about who could ask for it.
  if (url.pathname.startsWith('/provision/') && url.pathname.endsWith('.sh')) {
    const file = path.basename(url.pathname)
    const name = url.searchParams.get('vm') || ''
    const asking = guestAsking(req, url)
    if (!asking) return refuseGuest(res, name, file)
    try {
      const vm = asking
      const stage = scripts.stageOfFile(file)
      log.on('vm', name, 'guest').good(`${name} asked for ${file} (${scripts.sourceOf(scripts.fileFor(vm, scripts.stageOfFile(file) || file))}'s copy)`)
      vbox.hostAddress().catch(() => '127.0.0.1').then(host => {
        res.writeHead(200, { 'content-type': 'text/x-shellscript' })
        res.end(scripts.render(stage || file, vm, { hostAddress: host, port: net.port, channelPort: net.channelPort, caPort: net.caPort, caFingerprint: keys.ensure().fingerprint }))
      })
    } catch (e) {
      log.on('vm', 'guest').bad(`something asked for ${file} as "${name}": ${e.message}`)
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`# ${e.message}\n`)
    }
    return
  }

  if (url.pathname.startsWith('/git/')) return gitRoute(req, res, url)

  // ---- and nothing else ----------------------------------------------
  //
  // THE ACTIONS ARE NOT HERE. They were, on /api/*, answering loopback only --
  // and that check was the entire thing standing between anything that could
  // reach this port and an action that deletes a machine.
  //
  // A check is a line of code. It is right until somebody edits it, and it has
  // to keep being right for as long as the route exists. The actions now live on
  // a local socket, which cannot be reached from another machine at all: no
  // address to compare, no interface to bind by accident, nothing to keep
  // enforcing. The strongest version of a check is not needing one.
  //
  // That is the answer to a real question rather than a tidy-up. A machine here
  // may be running something that would start another machine if it could, and
  // "it cannot reach the actions" is a better sentence when nothing has to be
  // asked.
  //
  // What is left on this port is only what a machine legitimately needs, and
  // every bit of it now says which machine it is for and proves it.
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('This serves machines: their setup scripts and their repositories.\nThe actions are not on this port at all.\n')
}

// Listens on every interface, because a guest on a bridged adapter reaches this
// host by its network address and loopback would be useless to it. Safe to do only
// because of the split above: what is reachable from the network is a guest asking
// for its own scripts, never an action.
function start ({ port: wanted = Number(process.env.PORT || 7373), host = process.env.HOST || '0.0.0.0' } = {}) {
  // Made on first start and kept. A machine is told to trust this authority, so
  // this is also the moment its address is checked against what the certificate
  // actually names -- see `status.tls`.
  const tls = keys.ensure()

  const server = https.createServer({ key: tls.key, cert: tls.cert }, handler)

  // The authority, in the clear, and nothing else ever. Written as its own
  // server rather than a path on the main one because a port cannot be both
  // encrypted and not -- and because the list of things reachable without
  // encryption should be visible in one place and be one item long.
  // ONE file. Not the fingerprint beside it, deliberately.
  //
  // Serving both here would look convenient and would be a trap: anything
  // fetching the authority and its fingerprint from the same unprotected place
  // has verified nothing -- whoever could substitute one could substitute the
  // other, and the check would pass while being worthless. The fingerprint has
  // to arrive by a route this one cannot touch, which is the installer's command
  // line, the window, or the command line here.
  const caServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url && req.url.startsWith('/ca.pem')) {
      res.writeHead(200, { 'content-type': 'application/x-pem-file' }).end(tls.ca)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
      .end('this serves ca.pem and nothing else. everything else is on the encrypted port,\nand the fingerprint to check this against does not come from here.\n')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(wanted, host, async () => {
      net.port = server.address().port

      await new Promise(done => {
        caServer.once('error', e => { log.on('server').bad(`could not publish the authority: ${e.message}`); done() })
        caServer.listen(net.caPort, host, () => { net.caPort = caServer.address().port; done() })
      })
      try {
        const c = await channel.listen({
          tokenFor: name => (vms.read().find(v => v.name === name) || {}).spec?.token,
          // A machine that has dialled in has its token, so the ticket that got
          // it there is spent. Burned here rather than on a timer, because this
          // is the only moment anything knows the install actually finished.
          // Two things, both only knowable at this moment.
          //
          // The ticket is spent: the machine has a token now, so whatever
          // carried it here must not outlive that.
          //
          // And the address is REMEMBERED, because the moment you most want to
          // reach a machine is the moment it has stopped talking to you. It is
          // only knowable while connected — it is the far end of the socket —
          // and by the time somebody needs to ssh in and find out why the agent
          // is silent, there is no socket to ask.
          onHello: (name, seen = {}) => {
            try {
              vms.update(name, {
                installTicket: null,
                ...(seen.address ? { lastAddress: seen.address, lastUser: seen.user || null, lastSeenAt: new Date().toISOString() } : {})
              })
            } catch { /* it may already be gone */ }

            // AND IT IS ASKED WHAT IT IS STILL WORKING ON.
            //
            // Restarting this app re-queues anything that was being set up, which
            // is the honest thing for a process that has just lost its memory to
            // do. This is what gives it back: a machine that is still up, still on
            // its branch, still holding a task, says so the moment it reconnects.
            //
            // Not awaited. Hello is how a machine becomes reachable at all, and a
            // slow or unanswered question here would hold that up for every other
            // reason anything wants to talk to it.
            queue.redial(actions, log, name)

            // AND A BRAND NEW MACHINE GETS ITS CLEAN STARTING POINT.
            //
            // Dialling in is the first moment a freshly built machine is really
            // finished: the installed system booted, its agent started, and it
            // reached here. Nothing has been asked of it yet, which is exactly
            // what a base snapshot should contain.
            //
            // It cannot be done when the guest reports "online" — that comes
            // from the installer's post-install stage, before the installed
            // system has ever booted. See provisioner.firstSnapshotIfItNeedsOne.
            provisioner.firstSnapshotIfItNeedsOne(name)
              .catch(e => log.on('queue', name).warn(`could not ask it what it is working on: ${e.message}`))
          }
        })
        net.channelPort = c.port
      } catch (e) {
        log.on('channel').bad(`could not listen for machines dialling in: ${e.message}`)
      }

      // The same actions, for something on this machine that is not the window.
      // Not a port: a local socket cannot be reached from another machine at
      // all, so there is no address to check and no rule to keep enforcing.
      let local = null
      try {
        local = await ipc.listen(actions, { log, call })
        log.on('ipc').good(`Listening on ${local.address} — the same actions, for the terminal`)
      } catch (e) {
        // Worth continuing without: the window is in-process and does not need
        // it, so a dashboard with no command line is still a working dashboard.
        log.on('ipc').warn(`no command line: ${e.message}`)
      }

      // Started with the server, not with the window. A queued task should be
      // picked up because this process is running, not because somebody has the
      // dashboard open — the point of queueing work is that you can walk away
      // from it.
      queue.begin(actions, log)
      log.on('queue').info(`watching for queued work every ${queue.TICK / 1000}s`)

      // Said once, on the start that does it. Moving a machine registry out from
      // under a running app is not something to do quietly -- and on anybody
      // else's copy this is the start where it happens.
      const carried = data.tookOver()
      if (carried && carried.moved.length) {
        log.on('server').good(`moved ${carried.moved.length} state file(s) out of the repository and into ${carried.to}`)
      }
      if (carried && carried.left.length) {
        log.on('server').warn(`${carried.left.join(', ')} could not be moved out of ${carried.from} — there is already a file of that name in ${carried.to}, and the one already there is the live one`)
      }

      // BOTH ENDS OF A RESTART, in the kept record. Without a start line, the
      // events file shows a close and then whatever happened next with no seam
      // — and the seam is the thing somebody is trying to see when they ask
      // what happened while they were away. See core/events.js.
      // NOT "with a window" or "headless", because at this moment it cannot
      // know: the window requires this file and registers itself AFTER start()
      // has run, so asking here answers "headless" every time — including for a
      // window that is a tenth of a second from attaching. A record built to
      // stop things being guessed should not open with one. `onCapture` says so
      // when it actually happens.
      log.on('app').good('started')
      log.on('server').good(`Listening on port ${net.port} over TLS — scripts and repositories for machines being provisioned`)
      log.on('server').info(`The authority is published unencrypted on port ${net.caPort}, and is the only thing there`)

      // Said at startup rather than discovered when a machine cannot connect.
      // A certificate that no longer names this host's address fails as a
      // verification error inside a guest, which points nowhere near the cause.
      try {
        const where = await vbox.hostAddress()
        const s = keys.state(where)
        if (!s.ok || s.expiringSoon) log.on('server').warn(s.why)
        else log.on('server').info(`The certificate covers ${where} and is good for ${s.daysLeft} days`)
      } catch { /* no address to check against yet; status reports it either way */ }

      // THE ONE CREDENTIAL BECOMES THE FIRST GUEST.
      //
      // This host kept a single worker credential at `credentials/claude.json`,
      // on the Keys tab, lent to whoever was working. Identities live in a list
      // now — see core/guests.js — and two places holding credentials is how one
      // of them goes stale without anybody noticing.
      //
      // Idempotent and quiet: it adopts only when the list is empty, so a host
      // that has already moved does not gain a copy on every restart.
      try {
        const guests = require('./core/guests')
        const moved = guests.adoptTheOldOne(path.join(data.sub('credentials'), 'claude.json'))
        if (moved) log.on('keys').good(`the worker credential this host kept is now the Claude guest "${moved.name}" — ${moved.fingerprint}`)
      } catch (e) {
        log.on('keys').warn(`the old worker credential could not be moved into the guest list — ${e.message}`)
      }

      // EVERY MACHINE HAS A CONSOLE, INCLUDING THE ONES THAT ALREADY EXISTED.
      //
      // The serial port is attached when a machine is built, which covers
      // everything made from now on and nothing made before — and "before" is
      // most of them. This gives one to any machine that is off and has none.
      //
      // Not awaited: it is a handful of VBoxManage calls and the dashboard has no
      // reason to wait for them before answering anything.
      provisioner.makeSureConsolesAreCaptured()
        .then(r => { if (r.given.length) log.on('machines').good(`${r.given.join(', ')} now write their console here — every machine has one`) })
        .catch(e => log.on('machines').warn(`could not check every machine has a console — ${e.message}`))

      // THE OUTLINE, REWRITTEN IF THE SUITES HAVE MOVED — and only while the
      // drills are switched on for the open folder.
      //
      // `test/outline.md` is the closest thing this project has to a
      // specification: every suite, test and check, in the order a person uses
      // the app. It is generated, and a generated file is only worth reading if
      // it is current — during a session where somebody is adding checks it goes
      // stale within minutes, and the person reading it has no reason to doubt
      // it.
      //
      // GATED, because writing it means LOADING every suite, which this app
      // otherwise does on demand: a headless run that never opens the Test tab
      // should not pay for registering eighty checks. Testing mode is exactly
      // the signal that somebody is working on them.
      //
      // Written only when it would change, so an ordinary restart leaves the
      // file — and the working tree — alone. Never fatal: a specification that
      // could not be written is a line in the log, not a dashboard that will not
      // start.
      try {
        if (settings.testsAllowed(workspaces.dir() || null).allowed) {
          const outline = require('./test/outline')
          const made = outline.write()
          // UNDER `app`, NOT `test`, and that is not a detail. The durable
          // record keeps an allowlist of tags — anything that makes, destroys,
          // starts or stops something — and `test` is deliberately not on it,
          // because a run logs a line per check and would drown the record.
          // Writing a file at startup IS one of those acts, and logged under
          // `test` it went to the live log and nowhere else: the first version
          // of this rewrote the file silently, which is exactly the shape of
          // thing this app is meant not to do.
          if (made.wrote) log.on('app').info(`test/outline.md rewritten — ${made.suites} suites, ${made.tests} tests, ${made.checks} checks`)
          for (const b of made.broken) log.on('app').warn(`${b} — the outline says so, and nothing else will`)
        }
      } catch (e) {
        log.on('test').warn(`could not write test/outline.md — ${e.message}`)
      }

      resolve({
        server,
        port: net.port,
        caPort: net.caPort,
        host,
        url: `https://127.0.0.1:${net.port}/`,
        ipc: local && local.address,
        stop: () => { if (local) local.close(); caServer.close(); return server.close() }
      })
    })
  })
}

// ---- one way in ---------------------------------------------------------
//
// Every caller reached `actions[name].run(args)` on its own: the window, the
// pipe, and a drill's `okc`. Three copies of "look it up, then run it" was fine
// while there was nothing to say in between, and there is now -- most of what
// this app does is a statement about a folder of repositories, and there is a
// state where there is no such folder.
//
// REFUSED HERE RATHER THAN SURVIVED FURTHER IN. A branch, a task, a baseline and
// a pull request all name something in one workspace; asked with none open they
// would not error, they would answer about nothing -- an empty list of branches
// reads exactly like a workspace with no branches, and a task written with
// nowhere to keep it is lost silently. So an action says whether it needs one
// and is turned down in a sentence, which is the same shape as every other
// refusal here.
//
// A HOST-SCOPED ACTION IS NOT GATED. The machines this app made, the ssh hosts,
// the keys and the approvals are true whatever is being worked on -- that is the
// same split core/workspaces.js draws, and a machine must stay reachable
// precisely when there is no workspace, because putting one away is how you get
// to close one.
// AND AN ACTION THAT ONLY EXISTS WHILE THE DRILLS ARE SWITCHED ON.
//
// `needs: 'testing'` is the same device one line down, for a different question.
// The test surface drives this app for real — it writes tasks, cuts branches,
// borrows machines, opens pull requests and deletes what it made — and every one
// of those is a decision about somebody's repository rather than a flag to be
// set down a pipe.
//
// So with testing mode off for the open folder, these are not listed and not
// callable: `actions` leaves them out, and this turns them down. The whole
// surface appears when a person switches it on in the window and disappears
// again when they switch it off.
//
// IT REFUSES RATHER THAN PRETENDING THEY ARE NOT THERE. "No action called
// suiteRun" would be a lie with a plausible face — somebody would go looking for
// a typo, or for the version of this app that has it. A sentence saying it is
// switched off, and where the switch is, costs the same line and misleads
// nobody. Hidden from the list, honest when asked: those are different
// questions.
const testingAllows = () => {
  try { return settings.testsAllowed(workspaces.dir() || null) } catch { return { allowed: false, why: 'the drills are not allowed here.' } }
}

// AN ACTION MAY NEED MORE THAN ONE THING, and reading `needs` as a single value
// is how the second one silently did nothing.
//
// `drillSweep` and `drillCommit` already said `needs: 'workspace'`. Adding
// `needs: 'testing'` to the same object literal is a DUPLICATE KEY — the later
// one wins, no error, no warning — so both kept the workspace gate and lost the
// testing one, and drillSweep went on being callable with the drills switched
// off. Caught by a check that asked, not by reading the diff.
const wants = found => (Array.isArray(found.needs) ? found.needs : [found.needs]).filter(Boolean)

function call (name, args = {}) {
  const found = actions[name]
  if (!found) throw new Error(`No action called "${name}"`)
  const needs = wants(found)
  if (needs.includes('testing')) {
    const may = testingAllows()
    if (!may.allowed) {
      throw new Error(`${may.why} "${name}" is part of the test surface, which is switched on for one folder at a time by a person at the window — the menu at the top right. Until then it is not listed and not callable.`)
    }
  }
  if (needs.includes('workspace') && !workspaces.open()) {
    throw new Error(`No workspace is open, and "${name}" is a question about one. Open a folder of repositories first — the Workspaces tab, beside the title.`)
  }
  if (!found.run) throw new Error(`"${name}" is watched rather than asked — it answers on a stream.`)
  return found.run(args)
}

module.exports = { start, actions, call, handler, onCapture, onQuit, onDrive }

if (require.main === module) {
  start()
    .then(s => console.log(`Open ${s.url}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
