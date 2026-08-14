'use strict'

// The worker credential: signing one in on a machine, keeping it here,
// handing it out per task, and taking it back.
//
// Part of the one table every caller reaches: see actions/table.js for why
// these are in separate files and still one surface.

// The table itself, so an action can call another by name. Required rather
// than passed, and read inside a `run` rather than at load time, which is what
// lets these files be split at all -- at load time half of them do not exist
// yet, and by the time anything runs they all do.
const actions = require('./table')

// Everything the table is built out of, in one place rather than a require
// block repeated nine times. See actions/shared.js.
const s = require('./shared')
const {
  log, keys, ssh, data, secret, github, remotes, landings, prtemplate, drafts, judgements,
  vbox, vms, provisioner, scripts, channel, tasks, artifact, harness, approval,
  archive, files, prompts, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s

module.exports = {
  // Signing a worker in, on a machine that is clean before and gone afterwards.
  //
  // It used to ask which RUNNING machine should sign in, and left the credential
  // sitting on it -- taking it, forgetting it and putting the machine away were
  // three more steps with nothing to remind anybody. So the ordinary outcome was
  // a runner left on, holding a live credential, which is exactly the state the
  // banner nags about.
  //
  // Two halves because there is a human in the middle: a page to visit and a
  // code to bring back. The machine holds the sign-in open in between.
  credentialsBegin: {
    about: 'Borrow a clean machine and start signing a worker in on it',
    takes: ['name'],
    run: async ({ name }) => {
      const borrowed = await actions.vmBorrow.run({ name, why: 'signing a worker in' })
      const on = borrowed.name
      try {
        const started = await actions.vmAuthBegin.run({ name: on })
        if (!started.url) {
          throw new Error(started.why || 'it did not produce a sign-in address')
        }
        return { name: on, url: started.url, note: `${on} is holding the sign-in open. It is put away as soon as the credential is here.` }
      } catch (e) {
        await actions.vmReturn.run({ name: on }).catch(() => { /* said below */ })
        log.on('vm', on).bad(`the sign-in did not start, so it was put away: ${e.message}`)
        throw e
      }
    }
  },

  credentialsFinish: {
    about: 'Give the code back, keep the credential on this host, and put the machine away',
    takes: ['name', 'code'],
    run: async ({ name, code }) => {
      // Throws on a code that did not work, and the machine is deliberately left
      // BORROWED when it does: a sign-in is retryable, and putting the machine
      // away would throw a half-finished one away with it. Giving up is the
      // dialog's other button, and that is the one that returns it.
      await actions.vmAuthCode.run({ name, code })

      const kept = await actions.vmCredentialsGrab.run({ name })
      // putAway forgets the credential before it stops the machine, so nothing
      // is left on that disk -- and the rollback would remove it regardless.
      await actions.vmReturn.run({ name })
      return {
        name,
        kept: kept.kept,
        note: `The credential is on this host and ${name} is off, clean, and back in the pool.`
      }
    }
  },

  // ---- authorising a worker -------------------------------------------
  //
  // The one credential that has to exist inside a machine. Everything else here
  // is arranged so a runner holds none -- that is what makes the gate the only
  // way work gets out -- and an agent breaks it, because it cannot work without
  // being able to authenticate.
  //
  // THE HOST HOLDS IT; A MACHINE IS HANDED ONE. Not the reverse. A runner that
  // logged in itself would leave the credential living there as a property of
  // the machine, and machines here are snapshotted, copied and deleted. So one
  // machine is signed in by a person, the credential is taken from it, and every
  // other machine is given a copy when it needs one and stripped when it does
  // not.
  //
  // Kept in the app's data directory, outside the repository, 0600 -- the same
  // place as the certificate and for the same reason.
  // Start a sign-in on a machine and hand back the URL to visit.
  //
  // The dashboard does this rather than a person opening a terminal inside the
  // machine, because a person in the machine is what everything else here
  // replaced -- and because the sign-in is two exchanges with one process, which
  // needs something to hold the process open between them.
  vmAuthBegin: {
    about: 'Start signing a machine\'s worker in, and return the URL to visit',
    takes: ['name', 'wait'],
    run: async ({ name, wait = 25 }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      const seconds = Math.max(5, Math.min(Number(wait) || 25, 120))
      const r = await channel.run(name, auth.begin(seconds), { what: 'starting a worker sign-in', timeout: (seconds + 30) * 1000 })
      const out = auth.read(r.output)

      if (out.url) {
        log.on('vm', name).good(`${name} is waiting to be signed in — open ${out.url}`)
        return { name, url: out.url, next: `visit it, then: okc.js vmAuthCode --name ${name} --code "<what it gives you>"`, log: out.log }
      }

      // No URL is not automatically a failure -- it may already be signed in, or
      // it may have refused for a reason of its own. Its own words are the
      // answer; guessing between those would be inventing one.
      // The raw reply when the parsed one is empty. A message built only from
      // fields that turned out to be blank says nothing at all, and the thing
      // most likely to explain that is what actually came back.
      throw new Error(`"${name}" did not offer a sign-in URL${out.finished ? ` (it exited ${out.exit})` : ''}.\nit said: ${out.log || '(nothing)'}\n${out.why || ''}${out.log || out.why ? '' : `\nraw reply:\n${String(r.output || '(empty)').slice(-800)}`}`)
    }
  },

  vmAuthCode: {
    about: 'Give a waiting machine the code from the sign-in page',
    takes: ['name', 'code', 'wait'],
    run: async ({ name, code, wait = 40 }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      if (!code || !String(code).trim()) throw new Error('Say what the code is.')

      const seconds = Math.max(5, Math.min(Number(wait) || 40, 120))
      const r = await channel.run(name, auth.code(String(code).trim(), seconds), { what: 'finishing a worker sign-in', timeout: (seconds + 30) * 1000 })
      const out = auth.read(r.output)

      if (out.noPipe) throw new Error(`"${name}" is not waiting for a code. Start it again with vmAuthBegin.`)
      if (out.finished && out.exit === 0) {
        // Recorded HERE too, and not only when this host hands a credential over.
        //
        // A machine that signs itself in is holding a token exactly as much as
        // one that was given one, and the snapshot refusal reads this flag. It
        // was set by vmCredentialsPut and vmCredentialsGrab and not by this,
        // which left the original hole open through a second door: sign in on
        // the machine, snapshot it, and the token is in the snapshot for as
        // long as the snapshot exists.
        vms.update(name, { holdsCredential: true })
        log.on('vm', name).good(`${name}'s worker is signed in — it cannot be snapshotted until that credential is taken back`)
        return { name, signedIn: true, next: `take it with: okc.js vmCredentialsGrab --name ${name}`, log: out.log }
      }
      throw new Error(`"${name}" did not finish signing in${out.finished ? ` (it exited ${out.exit})` : ' (it is still waiting)'}. It said:\n${out.log || '(nothing)'}`)
    }
  },

  vmAuthCancel: {
    about: 'Abandon a sign-in that is part-way through',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      await channel.run(name, auth.cancel(), { what: 'abandoning a worker sign-in', timeout: 30000 })
      return { name, cancelled: true }
    }
  },

  vmAuthStatus: {
    about: "Whether a machine's worker is signed in",
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      const r = await channel.run(name, 'claude auth status 2>&1 | head -20; echo "---"; ls -l ~/.claude/.credentials.json 2>/dev/null || echo "no credential file"',
        { what: 'checking its worker sign-in', timeout: 60000 })
      return { name, status: r.output }
    }
  },

  credentialsHeld: {
    about: 'Whether this host holds a worker credential, how long it has left, and where it came from',
    run: () => {
      const dir = data.sub('credentials')
      const file = path.join(dir, 'claude.json')
      if (!fs.existsSync(file)) return { held: false, dir }
      let meta = {}
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'about.json'), 'utf8')) } catch { /* older ones have none */ }
      const stat = fs.statSync(file)
      return {
        held: true,
        dir,
        file,
        bytes: stat.size,
        taken: meta.taken || stat.mtime.toISOString(),
        from: meta.from || 'unknown',
        // HOW LONG IT HAS LEFT, read from the credential itself. Free, instant,
        // and needs no machine — which is the whole point: the alternative was
        // booting one, handing the credential over and watching a worker fail.
        //
        // TIMESTAMPS ONLY. The tokens are never returned by this or anything
        // else; a window that can show a secret is a window that ends up in a
        // screenshot, and this one is photographed on purpose several times a day.
        life: credentialLife(file),
        // The last time a machine actually tried it, which is the only answer
        // that is proof. See credentialLife for why the clock is not.
        checked: meta.checked || null,
        // Reported rather than claimed. "Sealed" and "the folder happens to be
        // yours" are different protections, and a reader should be able to tell
        // which one is holding.
        sealed: secret.isSealed(file),
        protection: secret.isSealed(file)
          ? 'encrypted for this Windows account — the file alone is not enough'
          : 'file permissions only — readable by anything running as you'
      }
    }
  },

  vmCredentialsGrab: {
    about: 'Take the signed-in credential from a machine and keep it on this host',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      // Printed rather than copied out of a path this host cannot see. base64 so
      // a newline or a shell metacharacter in the file cannot change what
      // arrives -- and so the value never appears as readable text in the live
      // log, which is captured and kept.
      const r = await channel.run(name, 'base64 -w0 ~/.claude/.credentials.json 2>/dev/null || echo OKC_NO_CREDENTIAL',
        { what: 'taking its worker credential', timeout: 60000 })

      const b64 = String(r.output || '').split('\n').map(s => s.trim()).filter(Boolean).pop() || ''
      if (!b64 || b64 === 'OKC_NO_CREDENTIAL') {
        throw new Error(`"${name}" has no worker credential to take. Sign in on that machine first: open it and run "claude auth login".`)
      }

      const dir = data.sub('credentials')
      const file = path.join(dir, 'claude.json')
      // Sealed on the way in, so what lands on disk is not the token. It was
      // plain until somebody asked where it was kept, and the honest answer was
      // "readable by anything running as you, or as an administrator, or by
      // whatever backs this folder up".
      const sealed = secret.write(file, Buffer.from(b64, 'base64'))
      // Beside it rather than inside it: which machine it came from and when.
      // The file's own timestamp would answer the second and nothing answers the
      // first, and "where did this come from" is the question asked when
      // something stops working.
      fs.writeFileSync(path.join(dir, 'about.json'), JSON.stringify({ from: name, taken: new Date().toISOString() }, null, 2))

      vms.update(name, { holdsCredential: true })
      log.on('vm', name).good('its worker credential was taken and kept on this host')
      return { from: name, kept: file, sealed, note: 'hand it to a machine with vmCredentialsPut, and take it away again with vmCredentialsForget' }
    }
  },

  // WHETHER IT WORKS, ASKED ON PURPOSE.
  //
  // The answer only existed as a side effect of giving a machine real work: the
  // credential was tried when a task started, which is the worst moment to find
  // out, and a freshly signed-in credential sat reading "not tried yet" until
  // somebody risked a task on it.
  //
  // One action rather than four steps in a remembered order — borrow, place,
  // take back, put away. Four steps is how a machine gets left holding a
  // credential, which silently blocks its next snapshot.
  credentialsTest: {
    about: 'Take a machine, hand it the stored credential, and see whether the worker can really authenticate',
    takes: ['name'],
    run: async ({ name }) => {
      const file = path.join(data.sub('credentials'), 'claude.json')
      if (!fs.existsSync(file)) throw new Error('This host holds no worker credential, so there is nothing to test.')

      const borrowed = await actions.vmBorrow.run({ name, why: 'testing whether the stored worker credential authenticates' })
      const on = borrowed.name

      // THE MACHINE GOES BACK WHATEVER HAPPENS. This is a test: it must leave
      // nothing behind, least of all a credential on a disk — that is the state
      // that blocks a snapshot later and reports itself as somebody else's fault.
      try {
        const put = await actions.vmCredentialsPut.run({ name: on })
        return {
          on,
          ready: put.ready,
          note: put.ready === true
            ? `It works — ${on} signed in with it. Kept, so nothing has to ask again.`
            : put.ready === false
              ? `It does not work: ${on} took it and the worker reported itself signed out. Sign in again to replace it.`
              : `${on} took it and did not say whether it can authenticate, so this proves nothing either way.`
        }
      } finally {
        await actions.vmCredentialsForget.run({ name: on }).catch(() => { /* it may never have been placed */ })
        await actions.vmReturn.run({ name: on }).catch(e => log.on('vm', on).bad(`could not put it away after the test: ${e.message}`))
      }
    }
  },

  vmCredentialsPut: {
    about: 'Hand this host\'s worker credential to a machine',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      const file = path.join(data.sub('credentials'), 'claude.json')
      if (!fs.existsSync(file)) {
        throw new Error('This host has no worker credential yet. Sign in on one machine and take it with vmCredentialsGrab first.')
      }

      // ASKED BEFORE IT IS SPENT. A dead credential can be recognised here, on
      // this host, from its own refresh-token expiry — no machine, no boot, no
      // waiting. Refused only when the clock is CERTAIN, which it is in one
      // direction: an expired refresh token cannot be recovered by anything.
      // Unexpired proves nothing, so it is not treated as permission.
      const life = credentialLife(file)
      if (life.usable === false) {
        throw new Error(`This host's worker credential is dead — ${life.why}. Nothing can revive it; get a new one on the Keys tab.`)
      }

      // Opened here and nowhere else. It exists as cleartext for the length of
      // this call and is never written back out in that form.
      const b64 = secret.read(file).toString('base64')

      // AND THE FIRST-RUN WIZARD IS MARKED DONE, which is not a nicety.
      //
      // A valid token is not a usable worker. Claude Code decides whether to run
      // its first-run wizard from a flag in the config, NOT from whether it can
      // authenticate — so a machine holding a perfectly good credential still
      // opens on "choose a theme", and then on "Select login method", which is a
      // sign-in it does not need and cannot finish here. The credential is right
      // there and it asks you to log in anyway.
      //
      // That was reported as "claude doesn't work with the auth key", and it was
      // the wizard the whole time: `claude auth status` said logged in, with the
      // right email and plan, while the screen asked how to log in. Two answers
      // to one question, from the same program, because they read different
      // files.
      //
      // MERGED, NOT WRITTEN OVER. The config is Claude Code's -- it keeps the
      // account, the plan, and everything it has cached there -- so this sets one
      // key and leaves the file otherwise as found. Missing entirely is the
      // ordinary case on a machine that has just been rolled back, and then one
      // key is the whole file.
      const r = await channel.run(name, `set -u
mkdir -p "$HOME/.claude"
umask 077
printf '%s' '${b64}' | base64 -d > "$HOME/.claude/.credentials.json"
chmod 600 "$HOME/.claude/.credentials.json"
node - <<'OKC_READY_EOF'
const fs = require('fs'), os = require('os')
const p = os.homedir() + '/.claude.json'
let j = {}
try { j = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { /* absent or unreadable: one key is the whole file */ }
j.hasCompletedOnboarding = true
fs.writeFileSync(p, JSON.stringify(j))
OKC_READY_EOF
echo okc-credential-placed
# AND THEN ASKED WHETHER IT ACTUALLY WORKS, in the same breath.
#
# A FILE ON DISK IS NOT A SIGNED-IN WORKER. This returned ready:true for
# placing bytes, and a credential can be placed perfectly and still be
# expired -- which is exactly what happened: the file arrived, the wizard
# flag was set, and the worker answered "OAuth session expired and could
# not be refreshed". Every panel said the machine was signed in.
#
# In the SAME remote command because it is free here and a second round
# trip is not: this runs before every queued dispatch.
claude auth status 2>/dev/null || true`, { what: 'handing it a worker credential', timeout: 60000 })

      if (!/okc-credential-placed/.test(r.output || '')) throw new Error(`"${name}" did not take the credential.`)
      vms.update(name, { holdsCredential: true })

      // What the worker itself says, believed over what we just wrote. It prints
      // JSON; anything else -- an old version, a missing binary -- leaves this
      // unknown rather than false, because "it did not answer the question" and
      // "it answered no" are different and only one of them is a dead credential.
      let ready = null
      const said = (r.output || '').slice((r.output || '').indexOf('okc-credential-placed'))
      const seen = said.match(/\{[\s\S]*"loggedIn"[\s\S]*?\}/)
      if (seen) { try { ready = JSON.parse(seen[0]).loggedIn === true } catch { /* not the shape we know */ } }

      if (ready === false) {
        log.on('vm', name).bad(`${name} took the credential and the worker still reports itself signed out — this host's credential has expired. Get a new one on the Keys tab.`)
      } else {
        log.on('vm', name).warn(`${name} now holds a worker credential — it cannot be snapshotted until that is taken back`)
      }

      // KEPT, so the board can say "known bad" without spending a machine to
      // find out again. This is the only answer that is proof, and it was being
      // thrown away the moment it was learnt — so every panel went back to
      // guessing from a clock that says the wrong thing.
      if (ready !== null) rememberCredentialCheck({ at: new Date().toISOString(), on: name, ready })

      return {
        to: name,
        placed: true,
        ready,
        note: ready === false
          ? 'The credential was placed and the worker still reports itself signed out. This host\'s credential has expired — sign in again on the Keys tab.'
          : ready === null
            ? 'The credential was placed. The worker did not say whether it can authenticate.'
            : 'The credential was placed and the worker reports itself signed in.'
      }
    }
  },

  vmCredentialsForget: {
    about: 'Take the worker credential off a machine',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      const r = await channel.run(name, 'rm -f "$HOME/.claude/.credentials.json" && echo okc-credential-gone',
        { what: 'taking its worker credential away', timeout: 60000 })
      if (!/okc-credential-gone/.test(r.output || '')) throw new Error(`"${name}" still has it.`)
      vms.update(name, { holdsCredential: false })
      log.on('vm', name).good(`${name} no longer holds a worker credential`)
      return { from: name, removed: true }
    }
  },
}
