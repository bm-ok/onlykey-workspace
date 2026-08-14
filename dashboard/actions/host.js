'use strict'

// What belongs to this computer rather than to any workspace: its keys,
// the machines it can reach over ssh, and the editor it opens.
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
  archive, files, prompts, defined, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s

module.exports = {
  sshKey: {
    about: "This app's own ssh key — the one that gets into the machines it makes",
    run: () => {
      const state = ssh.state()
      const mine = vms.read()
      return {
        ...state,
        // Which machines would actually accept it, which is not the same
        // question as whether the key exists. A machine built before this key —
        // or with a different one chosen in the dialog — has somebody else's
        // public half in its authorized_keys and nothing here can change that
        // without being able to get in, which is the thing at issue.
        machines: mine.map(vm => ({
          name: vm.name,
          authorised: !!(vm.spec && vm.spec.sshKey && state.publicKey && vm.spec.sshKey.trim() === state.publicKey.trim()),
          builtWith: vm.spec && vm.spec.sshKey ? String(vm.spec.sshKey).split(' ').slice(0, 2).join(' ').slice(0, 28) + '…' : null
        }))
      }
    }
  },

  // Where anything that speaks ssh looks for these machines.
  //
  // Written because VS CODE cannot be told which key to use. `vmShell` could take
  // `-i`, but VS Code Remote runs plain `ssh user@host` and reads everything else
  // from ssh's configuration — so a key that is not in a config file is a key it
  // will never offer, and "open in VS Code" would fall back to whatever the
  // operator's default identity happens to be. Which is the key all of this
  // exists to stop using.
  sshConfig: {
    about: 'Write the ssh config for these machines, so ssh and VS Code find them by name',
    run: () => {
      const mine = ssh.have() ? String(ssh.publicKey() || '').trim() : null
      const machines = vms.read().map(vm => {
        const agent = channel.list().find(a => a.vm === vm.name)
        const live = agent ? String(agent.from || '').replace(/^::ffff:/, '').replace(/:\d+$/, '') : null
        return {
          name: vm.name,
          address: live || vm.lastAddress || null,
          user: (agent && agent.facts && agent.facts.user) || vm.lastUser || (vm.spec && vm.spec.user) || null,
          // Whether this machine would accept the app's key. Machines built
          // before it existed would not, and naming it for them would be
          // insisting on the one identity that cannot work.
          mine: !!(mine && vm.spec && vm.spec.sshKey && String(vm.spec.sshKey).trim() === mine)
        }
      })
      const file = ssh.writeConfig(machines)
      const include = ssh.ensureInclude()
      return {
        file,
        include,
        hosts: machines.filter(m => m.address && m.user).map(m => ({ alias: ssh.aliasFor(m.name), ...m })),
        // Said, because a machine with no address has never dialled in and its
        // absence here is a fact about it rather than a failure of this.
        without: machines.filter(m => !m.address).map(m => m.name)
      }
    }
  },

  sshKeyMake: {
    about: 'Make this app a new ssh key. Machines built with the old one stop letting it in',
    takes: ['force'],
    run: ({ force }) => {
      const had = ssh.have()
      const yes = force === true || force === 'true' || force === 'yes'
      if (had && !yes) {
        throw new Error('There is already a key. Making another one locks this app out of every machine built with the old one — say force to mean it.')
      }
      const made = ssh.make({ force: yes })
      const state = ssh.state()
      log.on('keys')[had ? 'warn' : 'good'](had
        ? `a new ssh key was made — machines built with the old one no longer let this app in (${state.fingerprint})`
        : `ssh key made (${state.fingerprint})`)
      return {
        ...made,
        ...state,
        note: had
          ? 'Every machine built with the old key must be rebuilt, or have this public key added to its authorized_keys by hand while the old key still works.'
          : 'New machines will be built with this. Existing ones were not.'
      }
    }
  },

  tlsKey: {
    about: "This host's certificate: what it names, when it expires, and its authority",
    run: async () => {
      let address = null
      try { address = await vbox.hostAddress() } catch { /* no adapter is its own answer */ }
      const state = keys.state(address)
      // The authority's fingerprint, which is the one number a person may
      // actually need to read out: a brand-new machine checks the authority
      // against it before trusting anything, over a connection that is not yet
      // protected. Published rather than secret, for exactly that reason.
      let fingerprint = null
      try { fingerprint = keys.ensure().fingerprint } catch { /* reported as missing above */ }
      return { ...state, address, fingerprint, dir: keys.DIR }
    }
  },

  hostKeys: {
    about: 'Public ssh keys that could be authorised on a new machine — this app\'s first',
    run: async () => {
      const keys = []

      // THIS APP'S OWN KEY FIRST, and made if it does not exist yet.
      //
      // It is what should go into a new machine: the app can say when it was
      // made and rotate it, nothing else on this computer is opened by it, and
      // it does not vanish with somebody's profile. The operator's personal keys
      // are still offered underneath because a person may deliberately want
      // their own way in — but the default should not be the key that opens
      // everything else they can reach.
      try {
        ssh.make()
        const mine = ssh.publicKey()
        if (mine) keys.push({ file: 'id_okc.pub', key: mine, comment: "this app's own key", mine: true })
      } catch (e) {
        log.on('keys').warn(`could not make this app an ssh key: ${e.message}`)
      }

      const dir = path.join(require('node:os').homedir(), '.ssh')
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.pub'))) {
          const text = fs.readFileSync(path.join(dir, f), 'utf8').trim()
          keys.push({ file: f, key: text, comment: `${text.split(/\s+/).slice(2).join(' ') || f} — yours`, mine: false })
        }
      }
      return { keys }
    }
  },

  // Other machines, reached over ssh rather than made here.
  machines: { about: 'Machines reachable over ssh, as opposed to ones this app made', run: async () => ({ machines: machines.all() }) },

  machineAdd: { about: 'Add a machine', takes: ['machine'], run: ({ machine }) => machines.add(machine || {}) },

  machineRemove: { about: 'Forget a machine — nothing on it is touched', takes: ['id'], run: ({ id }) => machines.remove(id) },

  machineReach: { about: 'Does this machine answer', takes: ['id'], run: ({ id }) => reach(machines.get(id)) },

  provision: { about: "Run a machine's setup steps, in order, stopping at the first failure", takes: ['id', 'steps'], run: ({ id, steps }) => provision(machines.get(id), steps) },

  openEditor: { about: 'Open a folder in VS Code, here or over ssh', takes: ['id', 'where'], run: ({ id, where }) => editor.openOn(machines.get(id), where) },
}
