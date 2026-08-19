'use strict'

// The Claude identities this host holds, as actions.
//
// See core/guests.js for what a guest IS and why there is a list rather than one
// file. These are the four things anybody does with that list: read it, add one,
// take one away, and lend one to a machine.
//
// NOTHING HERE HANDS BACK A TOKEN. Every answer is a name, a date, a
// fingerprint and a holder — the same rule the Keys tab is built to, which is
// that a model may know something was done in there without knowing what. The
// one call that reads a value is `guestLend`, and it writes it onto a machine
// rather than returning it.

const guests = require('../core/guests')
const handover = require('../core/handover')
// A secret sealed to a passphrase rather than to this Windows account, so a
// backup can be restored somewhere else. See core/portable.js.
const portable = require('../core/portable')
const s = require('./shared')
const { log, vms, channel, dispatch, fs, path } = s

module.exports = {
  guests: {
    about: 'The Claude identities this host holds — one per name, each with a sealed token',
    // Both roles by default, because "what sign-ins does this host have" is one
    // question and answering half of it silently is how a duplicate gets added.
    // The two panes ask for one role each. See core/guests.js.
    takes: ['role'],
    run: ({ role = null } = {}) => {
      // ONCE, AND THEN NEVER AGAIN. See ensurePlans: it writes the plan into any
      // record made before that was kept and is a cheap no-op afterwards. Here
      // because this is the one door every list goes through, and a fact filled
      // in on the way out cannot be forgotten by a caller that did not know to
      // ask for it.
      try { guests.ensurePlans() } catch { /* a missing label is not worth failing a list for */ }

      const all = role ? guests.all().filter(g => g.role === role) : guests.all()
      const sups = all.filter(g => g.role === 'supervisor').length
      return {
        guests: all,
        held: all.filter(g => g.has).length,
        lent: all.filter(g => g.holder).length,
        supervisors: sups,
        where: guests.ROOT(),
        // SAID IN THE WORDS OF THE ROLE ASKED FOR. This answered "guest" whatever
        // was asked, which was fine while there were two roles and one of them
        // was called that. With three it told a judge pane about guests.
        note: !all.length
          ? (role === 'supervisor'
              ? 'No supervisor sign-in yet. A supervisor is the identity this host works with itself, rather than one lent to a machine.'
              : role === 'judge'
                ? 'No judge sign-in yet. A judge machine is lent one of these and nothing else, which is what keeps "who said this work holds" separate from "who wrote it".'
                : 'No worker sign-in yet. A worker is a Claude sign-in kept here under a name — add one with its token, and a machine can be lent it.')
          : role === 'supervisor'
            ? `${all.length} supervisor sign-in${all.length === 1 ? '' : 's'}. A supervisor is spent by this host and never lent to a machine.`
            : `${all.length} ${role || 'worker'} sign-in${all.length === 1 ? '' : 's'}. It is lent to a machine while it works and taken back after, so two machines never share one.`
      }
    }
  },

  guestAdd: {
    about: 'Keep a Claude token here under a name. It is sealed to this account and never shown again',
    takes: ['name', 'token', 'note', 'role'],
    run: ({ name, token, note, role }) => {
      const made = guests.add({ name, token, note: note || null, from: 'typed in', role: role || 'worker' })
      // The name and the fingerprint, never the token. This line is kept in the
      // durable record, so it has to be safe to read six weeks later.
      log.on('keys').good(`a Claude ${made.role} called "${made.name}" was added — ${made.fingerprint}`)
      return {
        ...made,
        note: `"${made.name}" is kept, sealed to this Windows account. Nothing shows it again — what is reported from here is a name, a date and a fingerprint.`
      }
    }
  },

  guestRole: {
    about: 'Change what a Claude sign-in is for: a worker, a judge, or a supervisor. The token is untouched',
    takes: ['name', 'role'],
    run: ({ name, role }) => {
      // A RELABELLING, NOT A REPLACEMENT. Nothing is re-sealed and nothing is
      // read; the fingerprint afterwards is the same one, which is how somebody
      // can tell this did what it says. See roleOf in core/guests.js for the two
      // things it refuses: a sign-in that is out on a machine, and the one the
      // supervisor is set to use.
      const was = guests.get(name)
      if (!was) throw new Error(`There is no sign-in called "${name}".`)
      const now = guests.roleOf(name, role)

      log.on('keys').good(`the Claude sign-in "${name}" is a ${now.role} now${was.role === now.role ? '' : ` — it was a ${was.role}`}`)
      return {
        ...now,
        was: was.role,
        note: was.role === now.role
          ? `"${name}" was already a ${now.role}.`
          : `"${name}" is a ${now.role} now, and can be lent to a ${now.role === 'supervisor' ? 'supervisor machine' : `${now.role} machine`} and nothing else. Its token was not touched — the fingerprint is the same one.`
      }
    }
  },

  guestForget: {
    about: 'Throw a Claude identity away, token and all',
    takes: ['name'],
    run: ({ name }) => {
      const gone = guests.forget(name)
      log.on('keys').warn(`the Claude guest "${gone.forgotten}" was thrown away`)
      return { ...gone, note: `"${gone.forgotten}" is gone. Anything that was using it will have to be given another.` }
    }
  },

  // ---- lending one to a machine -------------------------------------------
  //
  // The same act `vmCredentialsPut` does with the single credential, against a
  // named guest instead — and it records WHO has it, which is the half that was
  // missing. A machine that is switched off still has a credential on its disk,
  // so "which guest is on that machine" has to be answerable while it is off.
  guestLend: {
    about: 'Lend a guest to a machine, so a worker on it can authenticate',
    takes: ['name', 'machine'],
    run: async ({ name, machine }) => {
      const guest = guests.get(name)
      if (!guest) throw new Error(`There is no guest called "${name}".`)

      // BEFORE THE MACHINE IS EVEN TOUCHED, and the order is the point.
      //
      // core/guests.js refuses a mismatched pair as well, but it refuses at
      // `lentTo` — which runs AFTER the credential has been written onto the
      // machine. So the throw would arrive with the token already on a disk and
      // nothing on this host recording that it is there: refused, and handed
      // over anyway. A drill found this by asking for a machine that does not
      // exist and being refused for that instead.
      //
      // The rule is that the ROLES MATCH: a supervisor sign-in belongs on a
      // supervisor machine and nowhere else, and a worker's belongs on a runner.
      // Asked of the one function that knows it, so the sentence is the same
      // here as it is there.
      //
      // READ RATHER THAN DEMANDED, and that is the difference between this
      // refusing for the right reason and the wrong one. `vms.get` throws for a
      // machine this app did not make — so asking it first means a supervisor
      // named against an unknown machine is refused for the MACHINE, and the role
      // is never reached. The drill asks with a machine that does not exist for
      // exactly that reason, and it went back to failing when this line became a
      // `get`.
      //
      // From the TAG, which is what everything else reads and is answerable with
      // the machine switched off. An unknown machine has no tags, so it is not a
      // supervisor machine, which is the right answer to be refused by.
      const mine = vms.read().find(v => v.name === machine) || {}
      const isSupervisor = (mine.tags || []).some(t => String(t).toLowerCase() === vms.SUPERVISOR)
      // WHICH KIND OF MACHINE THIS IS, asked of vms rather than worked out here.
      // A judge is the third kind and a boolean cannot carry it; see kindOf.
      const machineKind = vms.kindOf(mine)
      const why = guests.whyNotOn(guest.role, machineKind, name, machine)
      if (why) throw new Error(why)

      // AND THEN THE MACHINE, so a worker lent to something that does not exist
      // still gets the sentence that says so.
      vms.get(machine)

      if (!guest.has) throw new Error(`"${name}" has no token file any more. It was removed by hand, or sealed by another account.`)
      if (!channel.connected(machine)) throw new Error(`"${machine}" is not dialled in. Start it and wait for it to connect.`)

      // ONE MACHINE AT A TIME, which is the whole reason this list exists. A
      // guest already out is refused rather than copied: two machines running as
      // the same identity is the thing being prevented.
      if (guest.holder && guest.holder !== machine) {
        throw new Error(`"${name}" is on ${guest.holder}. Take it back first — two machines holding one sign-in refresh the same token underneath each other, which is how a credential dies.`)
      }

      const text = guests.token(name)

      // SEALED TO A KEY THIS MACHINE MAKES WHILE WE WAIT. It used to travel as a
      // base64 argument on a command line, which is `ps` output to every user on
      // that machine and a line in a shell history. See core/handover.js.
      // AND THE MEANS TO WATCH WHAT IT DOES WITH IT, in the same round trip.
      //
      // A sign-in landing on a machine is the moment that machine becomes worth
      // watching, and it is the moment the window opens a tab for it -- so what
      // that tab runs has to be there already. Which box depends on what the
      // machine is FOR: a supervisor's turns and a runner's runs are written by
      // different halves of this app into different directories, and each has
      // its own link to whatever is current.
      const box = isSupervisor ? dispatch.SUPERVISOR : dispatch.RUNS
      // NOT `log`, WHICH IS THE LOGGER THIS FILE ALREADY HAS.
      //
      // It was called that, and it shadowed `log` from the top of the file for
      // the rest of the function -- so twenty lines further down, the line that
      // records the machine as holding a sign-in threw `log.on is not a
      // function` and took the whole lending with it. A drill found it; nothing
      // else would have, because the throw is after the credential has already
      // landed on the machine and been checked.
      //
      // `node --check` passes on this and so does every reading of the line in
      // isolation: it is not an undeclared name, it is a declared one meaning
      // something else. The only defence is not to reuse the word.
      const logFile = isSupervisor ? `${box}/current.log` : `${box}/current/out.log`

      const done = await handover.deliver({
        run: (command, opts) => channel.run(machine, command, opts),
        text,
        what: `lending it the Claude guest "${name}"`,
        andThen: dispatch.watcherFor(box, logFile)
      })

      // AND WHAT LANDED IS WHAT WAS SENT, asked by fingerprint — the same sixteen
      // characters the list keeps, computed on the machine from the bytes it
      // actually wrote. Anything else means a handover that reported success
      // while placing something else.
      const mineIs = handover.fingerprint(text)
      if (done.fingerprint !== mineIs) {
        throw new Error(`"${machine}" wrote ${done.fingerprint} where "${name}" is ${mineIs}. The credential was sealed to that machine's key and what it opened is not what was sent — nothing on this host records it as lent.`)
      }

      guests.lentTo(name, machine, { kind: machineKind })
      vms.update(machine, { holdsCredential: true, guest: name })
      log.on('vm', machine).warn(`${machine} is holding the Claude guest "${name}" — it cannot be snapshotted until that is taken back`)
      return { name, machine, note: `${machine} is signed in as "${name}". Take it back with guestBack before the machine is snapshotted or put away.` }
    }
  },

  // ---- KEEPING THEM ---------------------------------------------------------
  //
  // WHY A BACKUP IS NOT OPTIONAL HERE. A Claude sign-in is not reproducible: it
  // comes from a person at a login page, and once the refresh token is gone the
  // only way back is to do that again. This host has now had one credential die
  // outright, and the way it was discovered was a judge failing on a machine
  // twenty minutes into a run.
  //
  // AND WHAT IS BACKED UP IS THE LATEST, WHICH IS THE HARD PART. The CLI rotates
  // its refresh token as a worker runs, so the freshest copy of a credential
  // that is OUT lives on the machine, not here. Backing up while one is lent is
  // backing up a token that may already have been superseded — so this says so
  // rather than quietly writing a stale one.
  guestBackup: {
    about: 'Write every Claude sign-in to one file, sealed with a passphrase, so they survive this computer',
    takes: ['to', 'passphrase'],
    run: ({ to, passphrase }) => {
      const where = String(to || '').trim()
      if (!where) throw new Error('Say where to write it — a path to a file. It holds credentials, so put it somewhere you would put a password.')

      const all = guests.all()
      if (!all.length) throw new Error('There is nothing to back up: this host holds no Clau'+'de sign-in.')

      // OUT ON A MACHINE MEANS THE NEWEST IS NOT HERE. Named rather than
      // refused: a backup of a slightly older token is worth having, and being
      // told which ones is what lets somebody take them back first and run this
      // again.
      const lent = all.filter(g => g.holder)

      const kept = []
      for (const g of all) {
        if (!g.has) continue
        kept.push({
          name: g.name,
          role: g.role,
          note: g.note || null,
          added: g.added,
          from: g.from || null,
          // THE FINGERPRINT TRAVELS IN THE CLEAR, deliberately: it is sixteen
          // characters of sha256 and useless for anything except saying "this is
          // the same token" — which is exactly what somebody restoring needs to
          // check without opening anything.
          fingerprint: g.fingerprint,
          sealed: portable.seal(passphrase, guests.token(g.name))
        })
      }

      const file = {
        v: 'okc-guests-1',
        at: new Date().toISOString(),
        count: kept.length,
        // No host name, no account, no paths. A backup that says where it came
        // from is a backup that tells whoever finds it where to go next.
        guests: kept
      }

      fs.mkdirSync(path.dirname(where), { recursive: true })
      fs.writeFileSync(where, JSON.stringify(file, null, 2))

      log.on('keys').good(`backed up ${kept.length} Cla`+`ude sign-in(s)`)
      return {
        to: where,
        count: kept.length,
        names: kept.map(k => k.name),
        // Said back so somebody can check the file against the list without
        // opening it.
        fingerprints: Object.fromEntries(kept.map(k => [k.name, k.fingerprint])),
        lentOut: lent.map(g => `${g.name} is on ${g.holder}`),
        note: lent.length
          ? `Written. ${lent.length} of them ${lent.length === 1 ? 'is' : 'are'} out on a machine right now — the CLI rotates a token as a worker runs, so what was saved for ${lent.map(g => g.name).join(', ')} may be one rotation behind. Take them back and run this again to be sure.`
          : 'Written. Nothing is out on a machine, so every token in it is the newest this host has.'
      }
    }
  },

  guestRestore: {
    about: 'Put Clau'+'de sign-ins back from a backup file, sealed to this computer again',
    takes: ['from', 'passphrase', 'replace'],
    run: ({ from, passphrase, replace }) => {
      const where = String(from || '').trim()
      if (!where) throw new Error('Say which file to read.')
      if (!fs.existsSync(where)) throw new Error(`There is no file at "${where}".`)

      let file = null
      try { file = JSON.parse(fs.readFileSync(where, 'utf8')) } catch (e) { throw new Error(`That file is not readable as a backup: ${e.message}`) }
      if (!file || file.v !== 'okc-guests-1' || !Array.isArray(file.guests)) {
        throw new Error('That is not a sign-in backup written by this app.')
      }

      const here = new Map(guests.all().map(g => [g.name, g]))
      const put = []
      const skipped = []

      for (const one of file.guests) {
        const already = here.get(one.name)
        if (already && !replace) {
          // NOT OVERWRITTEN BY DEFAULT, because the one here may be NEWER: it
          // has been out on machines since the backup was taken, and each of
          // those runs may have rotated it. Restoring over it would replace a
          // working token with an older one, which is the exact failure this
          // whole area keeps producing.
          skipped.push(`${one.name} is already here (${already.fingerprint}) — pass replace to put the backup's copy over it`)
          continue
        }

        // Opened one at a time, so a wrong passphrase fails on the first rather
        // than after writing half of them.
        const token = portable.open(passphrase, one.sealed)

        if (already) {
          try { guests.forget(one.name) } catch (e) { skipped.push(`${one.name} could not be replaced: ${e.message}`); continue }
        }
        const made = guests.add({
          name: one.name,
          token,
          role: one.role,
          from: one.from || 'a backup',
          note: one.note || null
        })
        put.push({
          name: made.name,
          role: made.role,
          fingerprint: made.fingerprint,
          // SAID WHEN IT DOES NOT MATCH, which would mean the file was written
          // by something else or has been altered. The fingerprint is the only
          // check available that does not involve showing anybody a token.
          asBackedUp: one.fingerprint,
          same: made.fingerprint === one.fingerprint
        })
      }

      log.on('keys').good(`restored ${put.length} sign-in(s) from a backup`)
      return {
        from: where,
        restored: put,
        skipped,
        note: put.length
          ? `${put.length} restored and sealed to this computer.${skipped.length ? ` ${skipped.length} left alone.` : ''}`
          : 'Nothing was restored — everything in that file is already here. Pass replace to put the backup over what is here.'
      }
    }
  },

  guestBack: {
    about: 'Take a guest back off a machine, keeping whatever the worker refreshed',
    takes: ['name', 'machine'],
    run: async ({ name, machine }) => {
      const guest = guests.get(name)
      if (!guest) throw new Error(`There is no guest called "${name}".`)
      const on = machine || guest.holder
      if (!on) throw new Error(`"${name}" is not out on any machine.`)
      vms.get(on)

      // TAKEN, NOT DELETED, and this is the whole point of the call.
      //
      // `vmCredentialsForget` ends a run with `rm -f`, so everything the Claude
      // CLI refreshed while the worker was running is thrown away and this host
      // goes on handing out a token that is one or more rotations behind. That
      // is the failure already on record: a refresh half reported good until
      // September while the worker was answering "OAuth session expired".
      let text = null
      if (channel.connected(on)) {
        // QUIET, and this is the call that proved why it had to exist. The guest
        // reports what a command printed, so `cat` of the credential file put an
        // access token and a refresh token straight into the live log — which
        // the window draws and `windowShot` photographs. The caller still gets
        // every byte; the log gets the act and not the value.
        const said = await channel.run(on,
          'cat "$HOME/.claude/.credentials.json" 2>/dev/null || true',
          { what: `taking the Claude guest "${name}" back`, timeout: 60000, quiet: true })
        const body = String(said.output || '').split('\n').slice(1).join('\n').trim()
        if (body.startsWith('{')) text = body

        await channel.run(on, 'rm -f "$HOME/.claude/.credentials.json" && echo okc-guest-gone',
          { what: 'clearing the credential off it', timeout: 60000 })
      }

      const now = guests.backFrom(name, { token: text })
      vms.update(on, { holdsCredential: false, guest: null })
      log.on('vm', on)[now.rotated ? 'good' : 'info'](now.rotated
        ? `the Claude guest "${name}" came back refreshed — ${now.fingerprint}`
        : `the Claude guest "${name}" came back unchanged`)

      return {
        name,
        machine: on,
        rotated: now.rotated,
        fingerprint: now.fingerprint,
        reached: text !== null,
        note: text === null
          ? `${on} could not be read, so "${name}" is marked as back without anything being kept. If that machine had a newer token, it went with the rollback.`
          : now.rotated
            ? `"${name}" was refreshed while it was out, and the newer one is kept. Fingerprint ${now.fingerprint}.`
            : `"${name}" came back exactly as it went out.`
      }
    }
  }
}
