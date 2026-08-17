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
const s = require('./shared')
const { log, vms, channel } = s

module.exports = {
  guests: {
    about: 'The Claude identities this host holds — one per name, each with a sealed token',
    // Both roles by default, because "what sign-ins does this host have" is one
    // question and answering half of it silently is how a duplicate gets added.
    // The two panes ask for one role each. See core/guests.js.
    takes: ['role'],
    run: ({ role = null } = {}) => {
      const all = role ? guests.all().filter(g => g.role === role) : guests.all()
      const sups = all.filter(g => g.role === 'supervisor').length
      return {
        guests: all,
        held: all.filter(g => g.has).length,
        lent: all.filter(g => g.holder).length,
        supervisors: sups,
        where: guests.ROOT(),
        note: !all.length
          ? (role === 'supervisor'
              ? 'No supervisor sign-in yet. A supervisor is the identity this host works with itself, rather than one lent to a machine.'
              : 'None yet. A guest is a Claude sign-in kept here under a name — add one with its token, and a machine can be lent it.')
          : role === 'supervisor'
            ? `${all.length} supervisor sign-in${all.length === 1 ? '' : 's'}. A supervisor is spent by this host and never lent to a machine.`
            : `${all.length} guest${all.length === 1 ? '' : 's'}. A guest is lent to a machine while it works and taken back after, so two machines never share one sign-in.`
      }
    }
  },

  guestAdd: {
    about: 'Keep a Claude token here under a name. It is sealed to this account and never shown again',
    takes: ['name', 'token', 'note', 'role'],
    run: ({ name, token, note, role }) => {
      const made = guests.add({ name, token, note: note || null, from: 'typed in', role: role || 'guest' })
      // The name and the fingerprint, never the token. This line is kept in the
      // durable record, so it has to be safe to read six weeks later.
      log.on('keys').good(`a Claude ${made.role} called "${made.name}" was added — ${made.fingerprint}`)
      return {
        ...made,
        note: `"${made.name}" is kept, sealed to this Windows account. Nothing shows it again — what is reported from here is a name, a date and a fingerprint.`
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
      const why = guests.whyNotOn(guest.role, isSupervisor, name, machine)
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
      const done = await handover.deliver({
        run: (command, opts) => channel.run(machine, command, opts),
        text,
        what: `lending it the Claude guest "${name}"`
      })

      // AND WHAT LANDED IS WHAT WAS SENT, asked by fingerprint — the same sixteen
      // characters the list keeps, computed on the machine from the bytes it
      // actually wrote. Anything else means a handover that reported success
      // while placing something else.
      const mineIs = handover.fingerprint(text)
      if (done.fingerprint !== mineIs) {
        throw new Error(`"${machine}" wrote ${done.fingerprint} where "${name}" is ${mineIs}. The credential was sealed to that machine's key and what it opened is not what was sent — nothing on this host records it as lent.`)
      }

      guests.lentTo(name, machine, { supervisor: isSupervisor })
      vms.update(machine, { holdsCredential: true, guest: name })
      log.on('vm', machine).warn(`${machine} is holding the Claude guest "${name}" — it cannot be snapshotted until that is taken back`)
      return { name, machine, note: `${machine} is signed in as "${name}". Take it back with guestBack before the machine is snapshotted or put away.` }
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
        const said = await channel.run(on,
          'cat "$HOME/.claude/.credentials.json" 2>/dev/null || true',
          { what: `taking the Claude guest "${name}" back`, timeout: 60000 })
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
