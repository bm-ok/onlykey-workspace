'use strict'

// Where the work lives: the branches across the workspace, the lines cut
// across them, and what is waiting to go in.
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
  // Every branch across the workspace, so a machine can be pointed at work that
  // already exists instead of a name being typed twice and spelled differently.
  // The join between branches and machines happens here, not in repos/, which
  // knows nothing about machines and should not start.
  gitBranches: {
    about: 'Every branch across the workspace repositories, which have each, and which are taken',
    needs: 'workspace',
    run: () => {
      const all = branches.all()
      const mine = vms.read()
      return {
        ...all,
        // Where each default branch actually is, as a commit. The rule is that
        // nothing lands on it; this is the only way to CHECK that, before and
        // after something that was supposed to be refused. Looking at master and
        // finding it plausible is not a check.
        defaultHeads: branches.defaultHeads(),
        branches: all.branches.map(b => {
          const held = mine.find(v => v.branch === b.name)
          const available = !b.protected && !held
          return {
            ...b,
            heldBy: held ? held.name : null,
            // Two questions, answered separately. `available` is whether this
            // branch may be worked on at all; `reclaimable` is whether the host
            // can get out of its way. Both must hold to use it, but they fail
            // for different reasons and are fixed in different places, so
            // `usable` is offered as well rather than instead.
            available,
            usable: available && b.reclaimable
          }
        })
      }
    }
  },

  // Every branch, and everything that decides what to do with it.
  //
  // WHY THIS EXISTS SEPARATELY FROM `gitBranches`. That one answers "may I build
  // on this", which is the question asked when a machine is being set up. This
  // answers "what IS this", which is the question asked when nobody can remember
  // where a branch came from -- and there are, by now, a great many branches.
  //
  // The confusing part is not any single branch, it is that ownership is spread
  // across three places that never met: the repositories know a name exists, the
  // board knows a task claims one, and the machine registry knows one is checked
  // out somewhere. A branch belonging to a task that was thrown away looks
  // exactly like a branch somebody made by hand, and the difference decides
  // whether deleting it loses anything.
  //
  // NOTHING HERE SPAWNS GIT PER BRANCH. What is on a branch comes from the
  // artifact cache, which is keyed on where every ref actually is, so a board of
  // forty branches costs the same two processes as a board of one. That is not an
  // optimisation, it is the difference between this being drawable every three
  // seconds and it being the thing that pinned the window's CPU last time.
  branchBoard: {
    about: 'Every branch: who claims it, what is on it, and whether it can be deleted',
    needs: 'workspace',
    run: async () => {
      const all = branches.all()
      // THE LIVE LIST, not the registry.
      //
      // A claim is registry state and outlives the machine being on -- which is
      // the whole reason "claimed by a machine that is off" exists as a separate
      // thing to say. But whether it is off is NOT in the registry: it comes
      // from VirtualBox, and reading `running` off a registry record gets
      // `undefined` every time. So a machine somebody was actively working in
      // reported itself as off, which is the exact lie this distinction was
      // added to stop telling.
      const { vms: machines } = await vms.all()
      const board = tasks.read()

      const rows = all.branches.map(b => {
        const held = machines.find(v => v.branch === b.name) || null
        // Every task that named this branch, not the first. Two tasks on one
        // branch is a mistake worth seeing rather than a case to pick a winner in.
        const claims = board.filter(t => t.branch === b.name)

        // What is on it, from the cache.
        //
        // NOT ASKED OF A BASELINE, because a branch everything is measured
        // against cannot be measured against itself — the answer is zero, and it
        // is zero for a reason that says nothing about the branch.
        //
        // BUT ASKED OF A LINE. Being in a group protects a branch, and that used
        // to be enough to stop this: promoting a finished branch so it could be
        // landed made the board immediately report it as carrying nothing, with
        // the summary of a default branch. The one branch somebody most wants to
        // read is the one they have just proposed, and promoting it blinded the
        // board to it. So the question is asked of what it IS — a baseline
        // somewhere, or only a link in a line.
        const guard = all.protected.find(p => p.branch === b.name) || {}
        const isBaseline = (guard.asDefault || []).length > 0
        const art = isBaseline ? null : artifact.read(b.name)

        // CONTAINED IN THE DEFAULT means every repository holding this branch
        // reports nothing beyond its default -- which is the same statement as
        // "merged", arrived at without a single extra command, because the
        // artifact already had to count it.
        // NULL rather than false for a protected branch. It is the thing
        // everything else is measured against, so "is it contained in the
        // default" has no answer -- and false would read as "it has work nobody
        // has merged", which is the opposite of true.
        const carrying = art ? art.repos.filter(r => !r.missing) : []
        const contained = art ? (carrying.length > 0 && carrying.every(r => r.ahead === 0)) : null

        return {
          ...b,
          heldBy: held ? held.name : null,
          // WHETHER THAT MACHINE IS ACTUALLY RUNNING, which is a different fact
          // and was being collapsed into the first one. A claim is a registry
          // entry and outlives the machine being on -- so a powered-off runner
          // still claiming a branch was reported as "checked out on runner2",
          // with a warning about pulling the checkout out from under it. Both
          // sentences describe something live, about a machine that is off.
          heldRunning: !!(held && held.running),
          // Why it exists, when anybody said. Absent on every branch cut before
          // that was required, which is itself worth showing rather than hiding:
          // "nobody recorded this" is the honest state of most of the board.
          note: branches.noteFor(b.name),
          // Which repositories treat THIS branch as their default. Only ever
          // set on a protected one, and it is what makes "not in local-repo-a"
          // stop being said about a branch that was never supposed to be there:
          // a default branch is not missing from the repositories that have
          // their own, it is simply not theirs.
          // WHY it is protected, kept apart, because they are different claims
          // and collapsing them says the wrong one. A branch can be the default
          // of one repository and the chosen baseline of another, and once a
          // baseline is chosen anywhere the two lists stop matching.
          asDefault: (all.protected.find(p => p.branch === b.name) || {}).asDefault || [],
          // Whether it is the baseline for ALL of them, which is the only case
          // where "the baseline" is a true thing to call it.
          // The claim, flattened to what a list can show without a second lookup.
          tasks: claims.map(t => ({ id: t.id, number: t.number, title: t.title, state: t.state })),
          commits: art ? art.commits : 0,
          files: art ? art.files : 0,
          summary: art ? art.summary : 'a default branch — where work lands, never measured against itself',
          contained,
          // Made by this system and then forgotten: it carries work, and the task
          // that asked for it is gone. This is the one row that is genuinely hard
          // to reconstruct by hand, and it is why the tab is worth having.
          orphaned: !b.protected && !claims.length && !held && !!art && art.delivered,
          // Unclaimed and carrying nothing. Not the same as orphaned, and the
          // difference is the whole of what deleting costs: this one is a name
          // and nothing else, so sweeping it up loses exactly nothing. Most of
          // what accumulates here is this -- a drill's branch outliving the
          // drill.
          spare: !b.protected && !claims.length && !held && !!art && !art.delivered,
          // Said in one place so the window and the command line refuse
          // identically, and so the reason is a sentence rather than a flag.
          removable: !b.protected && !held && b.reclaimable,
          whyNot: b.protected
            ? branches.whyProtected(b.name)
            : held
              ? (held.running
                  // Running: deleting it really would pull the checkout out from
                  // under whatever is happening on that machine right now.
                  ? `${held.name} is set up on this branch and is running. Let it go of the branch first — deleting it now would take the checkout out from under it.`
                  // Off: nothing is happening to take anything from. What stands
                  // in the way is the CLAIM, and letting go of one needs the
                  // machine started, because a claim is never dropped without
                  // asking whether it is holding work that exists nowhere else.
                  : `${held.name} still claims this branch, and it is powered off. Letting go of a claim means starting it first: nothing here drops one without asking the machine whether it is holding work that exists nowhere else.`)
              : !b.reclaimable
                ? (b.blocked && b.blocked[0]) || 'something on this host is holding it'
                : null
        }
      })

      return {
        repos: all.repos,
        protected: all.protected,
        // MORE THAN ONE BASELINE IN ONE WORKSPACE IS A FACT WORTH SAYING.
        //
        // Every repository has its own default branch, read from that repository
        // rather than assumed -- `master` here, `main` in most new ones, and
        // something else entirely is ordinary. So a workspace can hold several,
        // and then "ahead of the default" means a different thing per repository:
        // one branch, measured against `master` in two of them and `version2` in
        // the third, summed into a single number.
        //
        // Nothing is wrong with that and everything about it is easy to misread,
        // which is exactly the sort of thing this window exists to say out loud.
        baselines: all.protected,
        mixed: all.protected.length > 1,
        branches: rows,
        counts: {
          all: rows.length,
          protected: rows.filter(r => r.protected).length,
          claimed: rows.filter(r => r.tasks.length).length,
          held: rows.filter(r => r.heldBy).length,
          orphaned: rows.filter(r => r.orphaned).length,
          spare: rows.filter(r => r.spare).length,
          contained: rows.filter(r => r.contained).length
        }
      }
    }
  },

  // What is on a branch, asked of the branch rather than of a task.
  //
  // `taskArtifact` answers the same question and needs a task id, which is
  // exactly what an ORPHANED branch does not have -- and an orphaned branch
  // carrying commits is the one thing on the board where somebody has to decide
  // whether to throw work away. Deciding that blind was the only option.
  //
  // Never cached: the summary on the board can be four seconds stale without
  // costing anything, but this is what a person reads before deleting something.
  branchArtifact: {
    about: 'What is on a branch: commits and files per repository, without a task',
    needs: 'workspace',
    takes: ['branch'],
    run: ({ branch }) => {
      if (!branch) throw new Error('Which branch?')
      return artifact.read(branch, { fresh: true })
    }
  },

  branchCreate: {
    about: 'Cut a branch across every repository, from a named line or from another branch',
    needs: 'workspace',
    takes: ['branch', 'reason', 'group', 'from'],
    run: a => {
      const { branch, reason, group, from } = a
      const cut = branches.ensure(branch, {
        reason,
        // OR FROM ANOTHER CUT. A line is where work is measured from; a cut is
        // work. Starting from a cut is what somebody is doing when one task
        // follows another, and it was only reachable by turning that branch
        // into a line first -- which says something much bigger, since a line
        // is protected and is what other work gets measured against.
        from: from || null,
        // WHICH POINT IN THE WORK IT STARTS FROM, and it is required. The old
        // behaviour — each repository from its own baseline — is right when they
        // are all on the same line and quietly wrong when they are not, and it
        // was three separate decisions somebody had to have made earlier and
        // correctly. "Cut from the version2 line" is one decision, said out loud.
        group: group || null,
        // Which surface asked, since one of them is a person at this keyboard and
        // the other may be a model driving the socket.
        by: s.whoAsked(a)
      })
      const made = cut.filter(c => c.created)
      log.on('git').good(made.length
        ? `cut "${branch}" in ${made.map(c => `${c.repo} from ${c.from}`).join(', ')}${group ? ` — the "${group}" line` : from ? ` — on top of "${from}"` : ''} — ${String(reason).trim()}`
        : `"${branch}" already existed everywhere; its reason is unchanged`)
      return {
        branch: branch.trim(),
        cut,
        made: made.map(c => c.repo),
        note: branches.noteFor(branch.trim()),
        already: !made.length
      }
    }
  },

  // Everything a branch carries, of every kind, in ONE answer.
  //
  // A branch is where work is kept, and work now arrives in more than one shape:
  // commits, files a run handed over that a branch could not hold, and -- when it
  // exists -- the session that produced them. A panel showing all three should
  // not have to make three calls and stitch them together, because the three
  // would then be from three different moments.
  branchArtifacts: {
    about: 'Everything a branch carries: its commits, the files handed over, and the session',
    needs: 'workspace',
    takes: ['branch'],
    run: ({ branch }) => {
      if (!branch) throw new Error('Which branch?')

      // Never cached: this is what somebody reads before judging or deleting.
      const git = artifact.read(branch, { fresh: true })

      // Every task that named this branch, and what each of them handed over.
      // Read from the archive rather than the task record, so a task that was
      // thrown away still shows what it produced.
      const onIt = tasks.read().filter(t => t.branch === branch)
      const delivered = onIt.map(t => ({
        task: t.id,
        number: t.number,
        title: t.title,
        state: t.state,
        machine: t.machine || null,
        files: files.list(t.uid)
      }))

      return {
        branch,
        git,
        tasks: delivered,
        files: delivered.flatMap(d => d.files.map(f => ({ ...f, task: d.task, number: d.number }))),
        // SAID PLAINLY RATHER THAN LEFT OUT. A branch is where work lives and a
        // session is how that work was reached, so it belongs here -- and
        // nothing captures one yet. An empty panel would read as "this branch
        // has no session"; this says the tool does not keep them.
        session: {
          kept: false,
          why: 'Nothing captures a worker session yet. The machine is rolled back when its work ends, and the session goes with it — so resuming one, or reading how a branch was reached, is not possible from here.'
        }
      }
    }
  },

  branchDiff: {
    about: "One repository's changes on a branch, in full, without a task",
    needs: 'workspace',
    takes: ['branch', 'repo', 'file'],
    run: ({ branch, repo, file }) => {
      if (!branch || !repo) throw new Error('Which branch, in which repository?')
      return { branch, repo, file: file || null, diff: artifact.diff(repo, branch, file) }
    }
  },

  // ---- landing a line ----------------------------------------------------
  //
  // THE LAST JOINT. Work goes out to a machine, comes back on a branch, and gets
  // read — and then stopped, because nothing here landed anything. Accepted work
  // sat on its branch for ever and "into production" was a thing somebody did in
  // another window with no record of it.
  //
  // A MERGE IS BETWEEN TWO LINES, not between two branches. A change spans
  // repositories, so landing it is one decision with one answer, and doing it a
  // repository at a time is how half a change lands. The source line is a group
  // somebody has marked as a proposal; the target is the line it would go into.
  //
  // Read entirely from this host, like every other review here: `git merge` and
  // `git push` are the only things below that write anything, they are named
  // before they run, and they are refused as a set if any one of them would fail.

  // Turning a finished branch into a line, so it can be proposed.
  branchAsLine: {
    about: 'Make a line out of a branch, so it can be compared and landed. Moves nothing',
    needs: 'workspace',
    takes: ['branch', 'name', 'why'],
    run: ({ branch, name, why }) => {
      const made = branches.groupFromBranch(branch, { name, why })
      log.on('git').good(`"${made.name}" is a line now — ${made.on.map(p => `${p.repo}:${p.branch}`).join(', ')}`)
      return {
        ...made,
        note: `"${made.name}" names ${made.on.map(p => p.repo).join(', ')} at "${branch}". Its branches are protected while it is a line. Nothing is counted from it until you say so.`
      }
    }
  },

  // Take a branch out of every repository that has it.
  //
  // Every refusal is here rather than in the window, because the window is one
  // caller. A protected branch is refused outright; a branch a machine is set up
  // on is refused because deleting it pulls the checkout out from under a running
  // job; and a branch carrying commits the default does not have is refused
  // UNLESS the caller says so, since that is the only case where the answer
  // depends on something this cannot know.
  branchDelete: {
    about: 'Delete a branch from every repository that has it',
    needs: 'workspace',
    takes: ['branch', 'force'],
    run: async ({ branch, force = false }) => {
      const row = (await actions.branchBoard.run({})).branches.find(b => b.name === branch)
      if (!row) throw new Error(`No repository here has a branch called "${branch}".`)
      if (row.whyNot) throw new Error(row.whyNot)

      if (!row.contained && !force) {
        throw new Error(
          `"${branch}" carries ${row.commits} commit(s) that ${row.tasks.length ? 'its task delivered and ' : ''}no default branch has. ` +
          'Deleting it is the only way that work is lost here, so it has to be asked for on purpose: pass force.'
        )
      }

      // Forced at the git level whenever we got this far, because the check that
      // matters was made above against the DEFAULT branch. Git's own -d compares
      // against whatever HEAD happens to be, which in a bare repository being
      // served is not the question anybody asked.
      const gone = branches.remove(branch, { force: true })

      log.on('git').warn(
        `deleted branch "${branch}" from ${gone.deletedFrom.map(d => d.repo).join(', ')}` +
        (row.contained ? '' : ` — it carried ${row.commits} commit(s) no default branch has`)
      )
      // The commits are named on the way out. A branch is a pointer; deleting one
      // does not delete what it pointed at, and for as long as git keeps the
      // object these numbers are how it comes back.
      return {
        ...gone,
        carried: row.commits,
        contained: row.contained,
        tasks: row.tasks,
        note: row.contained
          ? 'Everything on it was already in the default branch.'
          : `It carried ${row.commits} commit(s) that no default branch has. They still exist: ${gone.deletedFrom.map(d => `${d.repo} ${d.was || '(nothing)'}`).join(', ')}`
      }
    }
  },

  // Sitting in a machine, on a branch, with an editor open.
  //
  // A BRANCH IS A WORKSPACE when a person is the one working. The parts existed
  // -- borrow a machine, set it up on a branch, open VS Code over ssh -- and
  // nothing joined them, so doing this by hand meant starting a machine, waiting,
  // remembering the workspace action, then remembering the editor one, and
  // afterwards remembering that the machine is still yours.
  branchWorkOn: {
    about: 'Take a free machine, set it up on this branch, and open it — in VS Code, or in a terminal here',
    needs: 'workspace',
    takes: ['branch', 'name', 'folder', 'open'],
    run: async ({ branch, name, folder, open = 'editor' }) => {
      if (!branch) throw new Error('Which branch do you want to work on?')
      if (!['editor', 'terminal', 'none'].includes(open)) {
        throw new Error(`"${open}" is not a way to open work. It is "editor", "terminal", or "none".`)
      }

      // Refused before a machine is borrowed rather than after, or a typo costs
      // a boot and leaves a machine out of the pool.
      const known = branches.all().branches.find(b => b.name === branch)
      if (!known) throw new Error(`There is no branch called "${branch}". Make it first, with a reason.`)
      if (known.protected) throw new Error(branches.whyProtected(branch))
      if (known.missing.length) {
        throw new Error(`"${branch}" is not in ${known.missing.join(', ')}, and a machine checks it out in every repository. Extend it first with branchCreate, saying which baseline group the missing repositories cut it from.`)
      }

      const held = vms.read().find(v => v.branch === branch)
      if (held) throw new Error(`"${branch}" is already set up on ${held.name}. Two machines on one branch race for the same ref.`)

      const borrowed = await actions.vmBorrow.run({
        name,
        why: `working on ${branch} in ${open === 'terminal' ? 'a terminal' : 'VS Code'}`
      })
      const on = borrowed.name

      // TWO STEPS, AND ONLY THE FIRST UNDOES ITSELF.
      //
      // If the workspace never got set up, nothing was claimed and the machine
      // is handed straight back -- a machine borrowed for a flow that did not
      // start is out of the pool with nobody in it.
      //
      // Once it IS set up, the machine claims the branch and is genuinely
      // usable, so a failure after that point keeps it. Handing it back there
      // released the borrow and left the claim behind: a machine out of the pool
      // for a different reason, belonging to nobody, which is worse than either
      // outcome. Opening an editor is also the one step somebody can simply do
      // again.
      try {
        await actions.vmWorkspace.run({ name: on, branch, folder })
      } catch (e) {
        vms.update(on, { borrowed: null })
        log.on('vm', on).bad(`could not set it up on "${branch}", so it is back in the pool: ${e.message}`)
        throw e
      }

      // CLAUDE IN THE EDITOR'S TERMINAL, which is half of what a person opens an
      // editor for here. The queue does this before every worker run and the
      // human path did not, so VS Code opened on a machine where `claude` still
      // asked how to log in -- the same wizard problem as before, arrived at
      // from the other side. A person then has one editor, one terminal, and no
      // worker in it, which is the thing they came here to have.
      //
      // NOT FATAL. A host with no credential yet is an ordinary state -- it is
      // literally step one of the Keys tab -- and it is no reason to withhold a
      // machine somebody asked for. The editor still opens; the note says what
      // they will find in the terminal.
      // `signedIn` is what the WORKER says, not what we placed. Placing a file
      // and being able to authenticate are two different facts, and reporting
      // the first as the second is how somebody ends up typing `claude` into a
      // terminal this window promised was ready.
      let signedIn = null
      let signInNote = null
      try {
        signedIn = (await actions.vmCredentialsPut.run({ name: on })).ready
        if (signedIn === false) signInNote = 'this host\'s worker credential has expired'
      } catch (e) {
        signedIn = false
        signInNote = e.message
        log.on('vm', on).warn(`set up on "${branch}", but it has no worker credential: ${e.message}`)
      }

      // TWO DOORS ONTO THE SAME MACHINE, and the flow only differs at this last
      // step. Everything above -- borrow, roll back, check out the branch in
      // every repository, hand it a credential -- is what "work on this" means,
      // and which window it lands in is a preference about how somebody works
      // rather than a different kind of work.
      //
      // THE TERMINAL IS OPENED BY THE WINDOW, NOT HERE. This is not a hole in
      // one-surface: the command line's half is `vmShell`, which says how to get
      // in and hands its own terminal to ssh. The dashboard has no terminal to
      // give, so what this returns is everything needed to open one -- and the
      // command line already does exactly that with `vmShell --command`.
      let opened = null
      let why = null
      let dir = null

      if (open === 'editor') {
        try {
          opened = await actions.vmEditor.run({ name: on, where: folder })
        } catch (e) {
          why = e.message
          log.on('vm', on).warn(`set up on "${branch}", but the editor did not open: ${e.message}`)
        }
      } else if (open === 'terminal') {
        // Resolved here rather than guessed at the other end, so a terminal and
        // an editor opened on the same task land in the same folder.
        try {
          dir = await workFolder(on, folder)
        } catch (e) {
          why = e.message
          log.on('vm', on).warn(`set up on "${branch}", but it would not say where its work is: ${e.message}`)
        }
      }

      log.on('vm', on).good(`yours, on "${branch}"${opened ? ' — VS Code is opening' : open === 'terminal' ? ' — a terminal is opening' : ''}`)

      const claude = signedIn === true
        ? ' Claude is signed in there, so typing `claude` works.'
        : signedIn === null
          ? ' A credential is on it; whether Claude can authenticate was not established.'
          : ` Typing \`claude\` there will fail — ${signInNote || 'it is not signed in'}. Get a fresh credential on the Keys tab.`
      const keep = ' Commit and push what you want to keep — giving it back rolls it back, and refuses while anything is uncommitted.'

      return {
        name: on,
        branch,
        open,
        opened,
        folder: dir,
        signedIn,
        editorFailed: why,
        note: why
          ? `${on} is set up on "${branch}" and is yours, but it could not be opened: ${why}. Open it again, or work in it over ssh.`
          : `${on} is set up on "${branch}" and yours until you give it back.${claude}${keep}`
      }
    }
  },

  // What each repository counts from, and lets it be chosen.
  //
  // THE DEFAULT AND THE BASELINE ARE DIFFERENT QUESTIONS. The default is what the
  // repository says HEAD is -- a fact about git, never chosen here, and always
  // protected. The baseline is what work is measured against AND cut from, and a
  // repository whose default is `master` may perfectly well be working toward
  // `version2`. Until now they were one word, which was fine only while every
  // repository answered both the same way.
  lines: {
    about: 'Every named line: one branch per repository, and what work is cut from',
    needs: 'workspace',
    run: () => ({ groups: branches.groups(), repos: branches.baselines() })
  },

  lineSave: {
    about: 'Name a line: one branch per repository, so work can be cut from that point',
    needs: 'workspace',
    takes: ['name', 'why', 'on'],
    run: ({ name, why, on }) => {
      const saved = branches.saveGroup(name, { why, on: on && (typeof on === 'string' ? JSON.parse(on) : on) })
      log.on('git').good(`baseline group "${saved.name}" — ${saved.on.map(p => `${p.repo}:${p.branch}`).join(', ')}`)
      return saved
    }
  },

  // A "use this line" action was here. It pointed every repository at one line, and what
  // a branch is measured against is now a fact about the branch — what it was
  // cut from, recorded when it was made. A workspace-wide pointer on top of that
  // was a second and worse answer to a question already answered, and moving it
  // reinterpreted every number on the board at once.

  lineForget: {
    about: 'Forget a line. Its branches are untouched, and stop being protected by it',
    needs: 'workspace',
    takes: ['name'],
    run: ({ name }) => {
      const gone = branches.deleteGroup(name)
      log.on('git').warn(`baseline group "${gone.deleted}" forgotten — its branches are untouched`)
      return gone
    }
  },

  linePropose: {
    about: 'Propose a line for landing. It appears on the left of a comparison and stays protected',
    needs: 'workspace',
    takes: ['name', 'why'],
    run: a => {
      const { name, why } = a
      const g = branches.markGroup(name, { why, by: s.whoAsked(a) })
      log.on('git').good(`"${g.name}" is proposed for landing${why ? ` — ${String(why).trim()}` : ''}`)
      return { ...g, note: `"${g.name}" is up to be landed. Compare it against the line it would go into, and unmark it to carry on working.` }
    }
  },

  lineWithdraw: {
    about: 'Take a line back out of being proposed, so work on it can continue',
    needs: 'workspace',
    takes: ['name'],
    run: ({ name }) => {
      const g = branches.unmarkGroup(name)
      log.on('git').warn(`"${g.name}" is no longer proposed`)
      return { ...g, note: `"${g.name}" is a line again rather than a proposal. Its branches stay protected while it is a group at all — delete the group to build on them directly.` }
    }
  },

  repoDefaults: {
    about: 'Each repository, its default branch, and the branches it has',
    needs: 'workspace',
    run: () => {
      const rows = branches.baselines()
      return {
        repos: rows,
        groups: branches.groups(),
        // Whether the repositories disagree about what their default is. Worth
        // saying, because it is why one branch's "commits ahead" is a sum of
        // things counted from different places — and it is the reason naming a
        // line matters here more than it would in one repository.
        mixed: [...new Set(rows.map(r => r.default))].length > 1,
        note: [...new Set(rows.map(r => r.default))].length > 1
          ? 'These repositories do not share a default branch, so a line is what says which point they are being read at together.'
          : 'Every repository has the same default branch.'
      }
    }
  },

  // BRINGING THE ANSWER BACK, which is the half of the round trip this app never
  // had. It pushes a line onward and opens pull requests; once those are merged
  // and the fork is synced, every default branch HERE is behind — and a branch
  // cut afterwards is cut from a stale point without anything saying so.
  //
  // One button for every repository, because it is one act: "the world moved on,
  // catch up". Doing it per repository would mean remembering which of three had
  // been done, which is the sort of bookkeeping that is always half finished.
  //
  // NOTHING IS DECIDED HERE. It fast-forwards or it reports why it did not; a
  // repository with local commits, or a dirty tree on its default branch, is
  // named and skipped. That is what makes it safe to press without reading
  // anything first, which is the entire value of it.
  repoSync: {
    about: 'Fetch from origin and fast-forward every repository\'s default branch',
    needs: 'workspace',
    run: () => {
      const rows = branches.baselines()
      if (!rows.length) throw new Error(`There are no repositories in ${repos.DIR} to sync.`)

      const done = []
      for (const r of rows) {
        try {
          done.push(remotes.syncDefault(r.repo))
        } catch (e) {
          // ONE REPOSITORY'S FAILURE IS NOT THE OTHERS'. Three repositories
          // where two synced is a real state and the useful one; refusing all
          // three because one has no remote would be the app deciding that a
          // partial answer is worse than none.
          done.push({ repo: r.repo, moved: false, why: (e.message || String(e)).split('\n')[0] })
        }
      }

      const moved = done.filter(d => d.moved)
      for (const d of moved) log.on('git', d.repo).good(`${d.branch} ${d.from} → ${d.to}, ${d.commits} commit(s) from origin`)
      for (const d of done.filter(d => !d.moved && d.why !== 'already up to date')) {
        log.on('git', d.repo).warn(d.why)
      }

      return {
        repos: done,
        moved: moved.length,
        note: moved.length
          ? `${moved.map(d => `${d.repo} ${d.branch} +${d.commits}`).join(', ')}. Branches cut from here now start from what origin has.`
          : done.every(d => d.why === 'already up to date')
            ? 'Every default branch already matches origin.'
            : 'Nothing moved. See the reasons above — this only fast-forwards.'
      }
    }
  },

  // Make one branch the baseline everywhere it exists.
  //
  // THIS IS WHAT CHAINING LOOKS LIKE FROM THE FRONT. A branch carrying finished
  // work becomes what the next work is counted from and cut from: the next task
  // starts where this one ended, rather than from a default branch that does not
  // have it yet. Setting that one repository at a time is the same decision typed
  // three times, and two of them being right is worse than none.
  //
  // Repositories that do not have the branch keep what they had, and are named.
  // A change that only touched two repositories should not silently move the
  // third's baseline to something it has never heard of.
  // branchAsBaseline was here, and repoBaseline after it. Both set the branch a
  // repository counts work from, and nothing counts from a repository any more:
  // a branch is measured against what it was cut from, which is recorded on the
  // branch when it is made and does not move afterwards.
  //
  // The useful half of branchAsBaseline -- naming a finished branch so the next
  // work can start there -- is branchAsLine.

  // What landing this line would be, read against the line it would land in.
  changeRead: {
    about: 'What one line carries that another does not: commits and changed files, per repository',
    needs: 'workspace',
    takes: ['source', 'target'],
    run: ({ source, target }) => {
      const pair = twoLines(source, target)
      const repos = pair.on.map(({ repo, head, base }) => ({
        ...artifact.inRepo(repo, head, base),
        // Named on every row, because "which branch is this repository's half of
        // the line" is the question a reader has to answer before anything else
        // on the row means anything.
        head,
        onlyHere: !base
      }))

      const carrying = repos.filter(r => !r.missing && !r.noBase && !r.empty)
      return {
        source: pair.source.name,
        target: pair.target.name,
        // Repositories the two lines do not share, which is a real answer rather
        // than an error: a line that reached two repositories cannot land in the
        // third, and neither can it be said to be missing from it.
        onlyInSource: pair.onlyInSource,
        onlyInTarget: pair.onlyInTarget,
        repos,
        anything: carrying.length > 0,
        commits: carrying.reduce((n, r) => n + r.ahead, 0),
        files: carrying.reduce((n, r) => n + r.files.length + r.moreFiles, 0),
        added: carrying.reduce((n, r) => n + r.added, 0),
        removed: carrying.reduce((n, r) => n + r.removed, 0),
        summary: carrying.length
          ? `${carrying.reduce((n, r) => n + r.ahead, 0)} commit(s) in ${carrying.map(r => r.repo).join(', ')}`
          : 'these two lines are the same'
      }
    }
  },

  changeDiff: {
    about: "One repository's changes between two lines, in full",
    needs: 'workspace',
    takes: ['source', 'target', 'repo', 'file'],
    run: ({ source, target, repo, file }) => {
      const pair = twoLines(source, target)
      const part = pair.on.find(p => p.repo === repo)
      if (!part) throw new Error(`"${repo}" is not in both lines. ${pair.source.name} and ${pair.target.name} share ${pair.on.map(p => p.repo).join(', ') || 'nothing'}.`)
      return {
        source: pair.source.name,
        target: pair.target.name,
        repo,
        file: file || null,
        base: part.base,
        head: part.head,
        diff: artifact.diff(repo, part.head, file, part.base)
      }
    }
  },

  // The two sides of one file, whole, for a view that shows them next to each
  // other instead of as one stream of plus and minus.
  changeFile: {
    about: 'One file as it is on each side of a comparison, for a side-by-side reading',
    needs: 'workspace',
    takes: ['source', 'target', 'repo', 'file'],
    run: ({ source, target, repo, file }) => {
      if (!file) throw new Error('Which file?')
      const pair = twoLines(source, target)
      const part = pair.on.find(p => p.repo === repo)
      if (!part) throw new Error(`"${repo}" is not in both lines.`)
      return {
        source: pair.source.name,
        target: pair.target.name,
        ...artifact.sides(repo, part.head, file, part.base)
      }
    }
  },

  // mergePlan and mergeLand were here: a dry run of the git commands that would
  // land a line into another, and the thing that ran them. Both are gone.
  //
  // A DEFAULT BRANCH IS PROTECTED, and this app was the one thing allowed to
  // merge into one anyway -- on the host, outside every rule it enforces on a
  // machine. That is the same category error as a machine pushing to master,
  // arriving through the door marked "but I am the tool".
  //
  // Landing is a pull request now. The review stays here, where it is fast and
  // local and reads the repositories directly; the landing goes where a landing
  // belongs, with its own approvals and its own history.
}
