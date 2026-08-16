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
const s = require('./shared')
const { log, vms, channel } = s

module.exports = {
  guests: {
    about: 'The Claude identities this host holds — one per name, each with a sealed token',
    run: () => {
      const all = guests.all()
      return {
        guests: all,
        held: all.filter(g => g.has).length,
        lent: all.filter(g => g.holder).length,
        where: guests.ROOT(),
        note: all.length
          ? `${all.length} guest${all.length === 1 ? '' : 's'}. A guest is lent to a machine while it works and taken back after, so two machines never share one sign-in.`
          : 'None yet. A guest is a Claude sign-in kept here under a name — add one with its token, and a machine can be lent it.'
      }
    }
  },

  guestAdd: {
    about: 'Keep a Claude token here under a name. It is sealed to this account and never shown again',
    takes: ['name', 'token', 'note'],
    run: ({ name, token, note }) => {
      const made = guests.add({ name, token, note: note || null, from: 'typed in' })
      // The name and the fingerprint, never the token. This line is kept in the
      // durable record, so it has to be safe to read six weeks later.
      log.on('keys').good(`a Claude guest called "${made.name}" was added — ${made.fingerprint}`)
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
      if (!guest.has) throw new Error(`"${name}" has no token file any more. It was removed by hand, or sealed by another account.`)
      vms.get(machine)
      if (!channel.connected(machine)) throw new Error(`"${machine}" is not dialled in. Start it and wait for it to connect.`)

      // ONE MACHINE AT A TIME, which is the whole reason this list exists. A
      // guest already out is refused rather than copied: two machines running as
      // the same identity is the thing being prevented.
      if (guest.holder && guest.holder !== machine) {
        throw new Error(`"${name}" is on ${guest.holder}. Take it back first — two machines holding one sign-in refresh the same token underneath each other, which is how a credential dies.`)
      }

      const text = guests.token(name)
      // Written the way vmCredentialsPut writes it, which is the path that
      // exists and works today. That it travels as an argument is a known fault
      // with a draft of its own — see the credential suite.
      const b64 = Buffer.from(text, 'utf8').toString('base64')
      const said = await channel.run(machine,
        'mkdir -p "$HOME/.claude" && ' +
        `printf '%s' '${b64}' | base64 -d > "$HOME/.claude/.credentials.json" && ` +
        'chmod 600 "$HOME/.claude/.credentials.json" && echo okc-guest-lent',
        { what: `lending it the Claude guest "${name}"`, timeout: 60000 })

      if (!/okc-guest-lent/.test(said.output || '')) {
        throw new Error(`"${machine}" did not take the credential: ${String(said.output || '').slice(-200)}`)
      }

      guests.lentTo(name, machine)
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
