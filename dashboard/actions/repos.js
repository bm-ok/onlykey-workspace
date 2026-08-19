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
  log, keys, ssh, data, secret, github, remotes, landings, prtemplate, drafts, allowed, judgements, settings,
  vbox, vms, provisioner, scripts, channel, tasks, judging, artifact,
  archive, files, prompts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines, whoAsked
} = s

// ---- reading a long list off GitHub ----------------------------------------
//
// Two actions below read lists that get long — issues and pull requests — and
// they share the same two questions: which repository, and how to ask for more.
// Written once here rather than twice down there, because the second copy is
// where the wording drifts.

// WHICH REPOSITORY. `on` names any as owner/name; `repo` is one this workspace
// holds, read from its PARENT where it is a fork, because a fork's own tracker
// is usually empty and usually disabled and the conversation happens upstream.
const whichRepo = ({ repo, on }) => {
  const named = String(on || '').trim()
  if (named) return named
  if (!repo) throw new Error('Say which repository: "repo" for one in this workspace, or "on" as owner/name for any other.')

  // EITHER NAME IN EITHER FIELD, because the distinction is this app's and not
  // anybody else's.
  //
  // `repo` is meant to be the workspace name and `on` the owner/name — and a
  // caller holding "bmatusiak/local-repo-a" has no way to know which field this
  // app files that under, so it puts it in `repo` and is told the repository
  // does not exist. Which is false, and is the last thing that helps: it is the
  // one repository the caller was most sure about.
  //
  // Refused three times before this was fixed, always by the supervisor, always
  // recovered from by guessing the other field. The same shape as the allowance
  // key that could not be looked up — an internal distinction leaking out as an
  // error about the world.
  if (String(repo).includes('/')) return String(repo).trim()

  const row = remotes.read().find(r => r.repo === String(repo))
  if (!row) throw new Error(`There is no repository called "${repo}" in this workspace. If you meant a repository on GitHub, its owner/name works here too.`)
  const where = row.issuesOn || (row.remote && row.remote.owner ? `${row.remote.owner}/${row.remote.repo}` : '')
  if (!where) throw new Error(`"${repo}" has no GitHub remote this host can read from.`)
  return where
}

// HOW TO ASK FOR THE NEXT PAGE, in words, because the thing reading this is
// often a model and a cursor is not guessable.
//
// It says how many pages there are only when GitHub says: big trackers are
// cursor-paged now and answer with a next and no last, so there is no count.
// The first version of this printed "Page 1 of 1" beside a next page, which is
// a sentence that is wrong twice.
const howToGoOn = (said, what) => {
  const many = said[what === 'issue' ? 'issues' : 'pulls'] || []
  // A walk by cursor has no page numbers at all — see repos/remotes.js — so
  // "where am I" is answered by the cursor rather than by a number that would be
  // true about the request and false about the answer.
  const here = said.page ? `Page ${said.page}` : 'This page'

  if (!said.more) {
    return said.page === 1
      ? `${many.length} ${what}(s), and there is only one page.`
      : `${here} is the last — ${many.length} ${what}(s) on it.`
  }
  const how = said.nextAfter
    ? `ask again with after "${said.nextAfter}"`
    : `ask again with page ${said.nextPage}`
  return said.pages
    ? `${here} of ${said.pages} — ${how} for the next ${said.asked}.`
    : `${here}, and there is more. GitHub does not say how many pages this repository has — ${how} for the next ${said.asked}, and keep going until "more" is false.`
}

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
  // ---- WHERE WORK GOES, AND WHO DECIDED -----------------------------------
  //
  // See the head of targetOf in repos/remotes.js for the reasoning. The short
  // form: a change belongs in the fork you forked FROM, because if the project
  // itself were the destination you would have forked the project. GitHub cannot
  // answer this -- it reports one level up and the root, never the middle of a
  // longer chain -- so the chain is walked, and a person picks.
  // POINTING A REPOSITORY SOMEWHERE ELSE, which is a bigger act than it looks:
  // origin is where every branch this host cuts ends up, and it is the bottom
  // of the chain everything else is measured from.
  //
  // NOT REFUSED TO THE COMMAND LINE, for the same reason skillSave is not: this
  // is a git remote in a checkout, and anything with a shell can already change
  // it. A refusal here would catch the one caller that cannot reach around it.
  // The supervisor is shut out by not being on its allowlist, which is where
  // that rule lives.
  repoRemoteSet: {
    about: 'Point a repository at a different remote. Everything learnt about the old one is forgotten, including where work was going',
    needs: 'workspace',
    takes: ['repo', 'url'],
    run: async ({ repo, url }) => {
      const moved = remotes.setRemote(repo, url)
      log.on('git', repo).warn(`origin moved from ${moved.was || '(none)'} to ${moved.now}`)

      // ASKED ABOUT IMMEDIATELY, because everything this app knows about the
      // repository was just thrown away and a panel showing nothing reads the
      // same as a repository that cannot be reached.
      let checked = null
      try { checked = await actions.repositoriesCheck.run({ repo }) } catch (e) { checked = { note: `it could not be checked yet: ${e.message}` } }

      return {
        ...moved,
        checked: checked && checked.note ? checked.note : null,
        note: `"${repo}" points at ${moved.now} now. Everything learnt about ${moved.was || 'the old remote'} was forgotten, including where work was going — walk the chain and pick that again.`
      }
    }
  },

  repoChain: {
    about: "The fork chain above a repository, walked one link at a time — where work could go, and which of them this host may push to",
    needs: 'workspace',
    takes: ['repo'],
    run: async ({ repo }) => {
      if (!repo) throw new Error('Say which repository to walk from.')
      const walked = await remotes.chainOf(repo)
      const now = remotes.targetOf(repo)

      // WHICH LINK IS THE ONE IN USE, marked on the walk rather than left for
      // the reader to match strings.
      const links = walked.links.map(l => ({
        ...l,
        self: l.on === now.self,
        target: l.on === now.on,
        // Only the immediate parent syncs with one call -- see syncFork.
        syncsCheaply: !!l.immediate
      }))

      log.on('github', repo).info(`walked ${walked.deep} link(s) above ${repo}`)
      return {
        ...walked,
        links,
        target: now,
        note: walked.stopped
          ? `The walk stopped: ${walked.stopped}`
          : (links.length > 1
              ? `${links.length - 1} repositor${links.length === 2 ? 'y' : 'ies'} above this one. Work goes to ${now.on}${now.chosen ? ', which you picked' : ' — your own remote, because nothing has been picked'}.`
              : 'Nothing above this one: it is not a fork, so it is the project and work belongs here.')
      }
    }
  },

  repoTarget: {
    about: 'Where a repository sends work: which fork issues are read from and pull requests open into',
    needs: 'workspace',
    takes: ['repo'],
    run: ({ repo }) => {
      const rows = repo ? [String(repo)] : remotes.read().map(r => r.repo)
      const targets = rows.map(name => {
        const now = remotes.targetOf(name)
        return {
          repo: name,
          ...now,
          // SAID IN A SENTENCE, because a bare name cannot carry whether
          // anybody chose it, and that is the whole distinction.
          says: now.chosen
            ? `Issues are read from ${now.on} and pull requests open into it. You picked that${now.at ? ' on ' + now.at.slice(0, 10) : ''}.`
            : `Nothing has been picked, so this is self-contained: issues and pull requests both stay on ${now.on}, your own remote. Nothing upstream is watched.`
        }
      })
      return {
        targets,
        note: targets.some(x => !x.chosen)
          ? 'A repository nobody has pointed anywhere keeps to itself, which is right when it IS the project and inert when it is a fork — the worst a misconfiguration can do is open a pull request against yourself. repoChain walks what is above one.'
          : null
      }
    }
  },

  repoTargetSet: {
    about: 'Point a repository at the fork it sends work to. A person, in the window',
    needs: 'workspace',
    takes: ['repo', 'on', 'why'],
    run: async ({ repo, on, why = null, _overTheWire, _driven }) => {
      // WHICH REPOSITORY A CHANGE IS PUSHED INTO IS A DECISION WITH A NAME ON
      // IT. The same argument as allowing a stranger's pull request to be
      // judged: a model may not decide whose repository this host opens work
      // against, and a driven click is not a person either.
      if (_overTheWire || _driven) {
        throw new Error('Where work goes is picked in the window, by a person. It decides whose repository this host opens pull requests against and whose issues it acts on, which is not a decision to take down a pipe.')
      }
      const row = remotes.read().find(x => x.repo === String(repo))
      if (!row) throw new Error(`There is no repository called "${repo}" in this workspace.`)

      const want = String(on || '').trim()
      if (!want) {
        const cleared = remotes.setTarget(repo, null, { by: whoAsked({ _overTheWire, _driven }) })
        log.on('github', repo).warn('no longer points anywhere — it keeps to itself')
        return { ...cleared, repo, note: `"${repo}" keeps to itself now: issues and pull requests both stay on ${cleared.on}, and nothing upstream is watched.` }
      }

      // IT HAS TO BE IN THE CHAIN, and this is what makes the setting a choice
      // between real places rather than a text field. A name that is not above
      // this repository is either a typo or a different arrangement entirely,
      // and both want saying rather than accepting.
      const walked = await remotes.chainOf(repo)
      const found = walked.links.find(l => l.on === want)
      if (!found) {
        throw new Error(`${want} is not this repository or anything above it. The chain is ${walked.links.map(l => l.on).join(' <- ')}${walked.stopped ? ` (the walk stopped: ${walked.stopped})` : ''}.`)
      }
      if (!found.mayPush) {
        throw new Error(`This host cannot open a pull request on ${want} — the token has no push there. Pointing work at it would fail at the moment of sending, on a machine, twenty minutes in.`)
      }

      const now = remotes.setTarget(repo, want, { by: whoAsked({ _overTheWire, _driven }), why })
      log.on('github', repo).good(`sends work to ${want} — picked by ${now.by}`)
      return {
        ...now,
        repo,
        immediate: !!found.immediate,
        note: found.on === now.self
          ? `"${repo}" points at itself, which is the same as picking nothing except that it is now recorded as a decision.`
          : `"${repo}" sends work to ${want}. Issues are read from there, pull requests open into it, and nothing above it is watched.${found.immediate ? '' : ' It is not the immediate parent, so syncing the fork cannot use GitHub\'s one-call merge-upstream — see repoForkSync.'}`
      }
    }
  },

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
  // ---- an issue tracker, a page at a time ---------------------------------
  //
  // What is being ASKED of a repository, read live. Everything else in this app
  // begins with somebody writing a task; an issue is work that turned up.
  //
  // PAGED, WHICH IS THE WHOLE POINT OF IT BEING ITS OWN ACTION. `repoOverview`
  // shows what the last "Ask GitHub" gathered, which is the first hundred, and a
  // hundred of five thousand is not a short list — it is a wrong one, silently.
  // Anything deciding what to work on from it is deciding from the first page of
  // a list it does not know is longer.
  //
  // LIVE, NOT FROM THE NOTE, for the same reason: "what is open now" is the
  // question, and the note is as old as the last time somebody pressed a button.
  // It is asked for deliberately and never on a timer — see repos/remotes.js.
  //
  // A REPOSITORY IN THIS WORKSPACE, OR ONE NAMED OUTRIGHT. `repo` is one this
  // host holds, and its issues are read from the PARENT where it is a fork,
  // because that is where the conversation is. `on` names any repository as
  // owner/name — for reading a tracker this workspace does not hold, which is
  // ordinary when the work is upstream. Reading only: nothing here writes to
  // GitHub, and the actions that do are not on a supervisor's list.
  // Which repository, worked out once for both lists below. `on` names any
  // repository as owner/name; `repo` is one this workspace holds, and its issues
  // and pull requests are read from the PARENT where it is a fork, because that
  // is where the conversation is.
  //
  // Not exported as an action: it is one sentence used twice, and an action for
  // it would be a third name for something this app already answers.

  // ---- WHOSE CODE IS THIS, AND MAY IT BE READ HERE ------------------------
  //
  // A pull request that ARRIVES is not like anything else this app judges.
  // Everything else is its own: a branch cut here, or a PR cut this host made.
  // An incoming one is somebody else's code, and judging it means fetching that
  // code onto a machine holding a Claude credential, a token that can push, and
  // this app's ssh key. The machine is rolled back afterwards, which does
  // nothing about anything sent out while it ran.
  //
  // There is a subtler one worth naming, because it is easy to miss while
  // thinking about execution: the judge is a model reading attacker-controlled
  // TEXT. A diff and a description can say "ignore your instructions" as easily
  // as they can say anything else. Approval is a control against both, and the
  // contract a judging job carries is the other half.
  //
  // So: a person allows one, at one commit, and nothing else can.
  // BRING AN ARRIVED PULL REQUEST HERE, so a machine can be set up on it the
  // ordinary way. It becomes the branch `pull/<n>` in that repository.
  //
  // ALLOWED FIRST. Fetching is only bytes and is harmless on its own -- but the
  // only reason to fetch one is to read it on a machine, and doing that without
  // the allowance would put a stranger's code one command away from a checkout.
  // Refusing here keeps the gate in one place rather than at every door that
  // leads to the same room.
  prFetch: {
    about: "Bring an arrived pull request into this workspace as the branch pull/<n>, so it can be read",
    needs: 'workspace',
    takes: ['repo', 'number'],
    run: async ({ repo, number }) => {
      const row = remotes.read().find(x => x.repo === String(repo))
      if (!row) throw new Error(`There is no repository called "${repo}" in this workspace.`)
      const on = row.issuesOn || (row.remote && row.remote.owner ? `${row.remote.owner}/${row.remote.repo}` : null)
      if (!on) throw new Error(`"${repo}" has no GitHub remote this host can read from.`)

      const said = await actions.pulls.run({ repo, state: 'all' })
      const one = (said.pulls || []).find(p => Number(p.number) === Number(number))
      if (!one) throw new Error(`${on} has no pull request #${number}.`)

      const may = allowed.check(on, number, one.headSha)
      if (!may.allowed) {
        throw new Error(may.stale
          ? `${on}#${number} was allowed at ${may.said.sha.slice(0, 7)} and is now at ${String(one.headSha || '?').slice(0, 7)}. Look at it again and allow the commit it is on before bringing it here.`
          : `Nobody has allowed ${on}#${number} to be read here. Allow it at the commit it is on first — Repositories → Overview.`)
      }

      const got = remotes.fetchPull(repo, number)
      log.on('git', repo).good(`${on}#${number} is here as "${got.branch}" at ${String(got.head).slice(0, 7)}`)
      return {
        ...got,
        on,
        title: one.title,
        by: one.by,
        note: `${on}#${number} is in this workspace as the branch "${got.branch}". It is a copy to READ: nothing has been checked out, and pushing to it would go nowhere the contributor sees.`
      }
    }
  },

  // WHAT WAS FOUND, SAID WHERE THE AUTHOR WILL SEE IT.
  //
  // A judge reads an arrived pull request and reaches a verdict, and until
  // now that verdict could only ever be seen on this host. Half a review: the
  // person who proposed the change is the one waiting for it.
  //
  // THE RECOMMENDATION IS A FIXED LINE, not something composed by whoever
  // calls this. "Recommend pulling: YES" and "Recommend pulling: NO" are the
  // two things it can end with, in those words, every time -- so a person
  // scanning a tracker sees the same sentence in the same place, and anything
  // reading these later can find the answer without parsing prose.
  //
  // AND IT SAYS WHAT WROTE IT. A comment from an automated reader that does
  // not admit to being one is the sort of thing that gets a project distrusted
  // once somebody works it out.
  prComment: {
    about: "Say something on a pull request in this workspace: a summary, and whether it is recommended for pulling",
    needs: 'workspace',
    takes: ['repo', 'number', 'body', 'recommend'],
    run: async ({ repo, number, body, recommend }) => {
      const row = remotes.read().find(x => x.repo === String(repo))
      if (!row) throw new Error(`There is no repository called "${repo}" in this workspace. A comment is only made on a repository this host holds — reading is allowed anywhere and saying something is not.`)

      const said = String(body || '').trim()
      if (!said) throw new Error('Say something. A comment with no body is a notification with nothing in it, on somebody else\'s pull request.')

      const call = String(recommend || '').trim().toLowerCase()
      if (call !== 'yes' && call !== 'no') {
        throw new Error('Say whether it is recommended for pulling: "yes" or "no". A review that does not end in one of those is a report somebody else has to turn into a decision, which is the work it was meant to do.')
      }

      const text = [
        said,
        '',
        `**Recommend pulling: ${call.toUpperCase()}**`,
        '',
        '<sub>Read by the okc dashboard on the operator\'s machine. Nothing here was merged, edited or pushed by it.</sub>'
      ].join('\n')

      const done = await remotes.comment(row.repo, Number(number), text)
      if (!done.ok) throw new Error(`GitHub would not take the comment on ${row.repo}#${number}: ${done.why}`)
      log.on('github', row.repo).good(`said something on #${number} — recommend pulling: ${call.toUpperCase()}`)
      return { ...done, recommend: call, note: `Said on ${done.on}#${number}. The author can read it; nothing was merged or changed.` }
    }
  },

  prJudging: {
    about: 'Pull requests that have arrived, who wrote them, and whether a judge may read them',
    needs: 'workspace',
    run: async () => {
      const mine = remotes.read()
      const rows = []

      for (const r of mine) {
        const on = r.issuesOn || (r.remote && r.remote.owner ? `${r.remote.owner}/${r.remote.repo}` : null)
        if (!on) continue
        let said = null
        try { said = await actions.pulls.run({ repo: r.repo, state: 'open' }) } catch { continue }

        for (const p of said.pulls || []) {
          // OURS OR THEIRS, and the test is where the branch lives rather than
          // who typed it. A cut this host made pushes to a fork this host owns,
          // so its head repository is one of ours; anything else came from
          // somewhere this app does not control.
          const from = String(p.headRepo || '').trim()
          const ours = mine.some(x => x.remote && `${x.remote.owner}/${x.remote.repo}` === from)
          const may = allowed.check(on, p.number, p.headSha)

          rows.push({
            on,
            repo: r.repo,
            number: p.number,
            title: p.title,
            url: p.url,
            author: p.user || null,
            // GitHub's own word for how close the author is to the repository:
            // OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE. Reported rather
            // than interpreted -- "is this person trusted" is not this app's
            // judgement to make, and the answer it would give is somebody's
            // GitHub permissions rather than their intentions.
            association: p.association || null,
            headRepo: from || null,
            headSha: p.headSha || null,
            ours,
            allowed: ours ? true : may.allowed,
            stale: ours ? false : may.stale,
            why: ours ? null : may.why,
            said: may.said || null
          })
        }
      }

      const waiting = rows.filter(x => !x.ours && !x.allowed)
      return {
        pulls: rows,
        waiting: waiting.length,
        note: rows.length
          ? (waiting.length
              ? `${waiting.length} pull request(s) arrived from outside and cannot be judged until you allow it. Allowing names the commit: if the author pushes again it has to be allowed again.`
              : 'Every open pull request here is either this host\'s own or has been allowed at the commit it is on.')
          : 'No open pull requests.'
      }
    }
  },

  // ONE COMMIT, BY A PERSON, AT THE WINDOW.
  //
  // Refused down the pipe for the same reason approving a job is: this is the
  // one decision that cannot be delegated to the thing being protected against.
  // A supervisor asking for it would be a model deciding that a stranger's code
  // may be read by a model.
  prAllowJudging: {
    about: 'Allow a judge to read an incoming pull request, at the commit it is on now',
    needs: 'workspace',
    takes: ['repo', 'number', 'note'],
    run: async ({ repo, number, note = null, _overTheWire, _driven }) => {
      // A DRIVEN PRESS IS THE COMMAND LINE. This read `_overTheWire && !_driven`,
      // which let `windowClick` press the button -- the same hole every other
      // approval here had. Whichever button it lands on, it is not a person.
      if (_overTheWire || _driven) {
        throw new Error('Allowing a pull request to be judged is done in the window, by a person who has looked at it. A model may not decide that somebody else\'s code is fit to be read here.')
      }
      const row = remotes.read().find(x => x.repo === String(repo))
      if (!row) throw new Error(`There is no repository called "${repo}" in this workspace.`)
      const on = row.issuesOn || (row.remote && row.remote.owner ? `${row.remote.owner}/${row.remote.repo}` : null)
      if (!on) throw new Error(`"${repo}" has no GitHub remote this host can read from.`)

      // READ NOW, so what is recorded is the commit that is there at the moment
      // somebody says yes -- not one remembered from an earlier list.
      const said = await actions.pulls.run({ repo, state: 'all' })
      const one = (said.pulls || []).find(p => Number(p.number) === Number(number))
      if (!one) throw new Error(`${on} has no pull request #${number}.`)
      if (!one.headSha) throw new Error(`GitHub did not say which commit ${on}#${number} is at, so there is nothing to record an allowance against.`)

      const made = allowed.allow(on, number, one.headSha, { by: whoAsked({ _overTheWire, _driven }), note })
      log.on('github', row.repo).good(`#${number} on ${on} may be judged at ${one.headSha.slice(0, 7)} — allowed by ${made.by}`)

      // AND SAYING YES IS ITSELF THE THING THAT HAPPENED.
      //
      // The watcher wakes a supervisor when a pull request ARRIVES or when its
      // author pushes -- both facts about GitHub. Neither of them is this one.
      // A pull request that arrived an hour ago, was refused at the gate, and
      // has just been allowed is not fresh and has not moved, so on the day
      // this was written nothing woke: a person pressed the button that
      // unblocks the work and the work stayed exactly where it was, until the
      // author happened to push.
      //
      // Found by pressing it. The gate was right, the badge was right, the
      // allowance was written down correctly, and the whole thing still went
      // nowhere -- which is the failure that no amount of reading the gate
      // would have shown, because every part of the gate was working.
      //
      // NOT AWAITED, and it does not fail the allowance. The allowance is a
      // fact recorded on this host; whether something can be woken to act on it
      // is a separate question with its own failures -- a machine that will not
      // start, a sign-in that has expired -- and none of those should read as
      // "your yes did not go through".
      if (settings.read().supervisorWakes === true) {
        actions.supervisorWake.run({
          why: `allowed by a person — ${on}#${number} "${String(one.title || '').slice(0, 80)}" may now be judged at ${one.headSha.slice(0, 7)}. It arrived from outside this workspace.`
        }).catch(e => log.on('supervisor').warn(`it could not be woken about ${on}#${number}: ${e.message}`))
      }
      return {
        ...made,
        title: one.title,
        note: `A judge may read ${on}#${number} as it is at ${one.headSha.slice(0, 7)}. If the author pushes again this stops applying, and it has to be allowed again — the point is that you approved the code you read.`
      }
    }
  },

  prForbidJudging: {
    about: 'Take back an allowance to judge an incoming pull request',
    needs: 'workspace',
    takes: ['repo', 'number'],
    run: ({ repo, number, _overTheWire, _driven }) => {
      if (_overTheWire || _driven) {
        throw new Error('Taking an allowance back is done in the window, like giving one.')
      }
      const row = remotes.read().find(x => x.repo === String(repo))
      if (!row) throw new Error(`There is no repository called "${repo}" in this workspace.`)
      const on = row.issuesOn || (row.remote && row.remote.owner ? `${row.remote.owner}/${row.remote.repo}` : null)
      const had = allowed.forget(on, number)
      if (had) log.on('github', row.repo).warn(`#${number} on ${on} may no longer be judged`)
      return { forgotten: had, note: had ? `${on}#${number} may no longer be judged.` : `Nothing was allowing ${on}#${number}.` }
    }
  },

  issues: {
    about: "A repository's issues, a page at a time — from the workspace, or any repository named owner/name",
    takes: ['repo', 'on', 'state', 'page', 'after', 'perPage', 'labels', 'sort', 'since'],
    run: async ({ repo, on, state = 'open', page = 1, after = null, perPage = 30, labels = null, sort = null, since = null }) => {
      const where = whichRepo({ repo, on })
      const said = await remotes.issuePage(where, { state, page, after, perPage, labels, sort, since })
      return { ...said, repo: repo || null, note: howToGoOn(said, 'issue') }
    }
  },

  // THE SAME PROBLEM, THE OTHER LIST. A busy repository has hundreds of open
  // pull requests — anthropics/claude-code has over seven hundred — and
  // `repoOverview` shows what the last "Ask GitHub" gathered, which is the first
  // hundred of them.
  //
  // SEPARATE FROM THE PR CUTS, and deliberately. A cut is this app's own idea:
  // one change, one pull request per repository, tracked together. This is
  // everything open on a repository, whoever opened it and whether or not it has
  // anything to do with this host — which is what somebody deciding what to work
  // on needs to see.
  pulls: {
    about: "A repository's pull requests, a page at a time — from the workspace, or any repository named owner/name",
    takes: ['repo', 'on', 'state', 'page', 'after', 'perPage', 'sort'],
    run: async ({ repo, on, state = 'open', page = 1, after = null, perPage = 30, sort = null }) => {
      const where = whichRepo({ repo, on })
      const said = await remotes.pullPage(where, { state, page, after, perPage, sort })
      return { ...said, repo: repo || null, note: howToGoOn(said, 'pull request') }
    }
  },

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
            // WHOSE IT IS, AND WHETHER ANYBODY HAS SAID IT MAY BE READ.
            //
            // A pull request this host cut is its own work arriving back. One
            // from anywhere else is a stranger's code, and judging it means
            // fetching it onto a machine that holds a credential -- so it waits
            // on a person. `prJudging` answers the same question by ASKING
            // GITHUB; this answers it from the last gathering, because this list
            // is drawn every few seconds and the draw loop must not reach the
            // network.
            //
            // The consequence of reading it locally: an author who pushed since
            // the last "Ask GitHub" shows as allowed here and is refused at the
            // gate, which is the safe direction to be wrong in. The gate reads
            // the live commit; see actions/judge.js.
            const from = String(p.headRepo || '').trim()
            const ours = rows.some(x => x.remote && `${x.remote.owner}/${x.remote.repo}` === from)
            const may = allowed.check(r.parent || r.repo, p.number, p.headSha)

            items.push({
              kind: 'pull', id: `${r.repo}#${p.number}`, repo: r.repo, repos: [r.repo],
              title: p.title, number: p.number, url: p.url,
              state: p.merged ? 'merged' : p.state, draft: !!p.draft,
              at: p.updated || p.at || null, on: r.parent || r.repo, parts: null,
              by: p.by || null, association: p.association || null,
              headRepo: from || null, headSha: p.headSha || null,
              ours,
              mayBeJudged: ours ? true : may.allowed,
              staleAllowance: ours ? false : may.stale,
              whyNot: ours ? null : may.why,
              allowedBy: may.said || null,

              // AND WHAT HAS BEEN READ ABOUT IT, on the row where somebody
              // allowed it in the first place.
              //
              // The judgement lives on the Judge tab and so did everything a
              // person could do with it — so allowing a pull request here sent
              // them somewhere else to find out what came of it, and somewhere
              // else again to answer the author. A loop that starts on one
              // screen and finishes on another is a loop people lose track of.
              //
              // The LATEST one, because asking again is how a pull request is
              // re-read after a push, and the answer that matters is the one
              // about the commit it is on now.
              judged: (() => {
                const name = `${r.parent || r.repo}#${p.number}`
                const mine = judging.all().filter(j => j.subject && j.subject.kind === 'pull' &&
                  `${j.subject.on}#${j.subject.number}` === name)
                const last = mine[mine.length - 1]
                if (!last) return null
                return {
                  ref: last.ref,
                  id: last.id,
                  state: last.state,
                  sha: (last.subject && last.subject.sha) || null,
                  // WHETHER IT IS ABOUT THIS COMMIT. A judgement of what was
                  // there yesterday is not a reading of what is there now, and
                  // the row must not present it as one.
                  current: !!(last.subject && p.headSha && last.subject.sha === p.headSha),
                  concluded: last.concluded || null,
                  verdict: last.verdict || null,
                  said: last.saidOn || null
                }
              })()
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
          cuts: all.filter(x => x.kind === 'cut').length,
          // Arrived from outside, open, and nobody has said it may be read.
          toAllow: all.filter(x => x.kind === 'pull' && x.state === 'open' && !x.ours && !x.mayBeJudged).length
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
    run: async a => {
      const { source, target, title, body, into, draft } = a
      const pair = twoLines(source, target)
      const carrying = []
      for (const { repo, head, base } of pair.on) {
        const art = artifact.inRepo(repo, head, base)
        if (!art.missing && !art.noBase && art.ahead > 0) carrying.push({ repo, head, base, ahead: art.ahead })
      }
      if (!carrying.length) throw new Error(`"${pair.source.name}" carries nothing that "${pair.target.name}" does not already have.`)

      // ---- EVERYBODY GREEN BEFORE A CHANGE GOES OUT ------------------------
      //
      // Three of them work on a change: a supervisor decides it is worth doing,
      // a worker does it, and a judge reads what came back. Sending it out is
      // the moment all three have to agree — so over the wire this refuses
      // unless a judgement of THIS line has finished, still describes what is
      // there, and did not come back rejected.
      //
      // A SUPERVISOR CANNOT SEE THE CODE. Without this, the one step where a
      // change leaves this host and reaches somebody else's repository would be
      // the only step it takes on nothing but its own confidence.
      //
      // STILL DESCRIBES WHAT IS THERE is half the check and the easier half to
      // forget: a judgement made before the last push is a judgement of
      // something else, and a supervisor that judged, pushed a fix, and then
      // sent it out would be showing a green light from a different change.
      //
      // NOT AT THE WINDOW. A person sending a change out has read it, or has
      // decided they need not — the same boundary as approving a job.
      if (a._overTheWire) {
        // BY THE NAMES A JUDGE COULD ACTUALLY HAVE READ, which is not only the
        // line's own.
        //
        // A judgement is made against a BRANCH — `fix/csvstat-lockfile-ignore`
        // — and then `branchAsLine` gives that branch a line name, `csvstat
        // lockfile ignore`. This searched for a judgement of the LINE name, so
        // the flow the supervisor's skill prescribes — judge it, make it a
        // line, cut it — could not pass its own gate: the name being searched
        // for is one nothing has ever judged, by construction.
        //
        // It refused with "Nothing has judged it" about a change that had just
        // been accepted, which is the worst shape a refusal can have: correct
        // machinery, true-sounding sentence, wrong fact.
        //
        // So the accepted names are the line's, plus every branch the line is
        // made of. A judgement of any of them is a judgement of this change,
        // because that is what the line IS.
        const names = new Set([pair.source.name, ...pair.on.map(p => p.head)])
        const mine = judging.all().filter(j =>
          j.state === 'done' && j.subject && j.subject.kind === 'branch' && names.has(j.subject.branch))

        if (!mine.length) {
          throw new Error(`Nothing has judged "${pair.source.name}" or the branch it is made of, so there is no reading of this change but your own — and you cannot see the code. Ask for a judgement of it, read what it handed back, and send it out when a judge has looked.`)
        }

        // AND STALENESS IS MEASURED AGAINST WHAT THAT JUDGEMENT READ, one by
        // one. Asking for the tips of the line name would answer about a name
        // git does not have, and every judgement would read as current for ever
        // — which is the failure mode staleness exists to prevent.
        const current = mine.filter(j => !judgements.staleAgainst(j, judgements.tipsFor(j.subject)))
        if (!current.length) {
          throw new Error(`Every judgement of "${pair.source.name}" was made before the last push, so none of them describes what is there now. Judge it again — a judgement of an earlier state is exactly as useful as none.`)
        }

        const latest = current[current.length - 1]
        if (latest.concluded === 'reject' || latest.verdict === 'rejected') {
          throw new Error(`${latest.ref} read "${pair.source.name}" and came back "${latest.concluded || latest.verdict}". Fix what it found and have it judged again — a change goes out when the judge is satisfied, not when it has been asked twice.`)
        }
      }

      // The title, decided after the draft is read below so a saved one can be
      // used -- see draftTitle. A pull request named after the LINE is what a
      // dropped draft looks like from GitHub.
      let said = String(title || '').trim() || pair.source.name
      // WHAT SOMEBODY TYPED, PLUS WHAT THIS APP ALREADY KNOWS. The blocks that
      // are on are written from facts nobody should have to look up -- why the
      // branch was cut, what the task asked for, which commit each repository
      // ends at. See repos/prtemplate.js.
      const context = prtemplate.about(pair.source.name, pair.target.name)

      // WHAT SOMEBODY WROTE, FROM THE ARGUMENT OR FROM THE DRAFT THEY SAVED.
      //
      // THE DRAFT WAS WRITTEN AND THROWN AWAY. `prDraftSave` keeps what a pull
      // request will say, the window's form pre-fills from it, and this read
      // only the `body` argument — so anything saved and not passed again was
      // silently dropped. The supervisor's skill says, in order: prDraftSave,
      // then prCutMake. It did exactly that, and the pull request went out with
      // none of its words in it, including the issue URL it had been asked to
      // carry. Nothing failed and nothing said anything.
      //
      // The argument still wins when there is one: passing a body means "say
      // this", and a draft is what was meant when nothing else is said.
      let typed = String(body || '').trim()
      let fromDraft = false
      if (!typed) {
        const kept = drafts.read(pair.source.name, pair.target.name)
        if (kept && String(kept.body || '').trim()) {
          typed = String(kept.body).trim()
          fromDraft = true
        }
      }

      // AND THE TITLE THE SAME WAY, for the same reason: a draft that carries a
      // title and is cut without one produced a pull request named after the
      // line, which is what happened here -- "csvstat lockfile ignore" rather
      // than "Ignore package-lock.json in csvstat".
      const draftTitle = (() => {
        if (String(title || '').trim()) return null
        const kept = drafts.read(pair.source.name, pair.target.name)
        return kept && String(kept.title || '').trim() ? String(kept.title).trim() : null
      })()

      if (draftTitle) said = draftTitle

      // SAID OUT LOUD, because the failure this replaces was silent. A cut that
      // takes its words from a draft nobody passed should leave a line saying
      // so, or the next person to wonder where the text came from has the same
      // afternoon.
      if (fromDraft || draftTitle) {
        log.on('git').info(`the pull request text came from the draft kept for "${pair.source.name}" into "${pair.target.name}"`)
      }

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

      const record = landings.record(pair.source.name, pair.target.name, done, s.whoAsked(a))
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

  // LANDING IT, which is the step this app used to hand back to a browser.
  //
  // A cut is one act with a pull request per repository, and merging them one at
  // a time in three tabs is how two get merged and the third sits open until
  // somebody finds it a month later. The same argument as opening them together
  // and as `prCutUpdate` changing all their descriptions at once.
  //
  // ASKED FOR BY NAME, not by "the latest". A merge is not undoable from here,
  // and an action that guesses which change it is landing is one misread line
  // away from landing a different one.
  //
  // IN THE WINDOW, ALWAYS. FROM OUTSIDE IT, ONLY WHILE TESTING IS ON.
  //
  // Merging is the one act here that reaches somebody else's repository and
  // cannot be taken back from this app: it is a commit on a real default branch,
  // and a fork sync away from being everywhere. A person pressing the button in
  // the window is that person landing their own change, which needs no gate at
  // all. The command line is a model, and a model landing pull requests whenever
  // it likes is the thing the approvals exist to prevent.
  //
  // TESTING MODE IS THE GATE, chosen because it already means exactly this: it
  // is off until somebody names a folder they do not mind a drill driving, it is
  // switched on at the window and nowhere else, it switches itself off when the
  // workspace changes, and while it is on the window carries a banner no other
  // banner may take over. One switch, visible, revocable in a click — rather
  // than a permission file that grants it silently and for ever.
  //
  // The drills need it because the last stage of the order IS landing: a change
  // that is opened and never merged proves the half of the flow that is easy.
  prCutLand: {
    about: 'Merge every pull request in a cut, so the change lands as one thing',
    needs: 'workspace',
    takes: ['source', 'target', 'how'],
    run: async ({ source, target, how, _overTheWire, _driven }) => {
      if (_overTheWire || _driven) {
        const may = settings.testsAllowed(workspaces.dir() || null)
        if (!may.allowed) {
          throw new Error(`Landing a cut from outside the window is only done while testing mode is on for this workspace. ${may.why} A person pressing the button in the window is that person landing their own change; this is a model merging into somebody's repository, and that needs to have been said out loud first.`)
        }
      }
      const at = await landings.state(source, target)
      if (!at) throw new Error(`Nothing has been cut from "${source}" into "${target}" from here.`)

      const open = at.pulls.filter(p => p.number && !p.merged && p.state !== 'closed')
      const already = at.pulls.filter(p => p.merged)
      if (!open.length) {
        return {
          source: at.source,
          target: at.target,
          merged: [],
          note: already.length
            ? `Already landed: all ${already.length} pull request(s) are merged.`
            : 'There is nothing open to merge in this cut.'
        }
      }

      const done = []
      for (const p of open) {
        const r = await remotes.mergePull(p.repo, p.number, { how: String(how || 'merge') })
        if (r.merged) log.on('git', p.repo).good(`merged #${p.number} into ${r.into}`)
        // A pull request that will not merge stops itself and not the others.
        // Three repositories where one has a conflict is a real state, and the
        // two that can land are better landed than held back by it.
        else log.on('git', p.repo).bad(`#${p.number} did not merge: ${r.why}`)
        done.push(r)
      }

      const won = done.filter(d => d.merged)
      return {
        source: at.source,
        target: at.target,
        merged: done,
        // Said rather than done. The fork is now behind the parent it just took a
        // change from, and pulling it up is the next act — see repoForkSync.
        note: won.length === done.length
          ? `${won.length} pull request(s) merged. The forks are now behind their parents — sync them next.`
          : `${won.length} of ${done.length} merged. ${done.filter(d => !d.merged).map(d => `${d.repo} #${d.number}: ${d.why}`).join('; ')}`
      }
    }
  },

  // THE BRANCH ON THE FORK, once it has done its work.
  //
  // `branchDelete` removes a branch from every repository HERE, which is half of
  // what somebody means after a change has landed: the other half is on the
  // fork, and GitHub offers it as a button on the merged pull request.
  //
  // Same gate as landing, for the same reason: from the window this is a person
  // tidying their own fork, and from the command line it is a model deleting a
  // branch on a live account. It is also the step that keeps the drills from
  // filling a fork with branches nobody can tell from real ones.
  branchDeleteRemote: {
    about: "Delete a branch from the fork on GitHub, the way the button on a merged pull request does",
    needs: 'workspace',
    takes: ['branch', 'repo'],
    run: async ({ branch, repo, _overTheWire, _driven }) => {
      const on = String(branch || '').trim()
      if (!on) throw new Error('Say which branch.')
      if (_overTheWire || _driven) {
        const may = settings.testsAllowed(workspaces.dir() || null)
        if (!may.allowed) {
          throw new Error(`Deleting a branch on the fork from outside the window is only done while testing mode is on for this workspace. ${may.why}`)
        }
      }

      const here = repos.list().map(r => r.name)
      const want = repo ? [String(repo)] : here
      for (const name of want) {
        if (!here.includes(name)) throw new Error(`There is no repository called "${name}" here. There is: ${here.join(', ')}.`)
      }

      const done = []
      for (const name of want) {
        try {
          const r = await remotes.deleteBranch(name, on)
          if (r.gone) log.on('git', name).good(`deleted ${on} on ${r.on}`)
          done.push(r)
        } catch (e) {
          log.on('git', name).warn(e.message)
          done.push({ repo: name, branch: on, gone: false, why: e.message })
        }
      }
      const gone = done.filter(d => d.gone)
      return {
        branch: on,
        repos: done,
        note: gone.length
          ? `"${on}" deleted on ${gone.map(d => d.repo).join(', ')}. It is untouched here — branchDelete removes it from this host.`
          : `Nothing to delete: no fork had "${on}".`
      }
    }
  },

  // SYNC FORK, the button on the fork's front page, for every repository at once.
  //
  // "A PR does something weird that I do not understand — it turns the PR into a
  // commit or something, and I sync my fork, but then my branch and master are
  // off." That is this step missing: the parent moved when the change landed,
  // the fork did not, and everything cut from the fork afterwards starts from
  // something out of date.
  //
  // THE FORK ON GITHUB, AND THEN THIS HOST. They are two different places and
  // this app has been able to do only the second one — `repoSync` fetches origin
  // and fast-forwards here, which cannot help while origin itself is behind.
  repoForkSync: {
    about: "Pull each fork's default branch up from its parent on GitHub, the way the Sync fork button does",
    needs: 'workspace',
    takes: ['repo', 'branch'],
    run: async ({ repo, branch }) => {
      const here = repos.list().map(r => r.name)
      const want = repo ? [String(repo)] : here
      for (const name of want) {
        if (!here.includes(name)) throw new Error(`There is no repository called "${name}" here. There is: ${here.join(', ')}.`)
      }

      const done = []
      for (const name of want) {
        try {
          const r = await remotes.syncFork(name, branch || null)
          log.on('git', name)[r.already ? 'info' : 'good'](r.already ? 'already up to date with its parent' : `pulled ${r.branch} up from ${r.from} (${r.how})`)
          done.push(r)
        } catch (e) {
          // A repository that is not a fork, or a conflict GitHub will not
          // resolve, is reported and does not stop the others.
          log.on('git', name).warn(e.message)
          done.push({ repo: name, moved: false, why: e.message })
        }
      }

      const moved = done.filter(d => d.how && d.how !== 'none')
      return {
        repos: done,
        note: moved.length
          ? `${moved.length} fork(s) pulled up from their parents. Run repoSync to bring this host up to them.`
          : 'Every fork was already up to date with its parent.'
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
          // NO `landed` HERE, AND THAT IS DELIBERATE. Whether a cut has merged
          // is a fact about GitHub, and `landings.all()` returns what was true
          // when the cut was MADE — every pull in it says "open" for ever. Only
          // `landings.state()` knows, and that asks GitHub, which this must
          // never do: it is read on every draw.
          //
          // `repos` below answers the useful half locally: it lists the
          // repositories where this line still carries something the target
          // does not have. Empty means there is nothing left to read — merged,
          // or reverted, or the branch is gone — and that is the same answer
          // for judging purposes, arrived at without asking anybody.
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

      // THE SAME TWO NAMES THE CUT WILL WANT, checked here rather than found out
      // later. `prCutMake` takes LINE names and refuses anything else; this took
      // whatever it was given, so a draft could be filed against a pair no cut
      // can ever ask for -- written, kept, and unreadable by the one thing that
      // reads drafts.
      //
      // It happened: a supervisor saved a body against "version2", which is a
      // BRANCH inside the "default" line rather than a line. Cutting into
      // "default" would not have found it and the pull request would have gone
      // out as template text -- which is the silent version of this that already
      // cost one pull request its issue link.
      //
      // Refused with the list, because the fix is picking the right name and the
      // names are knowable.
      twoLines(source, target)

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
