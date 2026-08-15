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
  require('./actions/branches'),
  require('./actions/tasks'),
  require('./actions/repos')
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
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'to fetch its session')

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
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'to hand back its session')

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
        const kept = sessions.keep(task.uid, Buffer.concat(chunks), {
          id: id || null,
          run: task.run || null,
          machine: name,
          taskId: task.id,
          number: task.number,
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
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'to hand over an artifact')

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

  // The agent, served exactly as it is on disk: it is python, so a shell header
  // would break it. Its values reach it through the service unit instead.
  if (url.pathname === '/provision/agent.py') {
    const name = url.searchParams.get('vm') || ''
    const asking = guestAsking(req, url)
    if (!asking) return refuseGuest(res, name, 'the agent')
    try {
      log.on('vm', name, 'guest').good(`${name} asked for the agent`)
      res.writeHead(200, { 'content-type': 'text/x-python' })
      res.end(scripts.raw(asking, 'agent'))
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`# ${e.message}
`)
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
function call (name, args = {}) {
  const found = actions[name]
  if (!found) throw new Error(`No action called "${name}"`)
  if (found.needs === 'workspace' && !workspaces.open()) {
    throw new Error(`No workspace is open, and "${name}" is a question about one. Open a folder of repositories first — the Workspaces tab, beside the title.`)
  }
  if (!found.run) throw new Error(`"${name}" is watched rather than asked — it answers on a stream.`)
  return found.run(args)
}

module.exports = { start, actions, call, handler, onCapture, onQuit }

if (require.main === module) {
  start()
    .then(s => console.log(`Open ${s.url}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
