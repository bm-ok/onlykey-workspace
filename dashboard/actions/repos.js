'use strict'

// The repositories and the far end of them: what GitHub says, and a change
// once it has left as one pull request per repository.
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
  // ---- the repositories themselves ---------------------------------------
  //
  // The ground everything else stands on, and until now it had no surface. A
  // repository appeared only as a column inside a branch or a task, with nothing
  // saying where it came from, whether this host is in step with it, or whether
  // the token can reach it. That was invisible while they were local folders. It
  // stopped being invisible the moment they had somewhere to go.
  //
  // TWO ACTIONS, AND THE SPLIT IS THE POINT. `repositories` is local and instant
  // and safe to call on every draw; `repositoriesCheck` goes to GitHub and is
  // asked for. The window redraws every three seconds, so anything it calls is
  // on a timer — and this codebase has already paid twice for forgetting that
  // with git processes. Doing it with somebody else's service would be the same
  // fault with rate limits attached.
  repositories: {
    about: 'Every repository in this workspace: where it is, its default branch, its remote, and what was last learnt about it',
    needs: 'workspace',
    run: () => ({
      dir: repos.DIR,
      repos: remotes.read(),
      note: 'What is known about a remote is only as true as the moment it was read. Check it to ask again.'
    })
  },

  // ---- everything waiting, in one list -----------------------------------
  //
  // Pull requests and issues across every repository, read as one list rather
  // than as a tour of three tabs. The question it answers is "what is waiting on
  // me", and that question is not per repository — it only became one because
  // GitHub's pages are.
  //
  // A CUT IS ONE ROW. Three pull requests that are one change appear once, with
  // the three underneath, because reading them as three separate things is the
  // exact mistake this app exists to stop: they are approved separately, and
  // they are not done separately.
  //
  // Assembled from what was already gathered, so it costs nothing and is as old
  // as the last "Ask GitHub". Sorting and filtering happen in the window, where
  // they are instant.
  repoOverview: {
    about: 'Everything open across the workspace — issues, pull requests, and PR cuts as one row each',
    needs: 'workspace',
    run: () => {
      const rows = remotes.read()
      const cuts = landings.all()

      // Which pull requests belong to a cut, so they are not also listed loose.
      const partOf = new Map()
      for (const [key, cut] of Object.entries(cuts)) {
        for (const p of cut.pulls || []) if (p.number) partOf.set(`${p.repo}#${p.number}`, key)
      }

      const items = []
      const grouped = new Map()

      for (const r of rows) {
        for (const p of r.pulls || []) {
          const key = partOf.get(`${r.repo}#${p.number}`)
          if (!key) {
            items.push({
              kind: 'pull', id: `${r.repo}#${p.number}`, repo: r.repo, repos: [r.repo],
              title: p.title, number: p.number, url: p.url,
              state: p.merged ? 'merged' : p.state, draft: !!p.draft,
              at: p.updated || p.at || null, on: r.parent || r.repo, parts: null
            })
            continue
          }
          if (!grouped.has(key)) {
            const cut = cuts[key]
            grouped.set(key, {
              kind: 'cut', id: key, repo: null, repos: [],
              title: (cut.said && cut.said.title) || cut.source,
              source: cut.source, target: cut.target,
              number: null, url: null, state: 'open', at: cut.opened, on: null, parts: []
            })
          }
          const g = grouped.get(key)
          g.repos.push(r.repo)
          g.parts.push({ repo: r.repo, number: p.number, url: p.url, state: p.merged ? 'merged' : p.state, draft: !!p.draft })
        }

        for (const i of r.issues || []) {
          items.push({
            kind: 'issue', id: `${r.repo}!${i.number}`, repo: r.repo, repos: [r.repo],
            title: i.title, number: i.number, url: i.url, state: i.state, draft: false,
            at: i.updated || i.at || null, on: i.on || r.repo, by: i.by, labels: i.labels || [],
            // Carried so a task can be written from this list without going
            // back to the per-repository tab to find the words again.
            body: i.body || null, parts: null
          })
        }
      }

      // A cut's state is the whole cut's: merged only when every one of them is,
      // which is the sentence this app exists to be able to say.
      for (const g of grouped.values()) {
        const merged = g.parts.filter(p => p.state === 'merged').length
        g.state = merged === g.parts.length ? 'merged' : g.parts.some(p => p.state === 'open') ? 'open' : 'closed'
        g.summary = `${merged} of ${g.parts.length} merged`
      }

      const all = [...grouped.values(), ...items]
      const gathered = rows.map(r => r.gathered).filter(Boolean).sort()

      return {
        items: all,
        repos: rows.map(r => r.repo),
        asked: gathered.length ? gathered[0] : null,
        counts: {
          all: all.length,
          open: all.filter(x => x.state === 'open').length,
          issues: all.filter(x => x.kind === 'issue').length,
          pulls: all.filter(x => x.kind === 'pull').length,
          cuts: all.filter(x => x.kind === 'cut').length
        },
        note: gathered.length
          ? 'As of the last time GitHub was asked. Ask again for anything newer.'
          : 'Nothing has been read from GitHub yet.'
      }
    }
  },

  repositoriesCheck: {
    about: 'Ask GitHub about the repositories: reachability, what the token may do, open issues and pull requests',
    needs: 'workspace',
    takes: ['repo'],
    run: async ({ repo }) => {
      // Everything on one trip: reachability, what is open, and what is being
      // asked. They are the same journey, and three buttons would be three.
      const rows = await remotes.gather(repo || null)
      for (const r of rows) {
        if (r.reachable === true && !r.why) log.on('git', r.repo).good('reachable, and the token may use its code and pull requests')
        else if (r.reachable === true) log.on('git', r.repo).warn(r.why)
        else if (r.reachable === false) log.on('git', r.repo).bad(`cannot be reached: ${r.why}`)
      }
      const stuck = rows.filter(r => r.reachable !== true || r.why)
      return {
        repos: rows,
        note: stuck.length
          ? `${stuck.length} of ${rows.length} need attention: ${stuck.map(r => `${r.repo} — ${r.why}`).join('; ')}`
          : `All ${rows.length} are reachable and the token may use them.`
      }
    }
  },

  // ---- the token this host reaches GitHub with ---------------------------
  //
  // The second credential this app keeps, and the second it cannot remake. A
  // machine is never handed it: runners push to this host's own git server, and
  // the host pushes onward — so a rolled-back machine cannot leak a token it
  // never had. That is the whole reason for the extra hop.
  //
  // NONE OF THESE RETURN IT. Not once, not partially, not in an error. The only
  // code that reads the file is the request that spends it.

  // What a machine could clone, and the address it would use. The address is
  // built from the same host lookup a guest is given for its scripts, because a
  // guest cannot reach us on loopback and an address that only works here is the
  // one mistake this is easy to make.
  gitRepos: {
    about: 'The repositories in the workspace that a machine can clone, and where from',
    needs: 'workspace',
    takes: ['name'],
    run: async ({ name }) => {
      const found = repos.list()
      let host = null
      try { host = await vbox.hostAddress() } catch { /* said as null below */ }
      const vm = name ? vms.get(name) : null
      return {
        from: repos.DIR,
        host,
        repos: found.map(r => ({
          ...r,
          // Only spelled out for a named machine: the token is that machine's,
          // and a URL with somebody else's in it would not work anyway.
          url: host && vm
            ? `http://${vm.name}:${vm.spec.token}@${host}:${net.port}/git/${r.name}`
            : host ? `http://<machine>:<its token>@${host}:${net.port}/git/${r.name}` : null
        }))
      }
    }
  },

  githubHeld: {
    about: 'Whether this host holds a GitHub token, who it belongs to, and whether it works',
    run: () => github.held()
  },

  githubKeySet: {
    about: 'Keep a GitHub token on this host, sealed. It is checked against GitHub before it is kept',
    takes: ['token', 'api'],
    run: async ({ token, api }) => {
      const said = await github.put(token, { api })
      // The login, never the token — and said out loud, because "which account
      // is this acting as" is the question somebody asks after something has
      // been opened under the wrong one.
      log.on('github').good(`token kept for ${said.login}${said.kind ? ` (${said.kind})` : ''}${said.expires ? `, expires ${said.expires}` : ''}`)
      return {
        ...said,
        note: `Kept and checked: GitHub says this is ${said.login}. It is sealed for this Windows account and no machine is ever handed it.`
      }
    }
  },

  githubCheck: {
    about: 'Ask GitHub whether the token still works, and what it is',
    run: async () => {
      const said = await github.check()
      log.on('github')[said.ok ? 'good' : 'bad'](said.ok
        ? `token works — ${said.login}`
        : `token does not work: ${said.why}`)
      return {
        ...said,
        note: said.ok
          ? `It works. GitHub says this is ${said.login}.`
          : `It does not work: ${said.why}. Replace it on the Keys tab.`
      }
    }
  },

  githubKeyForget: {
    about: 'Throw away the GitHub token this host holds',
    run: () => {
      const gone = github.forget()
      log.on('github').warn(gone.forgotten ? 'the GitHub token was thrown away' : 'there was no GitHub token to throw away')
      return { ...gone, note: gone.forgotten ? 'Gone from this host. Revoke it on GitHub too if it may have been seen.' : 'There was none.' }
    }
  },

  // What this host holds, and where it came from.
  //
  // The credential itself is never returned -- not to the window, not to the
  // command line. What a person needs to know is whether there is one, which
  // machine it was taken from and when; the value is only ever handed to a
  // machine that needs it. A page that displays a secret is a page that gets
  // screenshotted.
  // ---- sending a change out ----------------------------------------------
  //
  // The end of the chain. A line is read here, and then it leaves: each
  // repository that carries work has its branch pushed onward and a pull request
  // opened for it. Nothing merges anything — a default branch is protected, and
  // that includes from this app.
  //
  // ONE LANDING, N PULL REQUESTS. GitHub has no idea the three are one change,
  // so holding them together is the part only this can do.
  prCutMake: {
    about: 'Push a line onward and open a pull request per repository, tracked together as one landing',
    needs: 'workspace',
    takes: ['source', 'target', 'title', 'body', 'into', 'draft'],
    run: async ({ source, target, title, body, into, draft, _overTheWire }) => {
      const pair = twoLines(source, target)
      const carrying = []
      for (const { repo, head, base } of pair.on) {
        const art = artifact.inRepo(repo, head, base)
        if (!art.missing && !art.noBase && art.ahead > 0) carrying.push({ repo, head, base, ahead: art.ahead })
      }
      if (!carrying.length) throw new Error(`"${pair.source.name}" carries nothing that "${pair.target.name}" does not already have.`)

      const said = String(title || '').trim() || pair.source.name
      // WHAT SOMEBODY TYPED, PLUS WHAT THIS APP ALREADY KNOWS. The blocks that
      // are on are written from facts nobody should have to look up -- why the
      // branch was cut, what the task asked for, which commit each repository
      // ends at. See repos/prtemplate.js.
      const context = prtemplate.about(pair.source.name, pair.target.name)
      const typed = String(body || '').trim()

      const done = []
      for (const c of carrying) {
        // PUSHED FIRST, because a pull request needs a branch that is there. A
        // push that fails stops this repository and not the others: three
        // repositories where two are pushable is a real state, and refusing all
        // three because of one helps nobody.
        try {
          remotes.pushBranch(c.repo, c.head)
          log.on('git', c.repo).good(`pushed ${c.head} to origin`)
        } catch (e) {
          const why = String(e.stderr || e.message || e).split('\n').filter(Boolean).pop()
          log.on('git', c.repo).bad(`could not push ${c.head}: ${why}`)
          done.push({ repo: c.repo, opened: false, why: `could not push: ${why}` })
          continue
        }

        const pr = await remotes.openPull(c.repo, {
          branch: c.head,
          base: c.base,
          title: said,
          body: prtemplate.composeFor(typed, context, c.repo),
          into: into || null,
          // THE OTHER KIND OF DRAFT: opened on GitHub and marked not ready for
          // review. It is a public pull request with a number -- the opposite of
          // the local kind, which is the absence of one.
          draft: draft === true || draft === 'true'
        })
        if (pr.opened) log.on('git', c.repo).good(`pull request #${pr.number} into ${pr.into} — ${pr.url}`)
        else log.on('git', c.repo)[pr.already ? 'warn' : 'bad'](`no pull request opened: ${pr.why}`)
        done.push(pr)
      }

      // THE SECOND PASS, and the reason a cut is worth being a thing.
      //
      // Cross-links are numbers that did not exist when the first pull request
      // was opened -- each one can only name the others once all of them are
      // there. So they are opened, and then every one of them is written again
      // with the full set. Nothing outside this app is in a position to do that.
      const opened = done.filter(d => d.opened)
      if (opened.length > 1 && prtemplate.on().crosslinks) {
        const withLinks = { ...context, pulls: opened.map(o => ({ repo: o.repo, number: o.number, url: o.url })) }
        for (const o of opened) {
          const r = await remotes.updatePull(o.repo, o.number, { body: prtemplate.composeFor(typed, withLinks, o.repo) })
          if (!r.ok) log.on('git', o.repo).warn(`opened, but the links to the others were not added: ${r.why}`)
        }
        log.on('git').good(`${opened.length} pull requests now name each other`)
      }

      // SPENT ONCE IT IS CUT. What was written is now what the pull requests
      // say; a draft left behind would be an older copy of them, and the editor
      // would offer it back as though it were newer.
      if (opened.length) drafts.forget(pair.source.name, pair.target.name)

      const record = landings.record(pair.source.name, pair.target.name, done, _overTheWire ? 'the command line' : 'the window')
      return {
        source: pair.source.name,
        target: pair.target.name,
        pulls: done,
        landing: record,
        note: opened.length === done.length
          ? `${opened.length} pull request(s) opened: ${opened.map(o => `${o.repo} #${o.number}`).join(', ')}. It has landed when all of them have.`
          : `${opened.length} of ${done.length} opened. ${done.filter(d => !d.opened).map(d => `${d.repo}: ${d.why}`).join('; ')}`
      }
    }
  },

  prCutState: {
    about: 'What became of a change that was sent out: each pull request, read from GitHub',
    needs: 'workspace',
    takes: ['source', 'target'],
    run: async ({ source, target }) => {
      const at = await landings.state(source, target)
      if (!at) return { landed: null, note: 'This pair has not been sent out from here.' }
      return {
        ...at,
        note: at.landed
          ? `Landed: all ${at.count} pull request(s) are merged.`
          : `${at.summary}. It is not landed until every one of them is.`
      }
    }
  },

  prCuts: {
    about: 'Every PR cut: one act, one pull request per repository, and how far each has got',
    needs: 'workspace',
    run: async () => {
      const all = landings.all()
      const rows = []
      for (const k of Object.keys(all)) {
        const at = await landings.state(all[k].source, all[k].target)
        if (at) rows.push(at)
      }
      return {
        cuts: rows,
        note: rows.length
          ? `${rows.filter(r => r.landed).length} of ${rows.length} landed.`
          : 'Nothing has been cut yet. A PR cut is made from a proposed line on the Changes tab.'
      }
    }
  },

  // ---- what anybody thought of it ---------------------------------------
  //
  // Every cut, with the judgements made on it and whether each still describes
  // what is there. Read-only: this says what is known, and nothing here makes a
  // judgement or asks for one.
  //
  // THE TIPS ARE READ FRESH, from git, every time. A judgement carries the commit
  // each repository ended at when it was made; whether that is still where they
  // are is a fact about the repositories now, and remembering it here would be
  // this app keeping a copy of something that changes without asking it. That is
  // the same rule the landings follow for what GitHub says.
  judgements: {
    about: 'Every PR cut, what has been judged about it, and which judgements still describe what is there',
    needs: 'workspace',
    run: () => {
      const cuts = landings.all()
      const rows = []

      for (const k of Object.keys(cuts)) {
        const cut = cuts[k]
        const made = judgements.on(cut.source, cut.target)

        // Where each repository actually is now. `about` returns null when the
        // lines behind a cut have gone, which is a thing to say rather than a
        // thing to crash on.
        const now = {}
        let context = null
        try { context = prtemplate.about(cut.source, cut.target) } catch { context = null }
        for (const r of (context ? context.repos : [])) now[r.repo] = r.tip

        const list = made.map(j => ({ ...j, stale: judgements.staleAgainst(j, now) }))
        const live = list.filter(j => !j.stale)

        rows.push({
          id: k,
          source: cut.source,
          target: cut.target,
          title: (cut.said && cut.said.title) || cut.source,
          repos: Object.keys(now),
          tips: now,
          judgements: list,
          // A cut whose only judgement predates the last push is exactly as
          // unjudged as one with none, and the count that matters says so.
          count: list.length,
          current: live.length,
          stale: list.length - live.length,
          // Said rather than counted, because "none" and "one, but not of this"
          // are the two states worth telling apart at a glance.
          reads: !list.length
            ? 'not judged'
            : live.length
              ? `${live.length} judgement${live.length === 1 ? '' : 's'} of what is there now`
              : `${list.length} judgement${list.length === 1 ? '' : 's'}, all of an earlier state`
        })
      }

      return {
        cuts: rows,
        // JUDGING IS OPTIONAL, and this is the sentence that has to keep saying
        // so. Nothing here is owed, nothing is blocked on it, and the moment this
        // reads as a chore it has become a checklist rather than a tool.
        note: rows.length
          ? 'A judgement is a reading of a change at the commits it was read at. Nothing is owed one.'
          : 'Nothing has been cut yet, so there is nothing to judge. A judgement is made on a PR cut.'
      }
    }
  },

  // CHANGING ALL OF THEM AT ONCE, which is the whole reason a cut is a thing.
  //
  // Three pull requests describing one change drift apart the moment one of them
  // is edited, and then a reviewer reads a different story depending on which
  // repository they happened to open. Nobody keeps three descriptions in step by
  // hand; this is what "one PR in the dashboard updates all three" means.
  prCutUpdate: {
    about: 'Change the title, the description, or the state of every pull request in a cut at once',
    needs: 'workspace',
    takes: ['source', 'target', 'title', 'body', 'state'],
    run: async ({ source, target, title, body, state }) => {
      const rec = landings.all()[landings.key(source, target)]
      if (!rec) throw new Error(`Nothing has been cut from "${source}" into "${target}".`)

      const fields = {}
      if (title != null && String(title).trim()) fields.title = String(title).trim()
      if (body != null) fields.body = String(body)
      if (state) {
        const want = String(state).toLowerCase()
        if (want !== 'open' && want !== 'closed') throw new Error('A pull request is "open" or "closed".')
        fields.state = want
      }
      if (!Object.keys(fields).length) throw new Error('Nothing to change. Give a title, a description, or a state.')

      const done = []
      for (const p of rec.pulls) {
        if (!p.number) { done.push({ repo: p.repo, ok: false, why: 'never opened' }); continue }
        const r = await remotes.updatePull(p.repo, p.number, fields)
        log.on('git', p.repo)[r.ok ? 'good' : 'bad'](r.ok
          ? `#${p.number} updated`
          : `#${p.number} not updated: ${r.why}`)
        done.push(r)
      }

      // KEPT ONLY WHERE IT IS OURS TO KEEP. The title and body of the cut are
      // this app's record of what was asked for; whether a pull request is open
      // is GitHub's, and is re-read rather than written down.
      landings.describe(source, target, fields)

      const ok = done.filter(d => d.ok)
      return {
        source,
        target,
        changed: done,
        note: ok.length === done.length
          ? `All ${ok.length} updated.`
          : `${ok.length} of ${done.length} updated. ${done.filter(d => !d.ok).map(d => `${d.repo}: ${d.why}`).join('; ')}`
      }
    }
  },

  prCutForget: {
    about: 'Stop tracking a PR cut here. The pull requests on GitHub are untouched',
    needs: 'workspace',
    takes: ['source', 'target'],
    run: ({ source, target }) => {
      const gone = landings.forget(source, target)
      log.on('git').warn(`stopped tracking the PR cut ${gone.forgotten}`)
      return { ...gone, note: 'Forgotten here. Nothing on GitHub was closed or changed — this only stops holding them together.' }
    }
  },

  prTemplate: {
    about: 'What a pull request says beyond what somebody typed: the blocks that are on, and what each adds',
    needs: 'workspace',
    run: () => ({
      blocks: prtemplate.blocks(),
      note: 'Every block is off until it is turned on. A description that adds things nobody asked for is one people stop reading.'
    })
  },

  prTemplateSet: {
    about: 'Turn a template block on or off',
    needs: 'workspace',
    takes: ['id', 'on'],
    run: ({ id, on }) => {
      if (!prtemplate.BLOCKS.some(b => b.id === id)) {
        throw new Error(`There is no block called "${id}". There is: ${prtemplate.BLOCKS.map(b => b.id).join(', ')}.`)
      }
      const want = on === true || on === 'true' || on === 1 || on === '1'
      prtemplate.set({ [id]: want })
      log.on('git').info(`pull request template: ${id} ${want ? 'on' : 'off'}`)
      return { blocks: prtemplate.blocks(), note: `"${id}" is ${want ? 'on' : 'off'}.` }
    }
  },

  // WRITTEN FROM REAL FACTS, not from a sample. A preview made of placeholders
  // shows whether the layout is pretty; this shows whether the thing it will
  // actually say is worth saying.
  prTemplatePreview: {
    about: 'What a pull request would say for a given pair of lines, composed from the blocks that are on',
    needs: 'workspace',
    takes: ['source', 'target', 'title', 'body', 'repo'],
    run: ({ source, target, title, body, repo }) => {
      const context = prtemplate.about(source, target)
      if (!context) throw new Error('Those two lines are not both named here.')
      if (!context.repos.length) return { text: '', repos: [], note: `"${source}" carries nothing that "${target}" does not already have, so no pull request would be opened.` }

      // REAL NUMBERS WHEN THERE ARE ANY. Once a cut exists its pull requests
      // have numbers, so the cross-links can be the actual ones — which is what
      // an edit is going to write. Before that they cannot be known, and are
      // shown as ? rather than invented, because a preview that guesses is the
      // one thing a preview must not do.
      const cut = landings.all()[landings.key(source, target)]
      const real = cut && cut.pulls ? cut.pulls.filter(p => p.number) : []
      const pulls = real.length
        ? real.map(p => ({ repo: p.repo, number: p.number, url: p.url }))
        : context.repos.map(r => ({ repo: r.repo, number: '?', url: `https://github.com/…/pull/?  (${r.repo})` }))

      const on = context.repos.map(r => r.repo)
      const which = repo && on.includes(repo) ? repo : on[0]
      const typed = String(body || '').trim()

      return {
        repos: on,
        showing: which,
        // SEPARATELY, so the window can recompose as somebody types without
        // asking again. What the blocks add does not depend on what is typed —
        // only on the pair of lines and which copy — so it is fetched once and
        // the sentence in front of it is joined on locally.
        additions: prtemplate.composeFor('', { ...context, pulls }, which),
        text: prtemplate.composeFor(typed, { ...context, pulls }, which),
        title: String(title || '').trim() || (cut && cut.said && cut.said.title) || source,
        said: (cut && cut.said) || null,
        existing: cut ? { count: real.length, opened: cut.opened } : null,
        guessing: !real.length,
        note: `As ${which} would read it. ${on.length} repositor${on.length === 1 ? 'y' : 'ies'} carry work: ${on.join(', ')}.` +
          (real.length ? ' The links are the real pull request numbers.' : ' Nothing is cut yet, so the links show ? until it is.')
      }
    }
  },

  // ---- what is written and not sent yet ----------------------------------
  //
  // TWO THINGS ARE CALLED A DRAFT. This is the one that exists only here: a
  // title and a description for a pair of lines, with nothing pushed and nobody
  // else able to see it. The other is a pull request that HAS been opened and is
  // marked not-ready-for-review, which is `draft` on prCutMake.
  prDraft: {
    about: 'What has been written for a pair of lines and not cut yet',
    needs: 'workspace',
    takes: ['source', 'target'],
    run: ({ source, target }) => ({
      draft: drafts.read(source, target),
      note: 'Kept in this workspace only. Nothing is pushed and nobody else can see it.'
    })
  },

  prDraftSave: {
    about: 'Keep what has been written for a pair of lines, without cutting anything',
    needs: 'workspace',
    takes: ['source', 'target', 'title', 'body'],
    run: ({ source, target, title, body }) => {
      if (!source || !target) throw new Error('A draft is about a pair of lines. Say which two.')
      const kept = drafts.save(source, target, { title, body })
      return { draft: kept, note: kept ? 'Kept.' : 'Nothing in it, so nothing is kept.' }
    }
  },

  prDraftForget: {
    about: 'Throw away what was written for a pair of lines',
    needs: 'workspace',
    takes: ['source', 'target'],
    run: ({ source, target }) => {
      const gone = drafts.forget(source, target)
      return { ...gone, note: gone.forgotten ? 'Thrown away.' : 'There was none.' }
    }
  },
}
