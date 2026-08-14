'use strict'

// Work in flight on a machine: dispatching it, following it, shells and
// editors opened on it, and what it is holding.
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
  vbox, vms, provisioner, scripts, channel, tasks, artifact,
  archive, files, prompts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s

module.exports = {
  // Give a machine a task and let go of it.
  //
  // Returns as soon as the work has STARTED, not when it ends. A task runs for
  // minutes or an hour; waiting for it would make one command look like a hang,
  // hold the machine against anything else, and give no progress at all in the
  // meantime. Progress is read afterwards with vmSessionTail, which is a delta
  // with a bookmark rather than a stream nobody is watching.
  //
  // The credential comes from THIS host's environment and is passed for the life
  // of that one process. It is never written to the machine's disk, because a
  // machine here is snapshotted, copied and deleted, and anything on its disk
  // goes into all three.
  vmDispatch: {
    about: 'Give a machine a task to work on, and return without waiting for it',
    takes: ['name', 'task', 'folder', 'contract', 'rules', 'contractName', 'resume', 'shell'],
    run: async ({ name, task, folder, contract, rules: rulesText, contractName, resume, shell }) => {
      const vm = vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so it cannot be given work.`)
      if (!task || !String(task).trim()) throw new Error('Say what the task is.')

      // Asked before anything is set up, because a worker that cannot
      // authenticate does not fail as "signed out" -- it fails as an api error
      // in a json blob, minutes later, after a workspace has been laid out and
      // a run recorded. The first task ever given out failed exactly that way,
      // and nothing between the button and the log said the obvious thing.
      //
      // Asked of the MACHINE rather than read from the registry. A machine can
      // be signed in three ways -- handed a credential, signed in on itself, or
      // carrying a key in its environment -- and the registry only knows about
      // the first. Refusing a machine that could in fact work is a worse fault
      // than the one being fixed.
      // A shell run has no worker in it, so being signed out is beside the
      // point — refusing one would mean refusing a soak because a credential it
      // will never touch is missing.
      const able = shell ? { output: 'okc-can-authenticate' } : await channel.run(name, 'if [ -s "$HOME/.claude/.credentials.json" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo okc-can-authenticate; fi',
        { what: 'checking its worker can authenticate', timeout: 30000 })
      if (!/okc-can-authenticate/.test(able.output || '')) {
        throw new Error(`"${name}"'s worker is signed out, so the work would fail the moment it started. Hand it the credential first: vmCredentialsPut --name ${name}`)
      }

      const id = dispatch.newId()
      const where = guestPath(folder, '--folder') || (vm.spec && vm.spec.folder) || workspace.FOLDER

      // The rules a worker is given, carried with the task rather than named by
      // a path the guest would have to find. Refused by name when they are not
      // there, because a contract that silently fails to load leaves a worker
      // running with no rules while everything reports success.
      //
      // TWO DOORS, NAMED FOR WHAT THEY ARE. `contract` is a file on this host,
      // which is what the command line and the drills point at. `rules` is the
      // text itself, which is what a task carries once it has been written under
      // a contract from the library -- the copy, not the name.
      //
      // Both at once is refused. Preferring one silently would make "which rules
      // was this run under" depend on which line of code read it first, and that
      // is the exact question the whole arrangement exists to answer.
      if (contract && rulesText) throw new Error('Give it either a contract file or the rules themselves, not both.')

      let rules = rulesText ? String(rulesText) : null
      if (contract) {
        const at = path.resolve(String(contract))
        if (!fs.existsSync(at)) throw new Error(`There is no contract at ${at}. It is read from this host, not from the machine.`)
        rules = fs.readFileSync(at, 'utf8')
        if (!rules.trim()) throw new Error(`The contract at ${at} is empty, and an empty contract is worse than none: it reads as though rules were applied.`)
      }
      if (rules !== null && !rules.trim()) throw new Error('The rules are empty, and empty rules are worse than none: everything downstream reports that a contract was applied.')
      const to = log.on('vm', name)

      // Where this host can be reached, worked out here rather than left for the
      // guest to assemble. The machine already knows the address; what it does
      // not know is which port artifacts go to, and telling it is cheaper than
      // putting another value in its environment and re-provisioning to get it
      // there.
      let base = null
      try {
        const where2 = await vbox.hostAddress()
        if (where2) base = `https://${where2}:${port}`
      } catch { /* no address means no helper, and the run still runs */ }

      const r = await channel.run(name, dispatch.script({ id, task: String(task), folder: where, contract: rules, resume, shell: !!shell, base }),
        { what: `dispatching ${id}`, timeout: 60000 })

      if (!/okc-dispatched/.test(r.output || '')) {
        throw new Error(`"${name}" did not start the work: ${String(r.output || '').trim().split('\n').pop() || 'it said nothing'}`)
      }

      to.good(`${name} is working on ${id}${rules ? `, under ${contract ? path.basename(path.resolve(String(contract))) : (contractName || 'the rules it was given')}` : ''}`)
      return {
        run: id,
        machine: name,
        folder: where,
        // Said plainly, because "no rules" is the dangerous one and it is also
        // the silent one -- a run without a contract looks exactly like a run
        // with one from everywhere except here.
        contract: rules ? (contract ? path.resolve(String(contract)) : (contractName || `the rules it was given`)) : null,
        watch: `okc.js vmSessionTail --name ${name}`,
        note: 'started, not finished — read its session for progress and vmRuns for the outcome'
      }
    }
  },

  // What has been given to a machine, and what became of it.
  //
  // A run with no status is reported as `running` rather than as a missing
  // field, because a caller that has to interpret an absence will eventually
  // interpret it as finished.
  vmRuns: {
    about: 'The tasks given to a machine, and whether they are still going',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so its runs cannot be read.`)
      const r = await channel.run(name, dispatch.list(), { what: 'reading its runs', timeout: 60000 })
      return { runs: dispatch.runs(r.output) }
    }
  },

  // What a run's own process printed.
  //
  // Different from the session transcript, and worth both: the transcript says
  // what the agent did, this says what happened to the program running it --
  // which is where a crash before it ever started thinking appears.
  vmRunOutput: {
    about: "The tail of one task's raw output",
    takes: ['name', 'run', 'lines'],
    run: async ({ name, run, lines = 40 }) => {
      vms.get(name)
      if (!run) throw new Error('Say which run.')
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      const r = await channel.run(name, dispatch.output(run, lines), { what: `reading ${run}`, timeout: 60000 })
      // Same boundary as the transcript: this is kept, so it is cleaned first.
      return { run, output: secret.redact(r.output) }
    }
  },

  vmRunStop: {
    about: 'Stop a run on a machine, and everything it started',
    takes: ['name', 'run'],
    run: async ({ name, run }) => {
      vms.get(name)
      if (!run) throw new Error('Say which run.')
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      const r = await channel.run(name, dispatch.stop(String(run)), { what: `stopping ${run}`, timeout: 60000 })
      const said = String(r.output || '')
      const how = said.includes('okc-stop-done') ? 'stopped'
        : said.includes('okc-stop-gone') ? 'was already over'
          : said.includes('okc-stop-nopid') ? 'never recorded a pid, so nothing could be signalled'
            : said.includes('okc-stop-refused') ? 'would not die'
              : 'did not answer'

      if (how === 'would not die' || how === 'did not answer') {
        throw new Error(`${run} ${how}. Look at the machine — something there is ignoring both TERM and KILL.`)
      }
      log.on('vm', name).warn(`${run} ${how}`)
      return {
        name,
        run,
        outcome: how,
        // Said plainly, because a stopped run is not a failed one and the
        // difference matters when somebody reads the board tomorrow: it has no
        // result because it was stopped, not because it went wrong.
        note: 'It reads as `lost` from here on — no result, and nothing left to produce one. The queue puts the machine away as it would for any ended run.'
      }
    }
  },

  // The Claude sessions running on a machine.
  //
  // A runner runs Claude Code, and Claude Code writes everything it does to a
  // transcript on that machine. Read over the channel, strictly read-only.
  vmSessions: {
    about: 'The Claude sessions on a machine, newest first',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so its sessions cannot be read.`)
      const r = await channel.run(name, session.command('list'), { what: 'reading its claude sessions', timeout: 60000 })
      return session.answer(r.output)
    }
  },

  // What a session has done since you last looked.
  //
  // A DELTA, and the bookmark is the point. `since` is a line number in the
  // transcript and comes back as `bookmark`; pass it in next time. A watcher
  // that re-reads from the top spends its whole context re-deriving what it
  // already reported, which for a task running for an hour is most of it.
  //
  // Only what is worth reporting: what it ran, what it wrote, what it was asked,
  // and the lines of a result that carry a verdict. A tool result is tens of
  // kilobytes and almost none of it is news.
  vmSessionTail: {
    about: 'What a machine\'s Claude session has done since a bookmark',
    takes: ['name', 'session', 'since', 'limit'],
    run: async ({ name, session: which = '', since = 0, limit = 40 }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so its session cannot be read.`)
      const r = await channel.run(name, session.command('tail', [which, since, limit]), { what: 'reading its session', timeout: 120000 })
      const out = session.answer(r.output)
      if (!out.ok) throw new Error(out.error + (out.sessions ? ` — ${out.sessions.map(s => `${s.id.slice(0, 8)} (${s.title || 'untitled'})`).join(', ')}` : ''))
      return out
    }
  },

  // What a machine is holding that exists nowhere else.
  //
  // For the two actions that destroy a machine's disk. "Everything since is
  // discarded" and "its disks are deleted" are both true and neither says WHAT,
  // so the question they raise -- is there work in there? -- is left to be
  // answered by remembering. This asks the machine instead, which takes about a
  // second.
  //
  // NOT ASKED is its own answer and is reported as one. A machine that is not
  // dialled in cannot be asked, and if that returned an empty list it would read
  // as "nothing to lose" -- which is the most dangerous thing this could say,
  // because a machine that is off is exactly the one nobody has looked at
  // recently. Silence must not be able to mean two different things.
  vmHolds: {
    about: 'What a machine is holding that is not here: commits not pushed, and files not committed',
    takes: ['name'],
    run: async ({ name }) => {
      const vm = vms.get(name)
      if (!channel.connected(name)) {
        return { asked: false, why: `"${name}" is not dialled in, so it cannot be asked what it is holding.`, repos: [] }
      }

      const folder = (vm.spec && vm.spec.folder) || workspace.FOLDER
      // One line per repository, in a shape that is read rather than parsed out
      // of prose -- and nothing at all when there is no workspace, which is a
      // real answer and not a failure.
      const script = `set -u
WS="${folder}"
[ -d "$WS" ] || exit 0
for d in "$WS"/*/; do
  [ -d "$d/.git" ] || continue
  cd "$d" || continue
  name=$(basename "$d")
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  # A repository with no upstream has nothing to be ahead OF, so counting
  # @{upstream}..HEAD fails and answers zero -- which reads as nothing to lose
  # about a repository whose every commit exists only here. Untracked means all
  # of it, not none of it.
  if git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    ahead=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)
    tracked=yes
  else
    ahead=$(git rev-list --count HEAD 2>/dev/null || echo 0)
    tracked=no
  fi
  dirty=$(git status --porcelain 2>/dev/null | grep -c . || echo 0)
  echo "okc-holds|$name|$branch|$ahead|$dirty|$tracked"
done`

      const r = await channel.run(name, script, { what: 'what it is holding', timeout: 60000 })
      const repos = String(r.output || '').split('\n')
        .map(l => l.trim()).filter(l => l.startsWith('okc-holds|'))
        .map(l => l.split('|'))
        .map(([, repo, branch, ahead, dirty, tracked]) => ({
          repo,
          branch,
          ahead: Number(ahead) || 0,
          dirty: Number(dirty) || 0,
          // Whether those commits are counted against a copy here or are simply
          // all of them. It changes what the number means, so it travels with it.
          tracked: tracked !== 'no'
        }))

      const commits = repos.reduce((n, r) => n + r.ahead, 0)
      const files = repos.reduce((n, r) => n + r.dirty, 0)

      // What it is ALLOWED to push, against what it is actually on.
      //
      // Those are different claims and only the first was ever recorded here.
      // The details panel says "may push fix/thing", which is true and is a
      // permission -- it says nothing about where the machine's work actually
      // is. A machine sitting on another branch is not dangerous, because the
      // push refuses; it is just a machine whose work has nowhere to go, and
      // nothing said so until somebody tried.
      //
      // Only checked where it can be: here, where the machine has just answered.
      const elsewhere = repos.filter(r => vm.branch && r.branch !== vm.branch)
      return {
        asked: true,
        repos,
        commits,
        files,
        mayPush: vm.branch || null,
        elsewhere: elsewhere.map(r => `${r.repo} is on ${r.branch}`),
        adrift: elsewhere.length
          ? `${name} may push ${vm.branch}, but ${elsewhere.map(r => `${r.repo} is on ${r.branch}`).join(' and ')} — work there cannot be pushed until it is on ${vm.branch}.`
          : null,
        // Said once, here, so every caller says it the same way.
        summary: commits || files
          ? [
              commits ? `${commits} commit${commits === 1 ? ' that exists' : 's that exist'} nowhere else` : null,
              files ? `${files} file${files === 1 ? '' : 's'} changed and not committed` : null
            ].filter(Boolean).join(', ')
          : null
      }
    }
  },

  // ---- tasks: what is to be done, and what came back ---------------------
  //
  // The other half of this tool. One side manages machines; this side manages
  // work, and the two meet at exactly one point -- a task is GIVEN to a machine.
  // Neither knows anything else about the other, which is what lets a machine be
  // destroyed mid-task without the task going with it.
  //
  // THE ARTIFACT IS A BRANCH. A task is not done when its worker stops talking,
  // it is done when something arrived here that can be read -- so `delivered` is
  // read from the repositories rather than stored, and a run that exited cleanly
  // having pushed nothing has produced nothing to judge.

  // The way in when the way in has stopped working.
  //
  // THIS IS THE BACK DOOR, and it is the reason an ssh key is put on every
  // machine at build time. Everything else here talks to a machine through its
  // agent — which is exactly the thing that is broken when you most need to look
  // inside. A silent agent is indistinguishable from a dead machine from this
  // side, and the difference is written in the guest's own journal.
  //
  // That is not hypothetical: an agent was found awake, correctly diagnosing its
  // own lost connection, writing so to its journal, and stuck. Nothing on this
  // side could have said that. One `journalctl -u okc-agent` did.
  //
  // The address comes from the registry rather than the channel, deliberately.
  // Asking the agent where it lives is no use when the agent is the problem, so
  // it is recorded every time a machine dials in and used long afterwards.
  vmShell: {
    about: 'How to ssh into a machine — the way in when its agent has stopped answering',
    takes: ['name'],
    run: ({ name }) => {
      const vm = vms.get(name)
      const agent = channel.list().find(a => a.vm === name)

      // Live first, remembered second. They are usually the same; when they are
      // not, the live one is right and the remembered one is what there is.
      const live = agent ? String(agent.from || '').replace(/^::ffff:/, '').replace(/:\d+$/, '') : null
      const address = live || vm.lastAddress || null
      const user = (agent && agent.facts && agent.facts.user) || vm.lastUser || (vm.spec && vm.spec.user) || null

      if (!address) {
        throw new Error(`Nothing knows where "${name}" is. It has to have dialled in at least once for its address to be recorded — start it and wait, or look in VirtualBox.`)
      }

      // Kept current here, because this is the moment somebody is about to use
      // it — and an alias pointing at an address a machine no longer has is
      // worse than no alias at all.
      try { actions.sshConfig.run({}) } catch { /* the direct target below still works */ }

      const alias = ssh.aliasFor(name)
      return {
        name,
        user,
        address,
        alias,
        // The app's key ONLY IF THIS MACHINE WOULD ACCEPT IT.
        //
        // Forcing it unconditionally broke the way into every machine built
        // before the key existed: they have somebody else's public half in their
        // authorized_keys, and insisting on this one turned a working back door
        // into "Permission denied" — on the machines most likely to need one.
        //
        // So it is offered where it fits and ssh is left to its own devices
        // where it does not, which is exactly what happened before. A machine
        // built with the operator's key is still reached with the operator's
        // key; the change only ever applies to machines built since.
        identity: (ssh.have() && vm.spec && vm.spec.sshKey &&
                   String(vm.spec.sshKey).trim() === String(ssh.publicKey() || '').trim())
          ? ssh.KEY()
          : null,
        // Both, because they answer different questions: one to run, one to
        // paste somewhere else.
        target: `${user}@${address}`,
        command: `ssh ${alias}`,
        live: !!live,
        note: live
          ? 'Its agent is answering, so vmRun would work too — this is for looking at things the agent cannot tell you.'
          : `Not dialled in. This address is where it was last seen${vm.lastSeenAt ? ` (${new Date(vm.lastSeenAt).toLocaleString()})` : ''}, which is the whole reason it was written down.`
      }
    }
  },

  // The back door, used rather than described.
  //
  // `vmShell` says how to get in; this goes in. THE DIFFERENCE FROM `vmRun` IS
  // WHAT IT DOES NOT NEED: vmRun speaks to the agent, and the agent is precisely
  // the thing that is broken when somebody wants to look inside a machine. It
  // also cannot hold a long command — the agent answers this host's beats from
  // the same loop that runs the command, so anything slow makes it look dead,
  // and the connection is dropped underneath the work. That is not theory; it is
  // what happened trying to run one headless prompt.
  //
  // ssh has neither problem. It is already provisioned, it is how the Terminal
  // tab and VS Code get in, and it keeps its own connection.
  //
  // NOT A SHELL FOR A PERSON — that is the Terminal tab, which needs a terminal
  // this side does not have. This is one command, run to completion, output
  // returned.
  vmShellRun: {
    about: 'Run one command on a machine over ssh — works when its agent does not',
    takes: ['name', 'command', 'timeout', 'input'],
    run: async ({ name, command, timeout, input = null }) => {
      if (!command) throw new Error('There is no command to run.')
      // Coerced, because everything that arrives from the command line or over
      // the wire is a string, and execFile rejects a string timeout with an
      // error about unsigned integers that says nothing about where it came from.
      timeout = Number(timeout) || 120000
      const where = actions.vmShell.run({ name })
      const { execFile } = require('node:child_process')

      const args = [
        // No pty. A command that finishes is not an interactive session, and
        // -tt would wrap the output in whatever a terminal was asked to draw.
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        ...(where.identity ? ['-o', `IdentityFile=${String(where.identity).split('\\').join('/')}`, '-o', 'IdentitiesOnly=yes'] : []),
        where.target,
        // A LOGIN SHELL, because that is where a guest's PATH is set. Without it
        // `claude`, `node` and anything else installed per-user is simply not
        // found, and the answer is "command not found" rather than the real one.
        'bash -lc ' + `'${String(command).replace(/'/g, `'\\''`)}'`
      ]

      log.on('vm', name).info(`over ssh: ${String(command).split('\n')[0].slice(0, 80)}`)

      return await new Promise((resolve, reject) => {
        const child = execFile('ssh', args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          // REDACTED ON THE WAY IN, like every other thing a machine says. A
          // command run here can print an environment, and this output is
          // returned to a window and to a supervising session that keeps it.
          const output = secret.redact(`${stdout || ''}${stderr || ''}`)
          if (err && err.killed) return reject(new Error(`"${name}" did not finish that within ${Math.round(timeout / 1000)}s. Output so far:\n${output}`))
          resolve({
            name,
            target: where.target,
            // A non-zero exit is an ANSWER, not a failure of this action: `grep`
            // finding nothing is exit 1 and is exactly what was asked.
            exit: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
            output
          })
        })

        // WHATEVER IS BEING SENT GOES DOWN STDIN, NOT ARGV.
        //
        // A command line is not a transport. Windows caps the whole line at
        // about 32k, and a file of any size base64'd into an argument reaches
        // the far end TRUNCATED IN THE MIDDLE OF A QUOTE — where the shell
        // reports "unexpected EOF" and says nothing about length, so it reads as
        // a quoting mistake. Which is what it looked like, until the same
        // quoting worked for a smaller file.
        if (input != null) child.stdin.end(input)
        else child.stdin.end()
      })
    }
  },

  // Open a virtual machine's work in VS Code, over its own remote.
  //
  // The address is not configured, discovered or looked up: the machine dialled
  // in, so we already know where it is, and a machine that moved has already
  // said so. That is why this needs it CONNECTED rather than merely running --
  // running means VirtualBox has it powered on, which says nothing about there
  // being an address to open.
  //
  // The folder is asked for rather than assumed. A home directory is `/home/<user>`
  // on most machines and not on all of them, and the cost of guessing is a button
  // that opens the wrong folder, or an empty one, without saying it did.
  vmEditor: {
    about: "Open a machine's work in VS Code, over ssh",
    takes: ['name', 'where'],
    run: async ({ name, where }) => {
      const vm = vms.get(name)
      const agent = channel.list().find(a => a.vm === name)
      if (!agent) throw new Error(`"${name}" is not dialled in, so there is no address to open. Start it and wait for it to connect.`)

      const facts = agent.facts || {}
      // The address it DIALLED IN FROM, not the first one it lists about itself.
      // Those are different questions: a machine reports every address it has,
      // and once docker is installed that includes a bridge address like
      // 172.17.0.1 which is real inside the machine and unreachable from here.
      // The socket's far end is the one address proven to work in this
      // direction, because a packet already came back along it.
      const address = String(agent.from || '').replace(/:\d+$/, '') || (facts.addresses || [])[0]
      const user = facts.user || (vm.spec && vm.spec.user)
      if (!address || !user) throw new Error(`"${name}" has not said enough about itself yet to open it.`)

      // Shared with the terminal door, so the two cannot open different folders
      // for the same task. See workFolder, above the table.
      const dir = await workFolder(name, where)

      // THROUGH THE ALIAS, not through user@address.
      //
      // VS Code runs plain `ssh <what it is given>` and takes the identity from
      // ssh's configuration. Given `okc@1.2.3.4` it would offer whatever the
      // operator's default identity is; given the alias it reads the block this
      // app wrote, which names this app's key and no other. Written just before
      // opening, because an alias pointing at an address the machine no longer
      // has is worse than none.
      try { actions.sshConfig.run({}) } catch { /* the alias may already be right */ }
      const alias = ssh.have() ? ssh.aliasFor(name) : `${user}@${address}`

      return editor.open({ dir, remote: alias, tags: [name] })
    }
  },
}
