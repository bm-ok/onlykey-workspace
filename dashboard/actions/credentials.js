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

// THE CLAUDE IDENTITIES THIS HOST HOLDS, which used to be one file on the Keys
// tab. Required directly rather than through shared: this is the only file that
// reads a credential, and a second door onto them is the thing being closed.
const guests = require('../core/guests')

// HOW A CREDENTIAL GETS ONTO A MACHINE without existing as itself in a command
// line on the way. The machine makes a key, this host seals to it. See
// core/handover.js.
const handover = require('../core/handover')

// Everything the table is built out of, in one place rather than a require
// block repeated nine times. See actions/shared.js.
const s = require('./shared')
const {
  log, keys, ssh, data, secret, github, remotes, landings, prtemplate, drafts, judgements,
  vbox, vms, provisioner, scripts, channel, tasks, artifact,
  archive, files, prompts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s

// THE SIGN-IN DESK, and there is exactly one of them.
//
// A Claude sign-in writes ~/.claude/.credentials.json for whoever runs it. That
// one sentence decides the whole shape of this:
//
//   NOT ON A RUNNER. Signing in used to borrow a clean machine, hold the
//   conversation there, take the credential off it and put the machine away — a
//   machine brought up, a person waited on, a machine put away, per credential.
//   Every one of those steps could be interrupted, and the state it was
//   interrupted in was "a runner left on, holding a live credential".
//
//   NOT AS THE SUPERVISOR'S OWN USER EITHER, which is the flaw this replaces. A
//   supervisor RUNS as a credential; signing in again as that user would
//   overwrite the one it is thinking with. Asking for a new login URL would be
//   the thing that broke it.
//
// So a supervisor machine carries a second user — the DESK, made by
// provision/supervisor.sh — whose only job is to hold sign-in conversations. Its
// home is its own. Everything below happens there, whatever the credential is
// eventually for, and the supervisor goes on working while it does.
//
// ONE MACHINE PROVIDES EVERY LOGIN URL. A worker's credential and a supervisor's
// come off the same desk and differ only in what they are filed as.
const DESK = 'okc-signin'

// Which supervisor machine has the desk, started if it is down. One function,
// in actions/shared.js, because waking the supervisor wants exactly the same
// thing and two copies of "start it if it is off" is two copies of a decision.
const whichSupervisor = s.supervisorMachine

module.exports = {
  // ---- getting a Claude credential -----------------------------------------
  //
  // Two halves, because there is a person in the middle: the desk prints an
  // address, somebody visits it and approves, and a code comes back. Nothing
  // here can do that half, and nothing should.
  claudeSignIn: {
    about: 'Get a Claude login URL from the sign-in desk. Every credential this host holds comes from there',
    takes: ['name', 'wait'],
    run: async ({ name, wait }) => {
      const on = await whichSupervisor(name)
      const started = await actions.vmAuthBegin.run({ name: on, wait })
      if (!started.url) throw new Error(started.why || 'the desk did not produce a sign-in address')
      return {
        name: on,
        url: started.url,
        note: `The desk on ${on} is holding the sign-in open. Visit that address, approve it, and give the code back with claudeSignedIn. Nothing the supervisor is working with is touched by this.`
      }
    }
  },

  claudeSignedIn: {
    about: 'Give the code back. The credential is kept here under a name, and the desk is left empty',
    takes: ['name', 'code', 'as', 'role', 'note'],
    run: async ({ name, code, as, role = 'worker', note = null }) => {
      const on = await whichSupervisor(name)
      // ALL THREE ROLES, because this is what the window's "+" calls. It mapped
      // anything that was not a supervisor to a worker, so the Claude Judge pane
      // would have signed somebody in and quietly filed them as a worker — a
      // credential that then cannot be lent to the machine it was made for.
      const kind = role === 'supervisor' ? 'supervisor' : role === 'judge' ? 'judge' : 'worker'
      const called = String(as || '').trim()
      if (!called) throw new Error('Say what to call it. A credential is kept under a name, and a list of "claude-code-2" is a list nobody can read six weeks later.')
      if (guests.get(called)) throw new Error(`There is already a sign-in called "${called}". Pick another name, or throw that one away first.`)

      // Throws on a code that did not work, and nothing is undone when it does:
      // a sign-in is retryable, and nothing was borrowed to hold it.
      await actions.vmAuthCode.run({ name: on, code })

      // OFF THE DESK AND INTO THE LIST. Read as the desk user, because the file
      // is 0600 in the desk's home and the machine user is not it. base64 so a
      // newline or a shell metacharacter cannot change what arrives.
      //
      // AND QUIET, WHICH IS THE HALF THAT WAS MISSING. This said base64 meant
      // "the value never appears as readable text in the live log" — true and
      // beside the point: base64 is not readable and IS the credential, and
      // anybody reading the log can decode it in one command. The value does not
      // go to the log at all now. See machines/channel.js.
      const r = await channel.run(on,
        `sudo -n -u ${DESK} -H bash -c 'base64 -w0 "$HOME/.claude/.credentials.json" 2>/dev/null || echo OKC_NO_CREDENTIAL'`,
        { what: 'taking the credential off the sign-in desk', timeout: 60000, quiet: true })
      const b64 = String(r.output || '').split('\n').map(x => x.trim()).filter(Boolean).pop() || ''
      if (!b64 || b64 === 'OKC_NO_CREDENTIAL') {
        throw new Error(`The code was accepted and the desk on ${on} has no credential to take. The sign-in did not finish — start it again.`)
      }

      // ---- AND WHO THAT TURNED OUT TO BE ---------------------------------
      //
      // READ HERE BECAUSE HERE IS THE ONLY PLACE IT EXISTS. The desk is cleared
      // a few lines below -- deliberately, and `.claude.json` goes with it --
      // so this is the last moment anything on this host can find out which
      // account was just signed in. Read afterwards it is gone; read from the
      // credential it was never there.
      //
      // BEST EFFORT, AND NEVER A REASON TO FAIL A SIGN-IN. A credential that
      // works and does not say whose it is beats no credential: this is a label,
      // and the token is the thing somebody was waiting for.
      //
      // `quiet` for the same reason the credential above is. This file is not a
      // credential, but it is somebody's account sitting in a live log, and
      // nothing here needs it in there -- what is kept is the three fields
      // accountOf takes and no more.
      let account = null
      try {
        const who = await channel.run(on,
          `sudo -n -u ${DESK} -H bash -c 'base64 -w0 "$HOME/.claude.json" 2>/dev/null || echo OKC_NO_ACCOUNT'`,
          { what: 'reading which account signed in', timeout: 30000, quiet: true })
        const raw = String(who.output || '').split('\n').map(x => x.trim()).filter(Boolean).pop() || ''
        if (raw && raw !== 'OKC_NO_ACCOUNT') account = guests.accountOf(Buffer.from(raw, 'base64').toString('utf8'))
      } catch { /* a sign-in without a name on it is still a sign-in */ }

      const made = guests.add({
        name: called,
        token: Buffer.from(b64, 'base64').toString('utf8'),
        role: kind,
        from: `signed in at the desk on ${on}`,
        note,
        account
      })

      // AND THE DESK IS LEFT EMPTY. It exists to hold a conversation, not a
      // credential: one left there is a token on a machine's disk that nothing on
      // this host is recording, which is the state this whole app is arranged to
      // avoid. Done here rather than at the next sign-in, because "it will be
      // cleaned up eventually" is how it is still there in six weeks.
      // AND `.claude.json` GOES TOO, which the first version left behind.
      //
      // The credential is in `.claude/.credentials.json` and that was removed —
      // but Claude Code also writes a config file beside it, and after a sign-in
      // that file holds the account: the email address, the account uuid, when it
      // was created, what it is billed as. Not a credential, and not nothing:
      // it is who signed in, sitting on a machine's disk, in a home this host is
      // not otherwise recording anything about.
      //
      // Found by looking rather than by assuming — the desk was reported empty
      // and had 1,973 bytes of account in it.
      await channel.run(on,
        `sudo -n -u ${DESK} -H bash -c 'rm -rf "$HOME/.claude" "$HOME/.claude.json" "$HOME/.okc-auth"' && echo okc-desk-clear`,
        { what: 'clearing the sign-in desk', timeout: 60000 }).catch(e => log.on('vm', on).warn(`the desk was not cleared: ${e.message}`))

      // THE EMAIL IN THE RECORD, because "which account did I just sign in" is
      // the question somebody asks about a list of these, and the fingerprint
      // answers a different one.
      log.on('keys').good(`a Claude ${kind} called "${called}" was signed in at the desk on ${on}${account && account.email ? ` as ${account.email}` : ''} — ${made.fingerprint}`)

      // AND WHETHER THIS HOST NOW HOLDS THE SAME ACCOUNT TWICE. Worth saying at
      // the moment it becomes true, and worth saying CAREFULLY.
      //
      // THE FIRST VERSION OF THIS ASSERTED SOMETHING THAT TURNED OUT TO BE
      // FALSE: that two sign-ins of one account rotate each other's refresh
      // token, so using both invalidates one. It was written from one
      // observation -- a credential dying eight minutes after another was signed
      // in on the same account -- and the very next pair disproved it. Two
      // sign-ins of this account ran CONCURRENTLY on two machines, both spent
      // real money, and both were still good afterwards.
      //
      // WHAT IS ACTUALLY TRUE is narrower and still worth knowing: they share a
      // fate. Anything done to the account -- revoking old tokens, changing a
      // password, a plan ending -- lands on both at once, so two sign-ins here
      // are not the redundancy they look like. And it is the fact somebody wants
      // when a second credential dies for no visible reason.
      //
      // A separation between reading and writing that runs on ONE account is
      // also a weaker separation than it appears, which is the other reason to
      // say it out loud on a judge.
      if (account && account.email) {
        const twins = guests.all().filter(g => g.name !== called && g.account && g.account.email === account.email)
        if (twins.length) {
          log.on('keys').warn(`"${called}" is the same Claude account as ${twins.map(g => `"${g.name}"`).join(', ')} (${account.email}). They have been seen working at the same time, so this is not a refusal — but they share a fate: anything done to that account reaches both at once, and two sign-ins of one account are not two identities. A judge and a worker on the same account is a weaker separation than it looks.`)
        }
      }

      // A SUPERVISOR SIGN-IN GOES STRAIGHT ONTO THE MACHINE THAT ASKED, because
      // that is the only place it may go and the only reason it exists. A
      // worker's is left in the list for the queue to hand out per task.
      let lent = null
      if (kind === 'supervisor') {
        lent = await actions.guestLend.run({ name: called, machine: on })
      }

      return {
        name: on,
        guest: called,
        role: kind,
        fingerprint: made.fingerprint,
        lentTo: lent ? on : null,
        note: kind === 'supervisor'
          ? `"${called}" is kept here and ${on} is signed in as it. The desk is empty again.`
          : `"${called}" is kept here, sealed, and will be handed to a machine when one is given work. The desk is empty again.`
      }
    }
  },

  claudeSignInCancel: {
    about: 'Abandon a sign-in the desk is part-way through',
    takes: ['name'],
    run: async ({ name }) => {
      const on = await whichSupervisor(name)
      await actions.vmAuthCancel.run({ name: on })
      return { name: on, cancelled: true, note: `The desk on ${on} is not waiting for a code any more.` }
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
      const r = await channel.run(name, auth.asDesk(auth.begin(seconds), DESK), { what: 'starting a sign-in at the desk', timeout: (seconds + 30) * 1000 })
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
      const r = await channel.run(name, auth.asDesk(auth.code(String(code).trim(), seconds), DESK), { what: 'finishing a sign-in at the desk', timeout: (seconds + 30) * 1000 })
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
      await channel.run(name, auth.asDesk(auth.cancel(), DESK), { what: 'abandoning a sign-in at the desk', timeout: 30000 })
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

      // THE LIST FIRST, because that is where sign-ins live now.
      //
      // This answered about one file, which is the shape the Keys tab was built
      // to and the shape that broke: one credential handed to every machine is
      // several workers rotating one token. Callers ask this on the draw loop for
      // "is there anything to hand out at all" — see ui/terminal.js — so the
      // answer keeps that field and gains a row per guest.
      //
      // A clock per guest, read from the credential itself, because "this host
      // holds four and one of them is dead" is not answerable from a total.
      // Guests only. This answers "is there anything to hand a machine", and a
      // supervisor is never handed to one.
      const held = guests.all().filter(g => g.role !== 'supervisor')

      // AND A COUNT OF THE OTHER KIND, WHICH IS NOT THE SAME QUESTION.
      //
      // The line above is right and was read as saying more than it says. The
      // window's draw loop asks this once and uses the answer for every "is
      // there a sign-in" it needs -- so a list that deliberately omits
      // supervisors was read as "there are none", and the banner told somebody
      // this host had no supervisor sign-in while one was sitting on the
      // Runners tab with a "here" badge on it.
      //
      // A COUNT AND A FLAG, not a row. Everything a supervisor sign-in can be
      // asked is already on its own pane; what belongs in an answer about
      // handing things out is whether there is one and whether it is free --
      // which is the difference between "one press" and "you have to go and
      // sign one in", and getting that wrong sends somebody to do a thing they
      // have already done.
      const sups = guests.all().filter(g => g.role === 'supervisor')
      // FROM THE ONE FUNCTION THAT DECIDES THIS, rather than a second reading
      // of the same list. Two answers to "is there a sign-in to give" that can
      // disagree is the exact bug this field was added to fix, and writing the
      // rule out again here would have reintroduced it a level down.
      const use = guests.supervisorKey()
      const supervisor = {
        kept: sups.length,
        // Not "one is free" but "one is available TO USE", which differs the
        // moment a choice has been made: an unchosen sign-in sitting free is not
        // something anything is going to reach for.
        free: !!use.key,
        using: use.inUse ? use.inUse.name : (use.key ? use.key.name : null),
        chosen: use.chosen,
        why: use.why,
        // Which machine has it, if any. A supervisor sign-in that is out is not
        // free and not missing, and those need different sentences.
        out: use.out || (sups.find(g => g.holder) || {}).holder || null
      }
      if (held.length) {
        return {
          held: held.some(g => g.has),
          dir: guests.ROOT(),
          // What each one is, and never what it says. Names, dates, fingerprints,
          // holders and clocks — the rule this whole surface is built to.
          guests: held.map(g => ({
            ...g,
            life: g.has ? credentialLife(guests.fileFor(g.name)) : { usable: null, why: 'there is no token file for it' }
          })),
          supervisor,
          note: `${held.length} Claude sign-in${held.length === 1 ? '' : 's'} kept here. One is lent per machine — see the Claude guest pane.`
        }
      }

      // NO GUESTS, WHICH IS NOT THE SAME AS NOTHING KEPT HERE. A host with a
      // supervisor sign-in and no workers falls through to here, and answering
      // it without the supervisor field would be the same mistake one branch
      // lower down.
      if (!fs.existsSync(file)) return { held: false, dir, guests: [], supervisor }
      let meta = {}
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'about.json'), 'utf8')) } catch { /* older ones have none */ }
      const stat = fs.statSync(file)
      return {
        held: true,
        supervisor,
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
    about: 'Take the signed-in credential from a machine and keep it here as a Claude guest',
    takes: ['name', 'guest'],
    run: async ({ name, guest = null }) => {
      const mine = vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      // WHICH IDENTITY THIS IS, decided before the machine is asked for it.
      //
      // A machine that already holds a guest is handing back THAT one — signed in
      // again by hand, or refreshed by the CLI — so it updates the guest rather
      // than making a second record of the same account. Anything else is a new
      // sign-in, named after the machine unless a name was given, because a list
      // of identities called "claude-code", "claude-code-2" is a list nobody can
      // read six weeks later.
      const into = mine.guest || String(guest || name).trim()
      const already = guests.get(into)
      if (already && already.holder && already.holder !== name) {
        throw new Error(`"${into}" is out on ${already.holder}. Take it back from there first — writing over it here would leave that machine signed in as an identity this host no longer has.`)
      }

      // AND WHAT KIND OF SIGN-IN IT IS, from what kind of machine it came off.
      //
      // A supervisor machine signs in as ITSELF: the identity that decides what
      // work there is, spent by the model doing the deciding. A runner signs in
      // as a worker. Taking one off a supervisor and filing it as a worker's
      // would put the supervising identity into the pool the runners draw from —
      // and the first queued task would spend it.
      //
      // Read from the tag, which is the one place this is decided and is
      // answerable with the machine switched off.
      const isSupervisor = (mine.tags || []).some(t => String(t).toLowerCase() === vms.SUPERVISOR)
      // The machine's own kind, so a credential grabbed off a judge machine is
      // filed as a judge's. `isSupervisor` could only ever say two of the three.
      //
      // AND A MACHINE THAT IS BOTH CANNOT SAY. Filing it as either would be this
      // host picking which pool somebody's credential joins, which is the whole
      // class of guess being removed -- so it asks.
      const canBe = vms.kindsOf(vms.get(name))
      if (canBe.length > 1) {
        throw new Error(`${name} is tagged ${canBe.join(' and ')}, so a credential taken off it could be filed as either. Say which with --role, or take the tag off that does not apply.`)
      }
      const role = canBe[0] || null
      if (!role) {
        throw new Error(`${name} has not been told what it is for, so a credential taken off it cannot be filed. Tag it "worker" or "judge" with vmTags first.`)
      }
      if (already && already.role !== role) {
        throw new Error(`"${into}" is a ${already.role} sign-in and ${name} is a ${isSupervisor ? 'supervisor machine' : 'runner'}. One of the two is wrong, and guessing which would put the deciding identity in the pool the workers draw from — or the other way round.`)
      }

      // Printed rather than copied out of a path this host cannot see. base64 so
      // a newline or a shell metacharacter in the file cannot change what
      // arrives.
      //
      // AND QUIET. base64 is not readable text and is still the credential —
      // this comment used to offer the first half as if it were the second. The
      // value does not reach the log at all now; the line saying this host read
      // one still does.
      const r = await channel.run(name, 'base64 -w0 ~/.claude/.credentials.json 2>/dev/null || echo OKC_NO_CREDENTIAL',
        { what: 'taking its worker credential', timeout: 60000, quiet: true })

      const b64 = String(r.output || '').split('\n').map(s => s.trim()).filter(Boolean).pop() || ''
      if (!b64 || b64 === 'OKC_NO_CREDENTIAL') {
        throw new Error(`"${name}" has no worker credential to take. Sign in on that machine first: open it and run "claude auth login".`)
      }

      // Sealed on the way in, so what lands on disk is not the token — see
      // core/secret.js. It was plain until somebody asked where it was kept, and
      // the honest answer was "readable by anything running as you, or as an
      // administrator, or by whatever backs this folder up".
      const text = Buffer.from(b64, 'base64').toString('utf8')

      const made = already
        // The same identity coming back. `backFrom` writes only when it differs
        // and reports which happened, which is the answer to "did signing in
        // again actually change anything".
        ? guests.backFrom(into, { token: text })
        : guests.add({
            name: into,
            token: text,
            role,
            from: `taken from ${name}`,
            note: isSupervisor ? 'the sign-in its supervisor decides work with' : 'signed in on a machine by hand'
          })

      // STILL ON THE MACHINE, because grabbing is copying and not moving. A
      // machine that was signed in by hand stays signed in until somebody takes
      // it away — vmCredentialsForget is the one that removes it — so the record
      // says it is holding, and it is holding this guest.
      //
      // FOR A SUPERVISOR THAT IS NOT A LOAN, IT IS WHERE IT LIVES. A runner is
      // rolled back to its base snapshot between tasks, so a credential on one
      // has to leave and come back; a supervisor is never rolled back, and taking
      // its sign-in away would sign out the thing that decides what work there
      // is. The record is the same either way — this machine holds that
      // identity — and what differs is that nothing takes a supervisor's back.
      // BY KIND, NOT BY A BOOLEAN. This was the last call site still passing
      // `supervisor: true/false`, which can say "supervisor or worker" and
      // cannot say "judge" — so lending a judge's sign-in to a judge machine was
      // refused with "kit-2 is a runner", about a machine tagged judge.
      //
      // Found by running it: J59 routed to the judge machine correctly and then
      // could not be given an identity at all. The selection had been taught the
      // rule and the recording had not.
      guests.lentTo(into, name, { kind: vms.kindsOf(vms.get(name)) })
      vms.update(name, { holdsCredential: true, guest: into })

      log.on('vm', name).good(already
        ? `its ${role === 'supervisor' ? 'supervisor' : 'worker'} credential was taken again into "${into}" — ${made.rotated ? 'and it had changed' : 'unchanged'}`
        : `its ${role === 'supervisor' ? 'supervisor sign-in is now kept here as' : 'worker credential is now the Claude guest'} "${into}"`)

      return {
        from: name,
        guest: into,
        // A fingerprint, never the token. Sixteen hex characters of sha256, which
        // says "the same one as before" and nothing else.
        fingerprint: made.fingerprint,
        rotated: already ? made.rotated : true,
        made: !already,
        note: already
          ? `"${into}" now holds what ${name} has${made.rotated ? ' — it had changed since it was lent out' : ', which is what it already had'}.`
          : `Kept as the Claude guest "${into}". Lend it with vmCredentialsPut and take it back with vmCredentialsForget.`
      }
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
      // Either place a sign-in can be: the list, or the single file on a host
      // that has not been moved over. vmCredentialsPut picks between them, so
      // this only has to know whether there is anything to pick.
      const file = path.join(data.sub('credentials'), 'claude.json')
      if (!guests.all().some(g => g.has && g.role !== 'supervisor') && !fs.existsSync(file)) {
        throw new Error('This host holds no worker credential, so there is nothing to test. Add a Claude guest on the Virtual machines tab, or sign a machine in and take it with vmCredentialsGrab.')
      }

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
    about: 'Hand a machine the sign-in for the work it is about to do. --role worker or judge, needed only when a machine is tagged as both',
    // `role` NAMES THE WORK, not the machine -- and is needed only for a
    // machine tagged as more than one thing. See the choice below.
    takes: ['name', 'role'],
    run: async ({ name, role = null }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      // WHICH IDENTITY THIS MACHINE IS SIGNED IN AS.
      //
      // There was one credential and every machine got it. There is a list now —
      // see core/guests.js — and this picks from it: the guest this machine
      // already has, or one that is free. Two machines therefore work as two
      // identities, which is the whole point: the CLI refreshes the token as a
      // worker runs, so a shared sign-in is two workers rotating one credential
      // underneath each other.
      //
      // The old single file is still the answer on a host that has not been
      // moved over yet, and `guests.adoptTheOldOne` moves it on the next start.
      const mine = vms.read().find(v => v.name === name) || {}
      // Supervisors are not in the running: one is the sign-in this host decides
      // work with, and a machine holding it would be a worker able to spend the
      // identity that supervises workers. core/guests.js refuses it too.
      // OF THE KIND THIS MACHINE IS, which is the half that was missing.
      //
      // core/guests.js REFUSES a mismatch — a worker's sign-in on a judge
      // machine, and the rest — and refusing is worth nothing if the thing that
      // CHOOSES does not know the rule. This picked any free non-supervisor
      // sign-in, so the first judgement dispatched to a judge machine would be
      // offered a worker's identity and then be refused it, minutes into a
      // dispatch, for a reason that reads like a bug.
      //
      // Found by the operator tagging two machines: the moment a judge machine
      // existed, judging was broken on a host whose only free sign-ins were
      // workers. The refusal was right and the selection had never been taught.
      // ---- WHICH KIND OF SIGN-IN THIS MACHINE IS BEING GIVEN --------------
      //
      // THE WORK DECIDES, NOT THE BOX. This asked the machine what it was and
      // handed over the matching identity, which is exactly right while a
      // machine is one thing. A machine tagged worker AND judge is two, and then
      // "what kind is this machine" has no answer -- it resolved to whichever
      // tag was checked first, so a dual machine would have been handed a
      // judge's credential for a task.
      //
      // So the caller says. The queue knows whether it is dispatching a task or
      // a judgement, which is the thing that actually determines whose identity
      // should go out.
      //
      // AND WHERE NOBODY SAYS, the machine answers if it can do so
      // unambiguously. A machine with one role is not made harder to use by a
      // feature for machines with two; one with two is refused, by name, rather
      // than being given a coin-flip.
      const canBe = vms.kindsOf(mine)
      const asked = role === 'worker' || role === 'judge' || role === 'supervisor' ? role : null
      if (asked && !canBe.includes(asked)) {
        throw new Error(`${name} cannot hold a ${asked}'s sign-in: it is ${canBe.length ? `tagged ${canBe.join(' and ')}` : 'not tagged for any role'}. Give it the "${asked}" tag with vmTags, or send this work to a machine that has it.`)
      }
      if (!asked && canBe.length > 1) {
        throw new Error(`${name} is tagged ${canBe.join(' and ')}, so which sign-in it should be handed depends on the work rather than on the machine. Say which with --role worker or --role judge.`)
      }
      const want = asked || canBe[0] || null
      if (!want) {
        throw new Error(`${name} has not been told what it is for, so there is no sign-in to give it. Tag it "worker" or "judge" with vmTags.`)
      }
      const held = guests.all().filter(g => g.role === want)

      // ---- ONE A MACHINE HAS ALREADY FAILED WITH IS NOT OFFERED AGAIN ------
      //
      // A credential that could not authenticate does not get better by being
      // tried on another machine. Left in the pool it is picked again, boots a
      // machine, lays out a workspace and fails minutes in -- and it is picked
      // FIRST if it happens to be first in the list, so one dead sign-in can
      // starve a host that has a working one.
      //
      // PAUSED RATHER THAN THROWN AWAY, because that is not this app's decision
      // to make: it is somebody's credential and the fix is a new sign-in, which
      // is a person at a login page. See checked() in core/guests.js -- signing
      // in again replaces the record and clears this by construction.
      // The predicate lives in core/guests.js now, because the QUEUE asks the
      // same question before it spends a machine and two readings of "has this
      // failed" is exactly how the two halves come to disagree.
      const dead = guests.paused
      const alive = held.filter(g => !dead(g))

      const wanted = mine.guest
        ? held.find(g => g.name === mine.guest)
        : alive.find(g => g.has && (!g.holder || g.holder === name))

      // AND SAID PLAINLY WHEN EVERY ONE OF THEM IS KNOWN BAD, which is a
      // different sentence from "none is free": nothing is out, they are dead,
      // and waiting will not help.
      if (!wanted && held.length && held.every(dead)) {
        const which = held.map(g => `"${g.name}" (${g.lastCheck.on || 'a machine'} could not authenticate with it${g.lastCheck.at ? `, ${String(g.lastCheck.at).slice(0, 16).replace('T', ' ')}` : ''})`).join('; ')
        const no = new Error(`Every ${want} sign-in this host holds has already failed on a machine: ${which}. They are paused rather than thrown away — sign in again on the Runners tab, which replaces the record. Nothing will spend a machine on these until then.`)
        // MARKED SO THE CALLER CAN TELL THIS APART FROM A MACHINE THAT BROKE.
        // The queue finishes a task whose setup failed, on the grounds that the
        // attempt happened and produced nothing — which is right for a machine
        // that would not boot and wrong for this: nothing was attempted, and
        // marking it done files "we learnt nothing" as an outcome. Read as a
        // flag rather than by matching the sentence above, because a sentence
        // is written for a person and gets rewritten for one.
        no.noIdentity = true
        throw no
      }

      // AND SAID PLAINLY WHEN THERE IS NONE OF THAT KIND AT ALL, because "every
      // guest is out" below is the wrong sentence for it: nothing is out, there
      // simply is not one, and the thing to do is add one rather than wait.
      if (!wanted && !held.length) {
        throw new Error(`"${name}" is ${want === 'judge' ? 'a judge machine' : want === 'supervisor' ? 'a supervisor machine' : 'a runner'} and this host holds no ${want} sign-in. A ${want} machine is lent a ${want}'s identity and nothing else — that is what keeps ${want === 'judge' ? 'reading a change and writing one on separate accounts' : 'the accounts separate'}. Add one on the Runners tab, or change what this machine is for with vmTags.`)
      }

      const file = wanted ? guests.fileFor(wanted.name) : path.join(data.sub('credentials'), 'claude.json')
      const chosen = wanted ? wanted.name : null

      if (!fs.existsSync(file)) {
        throw new Error(held.length
          ? `Every Claude guest is out on another machine: ${held.filter(g => g.holder).map(g => `${g.name} on ${g.holder}`).join(', ')}. Take one back, or add another — two machines cannot share one sign-in without rotating the same token underneath each other.`
          : 'This host has no worker credential yet. Add a Claude guest on the Runners tab, or sign in on a machine and take it with vmCredentialsGrab.')
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
      // this call and is never written back out in that form — and it is sealed
      // to a key the machine makes before any of it is sent. See
      // core/handover.js for what that replaced.
      const text = secret.read(file).toString('utf8')

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
      //
      // IN THE SAME ROUND TRIP AS THE HANDOVER, which is why it is passed as
      // `andThen` rather than sent on its own: the sealing costs one extra trip
      // already, and this call runs before every queued dispatch.
      // ---- AND WHO THE MACHINE IS WORKING AS -----------------------------
      //
      // SENT DOWN WITH THE FLAG, in the same file and the same round trip.
      // `~/.claude.json` is where Claude Code keeps the account, and a machine
      // rolled back to base has none -- so a worker knows it is authenticated
      // and not who as. That gap is exactly the one that made "claude doesn't
      // work with the auth key" so hard to read: two answers to one question,
      // from the same program, because they read different files.
      //
      // WHAT GOES DOWN IS WHAT CAME OFF THE DESK: an email address, an account
      // uuid, an organisation name. Identity, not authority -- nothing here lets
      // a machine do anything it could not do with the token alone, and the
      // token is already on it by this point.
      //
      // NULL FOR EVERY SIGN-IN MADE BEFORE THIS WAS KEPT, and then this is
      // simply not sent. A machine that is not told stays exactly as it was.
      // `chosen` rather than `wanted`, which is null on the path that falls back
      // to the single credential this host used to keep -- and a null there
      // would throw on the line that reads its name, inside the call that hands
      // every queued task its identity.
      const who = chosen ? ((guests.get(chosen) || {}).account || null) : null
      const sendWho = who && (who.email || who.uuid)
        ? `j.oauthAccount = Object.assign({}, j.oauthAccount, ${JSON.stringify({
            emailAddress: who.email || undefined,
            accountUuid: who.uuid || undefined,
            organizationName: who.organization || undefined
          })})`
        : '/* this host does not know whose sign-in this is */'

      const alsoDo = `node - <<'OKC_READY_EOF'
const fs = require('fs'), os = require('os')
const p = os.homedir() + '/.claude.json'
let j = {}
try { j = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { /* absent or unreadable: one key is the whole file */ }
j.hasCompletedOnboarding = true
${sendWho}
fs.writeFileSync(p, JSON.stringify(j))
OKC_READY_EOF
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
claude auth status 2>/dev/null || true

# AND THE MEANS TO WATCH WHAT IT DOES WITH IT.
#
# HERE BECAUSE THIS IS THE MOMENT. A credential arriving is the moment a machine
# becomes something a person would want to watch -- before it, there is nothing
# to see, and after it the work has already started. The window opens a tab when
# a sign-in goes out, so the thing that tab runs has to exist by then; written at
# dispatch instead, there is a gap where the tab lands on a machine that has not
# been given the watcher yet, and what somebody sees is an error where the work
# should be.
#
# Dispatch writes it again, per run, which is not waste: a run's own directory
# keeps its own copy so a finished run is still readable, and this one follows
# whichever run is current.
${dispatch.watcherFor(dispatch.RUNS, `${dispatch.RUNS}/current/out.log`)}

# AND THE SSH DOOR, RE-OPENED, BECAUSE A ROLLBACK SHUT IT.
#
# vmAuthorizeKey writes this app key into a machine authorized_keys, which is
# exactly right and exactly not durable: a runner is restored to its base
# snapshot after every task, and base predates the key. So the door was open
# until the next rollback and shut afterwards, while the registry went on saying
# the machine accepts it -- which is worse than never having placed it, because
# vmShell then offers a key that is refused and ssh reports Too many
# authentication failures about a machine with no keys at all.
#
# It is re-placed HERE, with the credential, for the reason the watcher is: this
# is the moment a machine becomes something a person watches, and it is the one
# moment that recurs after every rollback. A supervisor is never rolled back and
# needs it once; a runner needs it every time, and this is every time.
#
# Idempotent, and quiet about it -- see vmAuthorizeKey, which does the same
# thing as an action for a machine that is not about to be given work.
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh" && chmod 600 "$HOME/.ssh/authorized_keys"
grep -qxF '${String(ssh.publicKey() || '').trim()}' "$HOME/.ssh/authorized_keys" || printf '%s\\n' '${String(ssh.publicKey() || '').trim()}' >> "$HOME/.ssh/authorized_keys"`

      const r = await handover.deliver({
        run: (command, opts) => channel.run(name, command, opts),
        text,
        what: 'asking it for a key to hand a worker credential over with',
        andThen: alsoDo
      })

      // WHAT LANDED IS WHAT WAS SENT. The machine hashes the bytes it wrote and
      // this host hashes what it sealed; a handover that opened to anything else
      // stops here rather than being recorded as a signed-in machine.
      const mineIs = handover.fingerprint(text)
      if (r.fingerprint !== mineIs) {
        throw new Error(`"${name}" wrote ${r.fingerprint} where this host sealed ${mineIs}. Nothing is recorded as lent — that machine is not holding the credential this host thinks it is.`)
      }

      // WHO HAS WHAT, written down here rather than worked out later. A machine
      // that is switched off still has a credential on its disk, so "which guest
      // is on that machine" has to be answerable while it is off — and a guest
      // recorded as out is one that will not be handed to a second machine.
      if (chosen) guests.lentTo(chosen, name, { kind: vms.kindsOf(vms.get(name)) })
      vms.update(name, { holdsCredential: true, guest: chosen })

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
      // AND AGAINST THE SIGN-IN THAT WAS ACTUALLY TRIED. The line above keeps it
      // for the host as a whole, which is what there was when there was one
      // credential; with three, "something is dead" names nothing. See checked()
      // in core/guests.js.
      // AND WHAT IT SAID, WORD FOR WORD, when the answer was no.
      //
      // "signed out" is a state and not a diagnosis. The machine has the actual
      // sentence -- an OAuth session expired, a refresh refused, a version that
      // does not understand the file -- and those want different things done
      // about them. Thrown away here, it survived only in a run log on a machine
      // about to be rolled back, which is where this afternoon's went.
      //
      // TRIMMED, NOT SUMMARISED. Whatever the worker printed, up to a screenful,
      // kept against the credential it is about. A sentence somebody can search
      // for beats a category this app invented.
      const why = ready === false
        ? String(said || '')
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(x => x && !/^okc-credential-placed$/.test(x))
            .join(' ')
            .slice(0, 600) || null
        : null
      // A PROBE. It placed bytes and asked a worker to read them, which is worth
      // recording and is not worth as much as a run -- see checked().
      if (ready !== null && chosen) guests.checked(chosen, { ready, on: name, why, code: r.code, how: 'probe' })

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

  // ---- GETTING ONE BACK OFF A MACHINE THAT IS NOT RUNNING -------------------
  //
  // The banner has said this for a while and there was nothing to press: "X is
  // powered off and still holding a worker credential — start it, take the
  // credential back, and shut it down again". Three steps, in an order that
  // matters, that somebody has to do by hand at the moment they least want a
  // procedure. It happened on this host after a Windows update stopped a machine
  // outside the ordinary sequence.
  //
  // WHY IT CANNOT JUST BE FORGOTTEN. The copy on that disk may be NEWER than the
  // one here: the CLI rotates its refresh token as a worker runs, and the only
  // way that rotation comes home is reading the file off the machine. Marking it
  // back without reading throws away the newest token this host will ever see,
  // and then hands out an older one until it dies.
  //
  // IT PUTS THE MACHINE BACK AS IT FOUND IT. Started to be read and stopped
  // again — a machine that was off is off afterwards. One that was already
  // running is left running: it may be being used, and this is a repair rather
  // than a tidy-up.
  credentialRecover: {
    about: 'Start a machine that is holding a sign-in, take it back with whatever the worker refreshed, and leave the machine as it was found',
    takes: ['name'],
    run: async ({ name }) => {
      const vm = vms.get(name)
      const live = ((await actions.vmList.run({})).vms || []).find(v => v.name === name) || {}
      if (!vm.holdsCredential && !live.holdsCredential) {
        throw new Error(`"${name}" is not recorded as holding a sign-in, so there is nothing to take back.`)
      }

      const wasRunning = live.state === 'running'
      const did = []

      // STARTED AND WAITED FOR, because a credential cannot be read off a
      // machine that is not talking yet. supervisorMachine does both and is the
      // one place that decision lives — but it is for supervisors, so this does
      // the same two steps through the same actions.
      if (!wasRunning) {
        await actions.vmStart.run({ name })
        did.push('started it')
        // The channel is what "reachable" means here. Waited for rather than
        // assumed: vmStart returns when the kernel speaks, which is before the
        // agent has dialled in.
        const until = Date.now() + 180000
        while (Date.now() < until && !channel.connected(name)) {
          await new Promise(r => setTimeout(r, 2000))
        }
        if (!channel.connected(name)) {
          throw new Error(`"${name}" started but has not dialled in, so its sign-in still cannot be read. It is running now — try again, or take it back by hand once it connects.`)
        }
        did.push('waited for it to dial in')
      }

      // THE ONE THAT READS BEFORE IT DELETES. See vmCredentialsForget: it reads
      // the file, hands what it finds to the guest list, and only then removes
      // it from the machine.
      const back = await actions.vmCredentialsForget.run({ name })
      did.push(back.rotated
        ? `took the sign-in back, refreshed — ${back.fingerprint}`
        : 'took the sign-in back unchanged')

      // AS IT WAS FOUND. A machine somebody had running stays running.
      if (!wasRunning) {
        await actions.vmStop.run({ name })
        did.push('stopped it again')
      }

      return {
        name,
        rotated: !!back.rotated,
        fingerprint: back.fingerprint || null,
        wasRunning,
        did,
        note: `${name}: ${did.join(', and ')}.` + (back.rotated
          ? ' That token was newer than the one here — it would have been lost.'
          : ' It was the same token this host already had.')
      }
    }
  },

  vmCredentialsForget: {
    about: 'Take the worker credential off a machine, keeping whatever the worker refreshed',
    takes: ['name'],
    run: async ({ name }) => {
      const mine = vms.get(name)

      // WHETHER THERE WAS ANYTHING TO TAKE, asked before anything is done and
      // used only to decide whether to SAY so.
      //
      // This is called more than once for one machine -- a test takes the
      // credential back, and putting the machine away takes it back again --
      // and the second call is a no-op that announced itself anyway: "kit-2 no
      // longer holds a credential", about a machine that had not been holding
      // one for a second by then. Harmless and untrue, and it was invisible
      // until the message started naming the sign-in, at which point the record
      // showed the same machine giving up two different things.
      //
      // THE WORK IS NOT SKIPPED, only the sentence. The record saying a machine
      // holds nothing is not proof that the file is gone -- drift is exactly
      // what this call exists to clean up -- so it still goes through the
      // removal and still refuses if it cannot reach the machine.
      const hadSomething = !!(mine.guest || mine.holdsCredential)

      // READ BEFORE IT IS REMOVED, which this did not do and which cost the
      // credential this host was holding.
      //
      // The Claude CLI refreshes the token as a worker runs, so what is on the
      // machine at the end is newer than what went on. This deleted it — `rm -f`
      // and nothing else — so every rotation was thrown away and the host went on
      // handing out a token one or more refreshes behind. That is the failure on
      // record: credentialsHeld reporting the refresh half good until September
      // while the worker answered "OAuth session expired and could not be
      // refreshed".
      //
      // Only for a machine holding a GUEST. A host still on the single file has
      // nowhere to put a newer one, and writing it back into the old path would
      // be maintaining the thing being replaced.
      let text = null
      if (mine.guest && channel.connected(name)) {
        // QUIET — see machines/channel.js. What a machine prints is reported
        // back and logged, so reading a credential file logs a credential.
        const said = await channel.run(name, 'cat "$HOME/.claude/.credentials.json" 2>/dev/null || true',
          { what: 'reading what the worker refreshed, before taking it back', timeout: 60000, quiet: true })
        const body = String(said.output || '').split('\n').slice(1).join('\n').trim()
        if (body.startsWith('{')) text = body

        // ---- AND WHOSE SIGN-IN THIS TURNED OUT TO BE --------------------
        //
        // ONLY WHEN IT IS NOT ALREADY KNOWN, so this is one extra round trip
        // once in the life of a sign-in rather than one at the end of every
        // run. A key signed in at the desk arrives knowing already and never
        // reaches this.
        //
        // WHY IT IS WORTH THE TRIP: the alternative for a credential made
        // before the account was kept is to sign it in again, which throws away
        // a working credential to obtain a label -- and, if it happens to be the
        // same Claude account as another here, invalidates one of the two. This
        // costs a `cat` on a machine that is already dialled in and about to be
        // shut down anyway.
        const known = guests.get(mine.guest)
        if (known && !(known.account && (known.account.email || known.account.uuid))) {
          try {
            const who = await channel.run(name, 'cat "$HOME/.claude.json" 2>/dev/null || true',
              { what: 'reading which account the worker authenticated as', timeout: 30000, quiet: true })
            const raw = String(who.output || '').split('\n').slice(1).join('\n').trim()
            const found = raw.startsWith('{') ? guests.accountOf(raw) : null
            const got = found ? guests.noteAccount(mine.guest, found) : null
            if (got && got.learned) {
              log.on('vm', name).good(`the Claude guest "${mine.guest}" is ${found.email || found.uuid}${found.organization ? ` — ${found.organization}` : ''}, learned from this run rather than by signing it in again`)
            }
          } catch { /* a sign-in without a name on it is still a sign-in */ }
        }
      }

      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      const r = await channel.run(name, 'rm -f "$HOME/.claude/.credentials.json" && echo okc-credential-gone',
        { what: 'taking its worker credential away', timeout: 60000 })
      if (!/okc-credential-gone/.test(r.output || '')) throw new Error(`"${name}" still has it.`)

      let rotated = false
      if (mine.guest) {
        const now = guests.backFrom(mine.guest, { token: text })
        rotated = now.rotated
        // LOUD, BECAUSE IT IS THE ONLY WARNING THAT A MACHINE JUST TRIED TO
        // DESTROY A SIGN-IN. The credential survives, and the run that emptied
        // it did not — so this is the sentence that connects "a judgement
        // failed" to "and it took the credential with it" when somebody reads
        // the record afterwards.
        if (now.refused) log.on('vm', name).bad(now.refused)
        else {
          log.on('vm', name)[rotated ? 'good' : 'info'](rotated
            ? `the Claude guest "${mine.guest}" came back refreshed — ${now.fingerprint}`
            : `the Claude guest "${mine.guest}" came back unchanged`)
        }
      }

      vms.update(name, { holdsCredential: false, guest: null })
      // NAMED, RATHER THAN CALLED A WORKER'S WHATEVER IT WAS. This said "a
      // worker credential" for every machine including a supervisor holding a
      // supervisor sign-in -- read afterwards, the record said the wrong kind of
      // credential had come off the wrong kind of machine. `mine.guest` is read
      // above and cleared on the line before, so it is taken while it is still
      // there.
      if (hadSomething) {
        log.on('vm', name).good(mine.guest
          ? `${name} no longer holds the sign-in "${mine.guest}"`
          : `${name} no longer holds a credential`)
      }
      return { from: name, removed: true, guest: mine.guest || null, rotated, kept: text !== null }
    }
  },
}
