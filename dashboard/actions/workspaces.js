'use strict'

// Which folder of repositories all of this is about, and the state where
// there is none.
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
  archive, files, prompts, defined, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s

module.exports = {
  // ---- which repositories this is about ---------------------------------
  //
  // See core/workspaces.js for why switching is guarded rather than free.
  workspaces: {
    about: 'The repository folders this app knows, and which one it is serving',
    run: () => {
      const list = workspaces.known()
      const now = workspaces.current()
      return {
        open: !!now,
        current: now,
        known: list,
        // Everything that would be left describing somewhere else. Reported
        // whether or not anybody is switching, because it is also the answer to
        // "why will it not let me".
        inTheWay: inTheWay(),
        where: workspaces.stateDir(),
        // WHAT STOPS WORKING WITH NONE OPEN, said here rather than discovered a
        // refusal at a time. It is also the clearest statement of the split this
        // app draws: a branch belongs to a folder of repositories, a machine
        // belongs to this host, and the second kind is exactly what somebody
        // needs while there is no first kind.
        gated: Object.entries(actions).filter(([, a]) => a.needs === 'workspace').map(([n]) => n),
        note: 'Tasks, branch reasons and baselines belong to a workspace and follow it. Machines, ssh hosts and approvals belong to this host and do not.'
      }
    }
  },

  // ---- what is kept, and where ------------------------------------------
  //
  // The split this app is built on is invisible from inside it. Some of what it
  // knows is about THIS COMPUTER -- its machines, its keys, its approvals, its
  // prompt library -- and some is about a WORKSPACE, and the second kind lives in
  // a folder of its own so that switching does not leave it describing somewhere
  // else. That is core/workspaces.js's whole argument, and until now nothing
  // could check it had actually happened.
  //
  // IT HAD NOT, QUITE. The one-time move of the pre-workspace files skips
  // anything whose destination already exists, which is the right call -- the
  // newer file is the real one -- and it leaves the old copy where it was, for
  // ever, looking authoritative. There is one of those. There is also a folder
  // for a workspace nobody remembers adding.
  //
  // NOTHING HERE DELETES ANYTHING. Data that is merely unreferenced is not data
  // that is safe to throw away, and the difference between "orphaned" and "the
  // only copy of something" is a judgement this cannot make. It reports; a
  // person decides.
  workspaceData: {
    about: 'What is kept for this computer, what is kept per workspace, and what has been left behind',
    run: () => {
      const look = at => {
        try {
          return fs.readdirSync(at, { withFileTypes: true })
            .filter(e => e.isFile())
            .map(e => {
              const full = path.join(at, e.name)
              let size = 0
              let touched = null
              try { const st = fs.statSync(full); size = st.size; touched = new Date(st.mtimeMs).toISOString() } catch { /* gone between the two calls */ }
              return { name: e.name, size, touched }
            })
            .sort((a, b) => a.name.localeCompare(b.name))
        } catch { return [] }
      }

      // The names that BELONG to a workspace. Anything with one of these at host
      // level is a copy that predates the split and is no longer read.
      const SCOPED = [
        'tasks.json', 'tasks-highest.json', 'repos.json', 'branches.json',
        'baseline-groups.json', 'landings.json', 'remotes.json',
        'pr-template.json', 'pr-drafts.json', 'judgements.json'
      ]

      const hostDir = data.state()
      const host = look(hostDir)
      const known = workspaces.known()
      const bySlug = new Map(known.map(w => [w.slug, w]))

      const root = path.join(data.DIR, 'workspaces')
      let folders = []
      try {
        folders = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
      } catch { /* nothing has been kept for any workspace yet */ }

      const kept = folders.map(slug => {
        const w = bySlug.get(slug) || null
        return {
          slug,
          dir: path.join(root, slug),
          name: w ? w.name : null,
          // A folder whose workspace is not in the list. It is not rubbish --
          // point the app at that folder again and this is its tasks -- it is
          // just nothing this app is currently offering.
          knows: !!w,
          current: !!(w && w.current),
          files: look(path.join(root, slug))
        }
      })

      const strays = host.filter(x => SCOPED.includes(x.name)).map(x => ({
        ...x,
        where: path.join(hostDir, x.name),
        // Which workspace folder now holds the same name, if any -- that is the
        // one being read, and this one is not.
        supersededBy: kept.filter(k => k.files.some(y => y.name === x.name)).map(k => k.slug)
      }))

      const unknown = kept.filter(k => !k.knows)

      return {
        host: { dir: hostDir, files: host },
        workspaces: kept,
        strays,
        unknown,
        note: strays.length || unknown.length
          ? `${strays.length} file(s) at host level that belong to a workspace, and ${unknown.length} folder(s) for a workspace this app is not offering. Nothing is read from either. Neither is deleted here.`
          : 'Everything that belongs to a workspace is in its own folder, and nothing is left at host level that should not be.'
      }
    }
  },

  workspaceAdd: {
    about: 'Remember a folder of repositories, without switching to it',
    takes: ['dir', 'name'],
    run: ({ dir, name }) => {
      const added = workspaces.add(dir, name)
      if (!added.already) log.on('server').good(`workspace "${added.name}" added — ${added.dir}`)
      return { ...added, repos: repos.list().length }
    }
  },

  workspaceUse: {
    about: 'Serve a different folder of repositories',
    takes: ['dir'],
    run: ({ dir }) => {
      // NONE OPEN IS THE ORDINARY CASE HERE, not an edge one -- it is what the
      // welcome landing offers this action from, and every workspace after a
      // close is opened out of it.
      const was = workspaces.current()
      const same = was && path.resolve(String(dir || '')) === path.resolve(was.dir)
      if (same) return { ...was, changed: false, note: 'That is already the one in use.' }

      // REFUSED WHILE ANYTHING TIES A MACHINE TO THIS ONE.
      //
      // A machine set up on a branch cannot be reasoned about from a workspace
      // that has no such branch: its claim names something that does not exist,
      // the queue's idea of free changes underneath it, and a task in flight is
      // delivering to a repository nobody is serving any more. None of that
      // errors -- it just quietly becomes wrong, which is the failure this whole
      // separation exists to prevent.
      const stuck = inTheWay()
      if (stuck.length) {
        throw new Error(`Not while ${stuck.map(s => s.why).join('; ')}. Finish or put that away first — switching now would leave it describing a workspace nobody is serving.`)
      }

      const now = workspaces.use(dir)
      log.on('server').good(`now serving ${now.dir} — ${repos.list().length} repositories`)
      return {
        ...now,
        was: was ? was.dir : null,
        changed: true,
        repos: repos.list().map(r => r.name),
        note: `Its tasks, branch reasons and baselines are its own. The machines are this host's and did not move.`
      }
    }
  },

  // PUT DOWN WITHOUT BEING FORGOTTEN, and refused for exactly the same reasons
  // switching is. Closing is not the safe half of switching: a machine set up on
  // a branch is left naming something nothing is serving either way, and a task
  // out on a machine has nowhere to deliver. The one difference is that this has
  // no destination, so what it leaves behind is a window that says so.
  workspaceClose: {
    about: 'Stop serving any folder of repositories, without forgetting it',
    run: () => {
      const was = workspaces.current()
      if (!was) return { closed: true, changed: false, note: 'None was open.' }

      const stuck = inTheWay()
      if (stuck.length) {
        throw new Error(`Not while ${stuck.map(s => s.why).join('; ')}. Finish or put that away first — closing now would leave it describing a workspace nobody is serving.`)
      }

      workspaces.close()
      log.on('server').warn(`closed ${was.dir} — nothing about repositories, branches or tasks is being served`)
      return {
        closed: true,
        changed: true,
        was: was.dir,
        wasName: was.name,
        note: 'Its tasks, branch reasons and baselines are kept where they are and come back with it. The machines are this host\'s and are untouched.'
      }
    }
  },

  workspaceForget: {
    about: 'Stop offering a folder. What is known about it is kept',
    takes: ['dir'],
    run: ({ dir }) => workspaces.forget(dir)
  },
}
