'use strict'

// JUDGING, AS ITS OWN LIST OF ACTIONS.
//
// Not `task*` reused with a flag. A judgement is a different question from a
// task — did the work follow the rules, is it secure, are there bugs nobody
// caught — and it is about a different thing: the CHANGE, never the occasion
// that produced it. Sharing the task actions would mean every one of them
// growing a branch on which half of it does not apply, and the half that does
// not apply is the half nobody notices is wrong.
//
// WHAT THEY SHARE IS THE QUEUE, and only that. Both wait for the same machines
// and are refused one for the same reasons, so there is one line and judgements
// go first — see the head of actions/queue.js.
//
// `taskJudge` IS WHAT THIS REPLACES. It records a verdict on the task that
// produced the work, which is the wrong subject: a change can come from more
// than one task, and a task can deliver nothing worth reading. It stays until
// this can do everything it did, because the alternative is a period with no way
// to record a verdict at all.

const actions = require('./table')
const s = require('./shared')
// No `tasks` here, and that is the point of the file: a judgement is about a
// change, and the task that produced it is a fact about where the change came
// from rather than the thing being read.
const { archive, log, judging, jobs, prompts, contracts, judgements, prtemplate, branches, repos, files, allowed , remotes } = s

// WHAT EACH REPOSITORY WAS AT WHEN IT WAS READ, for either kind of subject.
//
// This is not bookkeeping. A judgement made before another push is a judgement
// of something ELSE, and the only thing that can ever say so is the commit each
// repository was at when it was made. Without it a verdict reads as current for
// ever — see repos/judgements.js, which refuses one that has none.
//
// Two ways of asking, because the two subjects are different questions. A PR cut
// knows its own repositories: `prtemplate.about` walks the pairs a cut is made
// of and returns a tip each. A branch cut is simply wherever that branch exists,
// which is what `headsIn` answers per repository.
function tipsFor (subject) {
  const out = {}
  if (subject.kind === 'cut') {
    let context = null
    try { context = prtemplate.about(subject.source, subject.target) } catch { context = null }
    for (const r of (context ? context.repos : [])) out[r.repo] = r.tip
    return out
  }
  for (const r of repos.list()) {
    try {
      const heads = branches.headsIn(repos.gitDirOf(r.name)) || {}
      if (heads[subject.branch]) out[r.name] = heads[subject.branch]
    } catch { /* a repository that cannot be read is one this cannot claim to have read */ }
  }
  return out
}

// WHOSE FINDINGS THESE ARE, on every answer that carries any. A page of findings
// with no judgement attached is opinions about nothing in particular — and the
// caller most likely to be reading them is a supervisor, which knows about the
// code only through this.
//
// Named `whose` rather than `said` because `said` is already a local inside
// judgementCreate, and a helper that quietly means something else two functions
// down is the kind of thing that is only ever found the hard way.
const whose = it => ({
  ref: it.ref,
  reads: it.subject && it.subject.name,
  state: it.state,
  verdict: it.verdict || null,
  note: it.note || null,
  contractName: it.contractName || null
})

// A judgement reads; it does not write. So every one of these refuses to take a
// branch to work ON, and the one thing a caller names is what is to be read.
module.exports = {
  // A LIST, AND THEN ONE OF THEM. Two answers from one action, because they
  // are the same question asked at two depths.
  //
  // WHY IT HAD TO SPLIT: every judgement carries the words it was given and
  // the rules it was held to, in full, on purpose — a reference proves nothing
  // about what a worker was actually held to six weeks later, so the text is
  // copied. That is right for one judgement and wrong for eleven: this action
  // returned seventy-five thousand characters, which the window did not need
  // and which a supervisor cannot read at all. It spills to a file, and the
  // file is on a host the supervisor has no filesystem access to.
  //
  // So the list carries what a list is for — what it reads, whose it is, what
  // state it is in, what it decided. `ref` asks for one in full. Nothing was
  // taken away; it moved one press further in, which is where the difference
  // between a list and a record belongs.
  judging: {
    about: 'Every judgement: what is waiting to be read, what is being read, and what was decided. One ref reads that one in full',
    needs: 'workspace',
    takes: ['ref'],
    run: ({ ref = null }) => {
      const all = judging.all()

      if (ref) {
        const want = String(ref).trim().toUpperCase()
        const one = all.find(j => String(j.ref).toUpperCase() === want || String(j.number) === String(ref))
        if (!one) {
          throw new Error(`There is no judgement called "${ref}". The list has ${all.length}: ${all.map(j => j.ref).join(', ') || 'none'}.`)
        }
        return { judgement: one, note: `${one.ref} in full, including the words it was given and the rules it was held to. judgementFindings is what it handed back.` }
      }

      // WHAT A LIST IS FOR. `brief` and `rules` are the two long ones and are
      // the two nothing reading a list wants; `attempts` is where it ran and
      // belongs with the rest of the record.
      //
      // AND THE TWO THAT GREW BACK. Taking those three out fixed this once, at
      // seventy-five thousand characters. It is seventy-seven thousand again --
      // `question` now carries the whole claim a check-a-claim was asked about,
      // and `note` carries a finished judgement's findings in full. The drill
      // that watches this said so before anybody noticed: "the list of
      // judgements is a file rather than a list".
      //
      // TRUNCATED RATHER THAN DROPPED. A list of judgements with no hint of what
      // any of them SAID is one nobody can triage from -- which is the same
      // mistake in the other direction, and the reason the first fix left `note`
      // alone. An ellipsis is the signal that there is more, and `ref` is how to
      // get it.
      const trim = (s, n) => {
        const t = String(s || '').replace(/\s+/g, ' ').trim()
        if (!t) return null
        return t.length > n ? `${t.slice(0, n)}…` : t
      }
      const short = all.map(({ brief, rules, attempts, question, note, ...rest }) => ({
        ...rest,
        question: trim(question, 160),
        note: trim(note, 240)
      }))

      return {
        judgements: short,
        // Counted by state, because "eleven judgements" says nothing about
        // whether this host is behind. What somebody wants is how many are
        // still to happen.
        waiting: all.filter(j => j.state === 'queued').length,
        running: all.filter(j => j.state === 'given').length,
        decided: all.filter(j => j.state === 'done').length,
        note: all.length
          ? 'The words each one was given and the rules it was held to are left out here, and what it asked and what it found are cut short — an ellipsis means there is more. Ask for one by ref to read any of it in full.'
          : 'Nothing has been asked for yet. A judgement reads a branch cut or a PR cut — judgementCreate says which.'
      }
    }
  },

  // WHAT A JUDGEMENT OF AN ARRIVED PULL REQUEST IS FOR, in the end.
  //
  // A judgement changes nothing and may not push — so a reading of somebody
  // else's pull request that stays on this host has told nobody anything. The
  // author cannot see it, and the whole point of judging an arrival is to
  // answer the person who sent it.
  //
  // TWO CALLS, NOT ONE. `preview` composes exactly what would be posted and
  // posts nothing; without it, it posts. A comment on somebody else's
  // repository cannot be taken back in any way that matters — an edit leaves
  // the original in the history and the notification has already gone — so
  // what goes up is read first, in full, by the person whose account it will
  // appear under.
  //
  // AND IT IS A PERSON, refused over the wire and refused to a driven click
  // for the same reason allowing the judgement was. This is this host speaking
  // in public, under somebody's name, about a stranger's work.
  //
  // THE WHOLE REVIEW, not a summary of it. Summarising twelve thousand
  // considered characters into three sentences means a model deciding which of
  // a judge's reservations the author gets to see — and the section a summary
  // would drop first is "what I could not check", which is the section that
  // makes the rest honest.
  judgementSay: {
    about: 'Put a judgement of an arrived pull request on GitHub as a comment: preview it, or say it',
    needs: 'workspace',
    takes: ['id', 'preview'],
    run: async ({ id, preview = false, _overTheWire, _driven }) => {
      const one = judging.get(id)
      if (!one) throw new Error(`There is no judgement "${id}".`)
      const ref = one.ref || judging.refOf(one.number)
      const subject = one.subject || {}
      if (subject.kind !== 'pull') {
        throw new Error(`${ref} reads ${subject.name || 'something that is not a pull request'}. Only a judgement of an arrived pull request has somewhere to be said — a cut of this host's own work is answered by landing it or not.`)
      }
      if (one.state !== 'done') throw new Error(`${ref} has not finished reading yet.`)

      const handed = files.list(one.uid) || []
      if (!handed.length) throw new Error(`${ref} handed nothing back, so there is nothing to say. A judgement that read nothing is not a review.`)

      // THE FILE THE PERSON WOULD READ, which is the same file this posts.
      // Two accounts of one judgement is one too many — see the note on
      // `concluded` in tasks/queue.js.
      let body = ''
      let from = null
      for (const f of handed) {
        let text = ''
        try { text = String((files.read(one.uid, f.file) || {}).text || '') } catch { continue }
        if (!text.trim()) continue
        if (text.length > body.length) { body = text; from = f.file }
      }
      if (!body.trim()) throw new Error(`${ref} handed back ${handed.length} file(s) and none of them has anything in it.`)

      // WHAT IT RECOMMENDED, IN THE WORDS THE PROMPT ASKED FOR. Read from the
      // file rather than from the record, so this cannot say one thing while
      // the review below it says another.
      const said = body.match(/^\s*RECOMMEND(?:ATION)?:\s*(yes|no|accept|reject)\s*$/mi)
      const yes = said ? /^(yes|accept)$/i.test(said[1]) : null
      const call = yes === null ? 'UNSTATED' : (yes ? 'YES' : 'NO')

      const head = [
        `**Recommend Pulling: ${call}**`,
        '',
        `Read at ${String(subject.sha || '').slice(0, 7)} by an automated judge on the maintainer's host. It fetched this change and read it; it ran nothing from it, and changed nothing anywhere.`,
        yes === null
          ? 'It did not end with a recommendation in the form it was asked for, so the answer above is not its answer — read the review.'
          : null,
        '',
        '---',
        ''
      ].filter(x => x !== null).join('\n')

      const full = head + body.trim() + '\n'

      if (preview || preview === 'true') {
        return {
          ref,
          on: subject.on,
          number: subject.number,
          recommend: call,
          from,
          body: full,
          characters: full.length,
          posted: false,
          note: `This is exactly what would appear on ${subject.on}#${subject.number}. Nothing has been posted.`
        }
      }

      if (_overTheWire || _driven) {
        throw new Error('Saying something on somebody else\'s pull request is done in the window, by a person who has read what is about to be posted. It appears under an account with a name on it and a comment cannot be unsent.')
      }

      const row = remotes.read().find(x =>
        x.repo === subject.on || x.issuesOn === subject.on ||
        (x.remote && `${x.remote.owner}/${x.remote.repo}` === subject.on))
      if (!row) throw new Error(`${subject.on} is not a repository in this workspace.`)

      const done = await remotes.comment(row.repo, Number(subject.number), full)
      if (!done.ok) throw new Error(`GitHub would not take the comment on ${subject.on}#${subject.number}: ${done.why}`)

      judging.update(one.id, { saidOn: { at: new Date().toISOString(), url: done.url || null, recommend: call } })
      log.on('github', row.repo).good(`${ref} said on #${subject.number} — recommend pulling: ${call}`)
      return {
        ...done,
        ref,
        recommend: call,
        posted: true,
        note: `${ref} is on ${subject.on}#${subject.number}. The author can read it; nothing was merged, changed or pushed.`
      }
    }
  },

  judgementCreate: {
    about: 'Ask for a judgement of a branch cut or a PR cut: what is read, which job reads it, and what question it is being asked',
    needs: 'workspace',
    takes: ['kind', 'branch', 'source', 'target', 'on', 'number', 'sha', 'job', 'by', 'tag', 'question', 'remembers'],
    run: async ({ kind, branch, source, target, on, number, sha, job, by, tag, question, remembers, _overTheWire }) => {
      // WHAT IS BEING READ, resolved before anything is written, so a judgement
      // is never filed against a cut that does not exist. `subjectFrom` is where
      // the two shapes are understood, and it refuses anything else.
      // A REPOSITORY MAY BE NAMED EITHER WAY, AND ONE OF THEM WAS WRONG.
      //
      // An allowance is filed under the repository as GitHub knows it --
      // owner/name, the parent, because that is where a pull request lives. A
      // supervisor naturally says the name it sees everywhere else in this
      // app, which is the WORKSPACE name: "local-repo-a". Those are different
      // strings, so the allowance was looked up under a key nothing had ever
      // written, and the refusal said "nobody has allowed this" about a pull
      // request somebody had just allowed.
      //
      // Found the first time a supervisor tried it unprompted, which is the
      // only way a mismatch between two names for one thing ever shows up.
      //
      // Resolved rather than refused: both are the right name from where each
      // caller is standing.
      let onWhat = on
      if (String(kind || '').trim().toLowerCase() === 'pull' && onWhat && !String(onWhat).includes('/')) {
        const row = remotes.read().find(x => x.repo === String(onWhat))
        const full = row && (row.issuesOn || (row.remote && row.remote.owner ? row.remote.owner + '/' + row.remote.repo : null))
        if (!full) {
          throw new Error(`"${onWhat}" is not a repository in this workspace, and it is not an owner/name either. A pull request is named by the repository it is on — either the workspace name or owner/name.`)
        }
        onWhat = full
      }

      const subject = judging.subjectFrom({ kind, branch, source, target, on: onWhat, number, sha })

      // AND IT HAS TO BE THERE. A judgement of something this host cannot find is
      // a machine booted to read nothing, twenty minutes from now, and a verdict
      // filed under a name that is nearly right.
      if (subject.kind === 'pull') {
        // SOMEBODY ELSE'S CODE, SO A PERSON HAS TO HAVE SAID SO — and said so
        // about THIS commit.
        //
        // This is the whole point of the kind existing separately. Judging an
        // arrived pull request means fetching a stranger's change onto a machine
        // holding a credential, and the judge is a model reading text that the
        // author wrote. `repos/allowed.js` records one allowance per commit; if
        // the author has pushed since, the allowance is stale and this refuses
        // rather than reading something nobody approved.
        const may = allowed.check(subject.on, subject.number, subject.sha)
        if (!may.allowed) {
          throw new Error(may.stale
            ? `${subject.on}#${subject.number} was allowed at ${may.said.sha.slice(0, 7)} and is now at ${subject.sha.slice(0, 7)} — the author has pushed since, so what was approved is not what a judge would read. Look at it again and allow it at the commit it is on now.`
            : `Nobody has allowed ${subject.on}#${subject.number} to be judged. Somebody else's code is only read here once a person has looked at it and said so, at the commit it is on — Repositories → Overview.`)
        }

        // AND IT HAS TO STILL BE THERE, AT THAT COMMIT. The allowance is this
        // host's record; GitHub is the fact. They disagree when an author
        // pushes between the allowance being given and the judgement being
        // asked for, which is a race of seconds and is exactly the case the
        // whole mechanism exists for.
        let live = null
        try {
          const said = await actions.pulls.run({ on: subject.on, state: 'all' })
          live = (said.pulls || []).find(p => Number(p.number) === Number(subject.number)) || null
        } catch (e) {
          throw new Error(`This host could not ask GitHub about ${subject.on}#${subject.number}, so it cannot tell whether the commit that was allowed is still the one there: ${e.message}`)
        }
        if (!live) throw new Error(`${subject.on} has no pull request #${subject.number}.`)
        if (String(live.headSha || '') !== subject.sha) {
          // SHOWN LONG ENOUGH TO DIFFER. Truncating both to seven characters
          // produced "is at 6ee55a3 and names 6ee55a3" about two commits that
          // are genuinely different — a refusal that reads as a bug in itself.
          // Two commits sharing a short prefix is rare and is exactly when this
          // sentence has to be readable.
          const there = String(live.headSha || '?')
          const short = there.slice(0, 7) !== subject.sha.slice(0, 7)
          throw new Error(`${subject.on}#${subject.number} is at ${short ? there.slice(0, 7) : there} on GitHub and this judgement names ${short ? subject.sha.slice(0, 7) : subject.sha}. The author pushed while this was being arranged — allow the new commit if it is still worth reading.`)
        }
      } else if (subject.kind === 'cut') {
        const { cuts } = await actions.prCuts.run({})
        const found = (cuts || []).find(c => c.source === subject.source && c.target === subject.target)
        if (!found) {
          throw new Error(`There is no PR cut "${subject.name}". Ask prCuts for what has been sent out — a judgement is filed against the cut it read, and one filed under a name nothing matches is a verdict nobody will find.`)
        }
      } else {
        // `branchBoard`, which is the action that answers "what branches are
        // there" — read from git across every repository rather than from a
        // list this app keeps. Asked by name, because a judgement of a branch
        // that is not here is a machine booted to read nothing.
        const { branches } = await actions.branchBoard.run({})
        const found = (branches || []).some(b => b.name === subject.branch)
        if (!found) {
          throw new Error(`There is no branch cut "${subject.branch}" in this workspace. Ask branchBoard for what has been cut — a judgement reads what is there, and one written against a name nothing matches would send a machine to read nothing.`)
        }
      }

      // ---- A MACHINE DOES NOT MARK A PERSON'S HOMEWORK ------------------
      //
      // A judgement's subject is a change, never another judgement, so nothing
      // can literally judge a verdict. What a supervisor CAN do is ask for a
      // second reading of the same change after a person has read it — which is
      // second-guessing by another route, and the operator's words for it were
      // "it could run another judgement process to check my judgement".
      //
      // REFUSED OVER THE WIRE ONLY, and only while the person's reading still
      // describes what is there. If the code has moved since, judging again is
      // not second-guessing — it is judging something else, which is exactly
      // what a judgement going stale means.
      //
      // A PERSON MAY ALWAYS ASK FOR ANOTHER, including one that disagrees with
      // their own: the record is a sequence of opinions and two that disagree is
      // the most useful thing in it. This is about who may commission the
      // second one, not about whether it may exist.
      if (_overTheWire) {
        const mine = judging.all()
          .filter(j => j.state === 'done' && j.by === 'person' && j.verdict && j.subject && j.subject.name === subject.name)
        const current = mine.filter(j => !judgements.staleAgainst(j, tipsFor(subject)))
        const last = current[current.length - 1]
        if (last) {
          throw new Error(`${last.ref} is a person's own reading of ${subject.name}, they recorded "${last.verdict}", and nothing has changed there since. Asking for another judgement of it would be checking their work — which is not yours to commission. If the change moves, judge it then; if you think they are wrong, say so and let them decide.`)
        }
      }

      // THE CHAIN IT WILL BE READ UNDER, and it is approved or it does not run.
      // A judging job is a job — same library, same approval, same rule that a
      // model may write one and may not ratify its own. Nothing new appears
      // here, which is most of the argument for this shape.
      let chain = {}
      if (job) {
        const which = jobs.get(job)
        if (!which) throw new Error(`There is no job "${job}". Ask jobs for the list — a judgement runs a job like any other work.`)

        // A JUDGE IS NOT A WORKER, and the libraries are kept apart so that is
        // not a matter of somebody picking carefully. "Did this follow the
        // rules, is it secure, what bug was missed" and "make this change" are
        // different questions written under different rules, and a job written
        // for one run as the other is a machine doing something nobody read for.
        if (which.kind !== 'judge') {
          throw new Error(`"${which.id}" is a job for doing work, not for judging it. A judge is written under the Judge tab and kept apart on purpose — a working job run as a judge would read a change under rules written for changing it.`)
        }
        const answer = await actions.jobs.run({})
        const said = (answer.jobs || []).find(j => j.id === which.id) || {}
        if (!said.runnable) {
          throw new Error(`The job "${which.id}" cannot run: ${said.whyNot || 'something in its chain is not approved'}. A judgement is held to the same approvals as any other work — more so, since its whole purpose is to say whether rules were followed.`)
        }
        // COPIES, NEVER NAMES. The spine's rule, and it matters most here: a
        // judgement read six weeks later has to be able to say what it was
        // holding the work to, and a library entry rewritten since would
        // silently change the answer.
        //
        // FROM THE LIBRARY, because that is where the words live. The `jobs`
        // action reports which prompt a job runs and whether it is approved —
        // not its text, quite rightly — so the first version of this copied a
        // field that does not exist and produced a judgement with no brief,
        // which fails at the machine rather than here.
        // A JUDGE WITH NO PROMPT SAYS NOTHING TO A WORKER, and this is where that
        // has to be refused.
        //
        // It cost a real run: all three judging jobs were quietly unbound from
        // their prompts by a save that never mentioned prompts (fixed in
        // tasks/jobs.js), and nothing said so. The judgement was written, queued,
        // and dispatched; a machine rolled back, booted, took a credential and
        // cloned three repositories before the job refused with "no brief, so
        // there is nothing to give the job" — forty seconds of machine for a
        // fault that was visible the moment the judgement was asked for.
        //
        // Every panel had said "can judge" throughout, because a job with no
        // prompt is not broken — it is a job with no prompt. It is only a judge
        // that is broken, and this is the door where the difference is known.
        if (!which.promptId) {
          throw new Error(`The judge "${which.id}" has no prompt, so there would be nothing to tell the worker to look for. Give it one under Judge → Judges before asking it to read anything.`)
        }

        const words = which.promptId ? (prompts.all() || []).find(p => p.id === which.promptId) : null
        if (which.promptId && !words) {
          throw new Error(`The job "${which.id}" runs the prompt "${which.promptId}", and there is no such prompt. A judgement copies the words it will be read under when it is written, so this is refused now rather than on a machine.`)
        }
        const under = words && words.contractId ? (contracts.all() || []).find(c => c.id === words.contractId) : null
        if (words && words.contractId && !under) {
          throw new Error(`The prompt "${words.id}" runs under the contract "${words.contractId}", and there is no such contract. It will not be copied without the rules it was approved with.`)
        }

        chain = {
          job: which.id,
          brief: words ? words.text : null,
          promptId: words ? words.id : null,
          promptName: words ? words.name : null,
          rules: under ? under.text : null,
          contractId: under ? under.id : null,
          contractName: under ? under.name : null
        }
      }

      // THE PARTICULAR THING BEING ASKED, on top of the approved words.
      //
      // One approved prompt cannot name the issue it is checking — the issue did
      // not exist when the prompt was read. "Is this claim true of the code" is
      // the approved question; WHICH claim is the parameter, and without it a
      // judge can only ever be pointed at a change in general.
      //
      // ADDED, NEVER SUBSTITUTED. The approved text stands exactly as it was
      // approved and this is appended under a heading that says what it is, so
      // reading the brief six weeks later shows both halves and which is which.
      //
      // This is the same latitude a task already has — a task's whole brief is
      // written by whoever wrote the task, under an approved contract — so it
      // grants nothing new. The contract still governs, and the contract is the
      // half that says what a judge may not do.
      const asked = String(question || '').trim()
      if (asked && !chain.brief) {
        // NAMING WHAT TO PASS, because "give this a job as well" was not enough.
        //
        // A supervisor met this four times in a row bootstrapping a survey. Each
        // refusal was correct and each was useless: it said what was missing and
        // not what would fix it, so there was nothing to do but guess again. A
        // refusal that cannot be acted on is a refusal that gets retried.
        //
        // The ids are read fresh rather than described, so this cannot go stale
        // as the library changes — and only the ones that can actually run are
        // offered, since suggesting an unapproved chain would move the refusal
        // one step later.
        const can = ((await actions.jobs.run({ kind: 'judge' })).jobs || []).filter(j => j.runnable)
        throw new Error(
          'A question needs a judge to ask it: pass "job" as well, and the question is added to what that job\'s prompt says. ' +
          (can.length
            ? `The judges that can run are: ${can.map(j => j.id).join(', ')}. For example job: "${can[0].id}".`
            : 'No judging chain is approved yet, so nothing can run one — see the Judge tab.'))
      }
      if (asked) {
        chain.brief = `${chain.brief}\n\n---\n\n## What you are being asked about, specifically\n\n${asked}`
      }

      const made = judging.add({ subject, by, tag, question: asked || null, ...chain })
      log.on('judging', made.id).good(`${made.ref} written — reads ${subject.name}`)
      return {
        ...made,
        note: made.job
          ? `${made.ref} is a draft. Queue it and the next machine that will take it reads ${subject.name}.`
          : `${made.ref} is a draft with no job, so nothing can run it yet. Give it one with judgementUpdate — a judgement without a chain is an opinion with nothing behind it.`
      }
    }
  },

  judgementUpdate: {
    about: 'Change a judgement that has not been given out yet',
    needs: 'workspace',
    takes: ['id', 'judgement'],
    run: ({ id, judgement }) => {
      const now = judging.get(id)

      // ---- WHAT MAY NOT CHANGE WHILE IT IS OUT, AND WHAT MAY ---------------
      //
      // This refused EVERY change to a judgement in `given`, which is right
      // about what it READS -- moving the subject or the job underneath a
      // machine makes the record describe something that did not happen -- and
      // was wrong about the outcome. A judgement whose app was restarted mid-run
      // sits in `given` for ever: the queue only looks at `queued`, and this,
      // the one door that could have recorded it, refused because it was in the
      // state that needed recording. A state nothing can leave is a state
      // nothing should be able to enter.
      //
      // Adoption is what SHOULD recover it and now does. This is the hand-worked
      // way back for when it cannot -- a machine that is gone, a run whose
      // output is unreadable -- and it is deliberately narrow: how it ended, and
      // nothing about what it was.
      const READING = ['subject', 'job', 'kind', 'branch', 'source', 'target', 'on', 'number', 'sha', 'question', 'tag', 'remembers', 'by']
      if (now.state === 'given') {
        const changing = Object.keys(typeof judgement === 'string' ? JSON.parse(judgement) : (judgement || {}))
        const reading = changing.filter(k => READING.includes(k))
        if (reading.length) {
          throw new Error(`${now.ref} is out on ${now.machine || 'a machine'}, so ${reading.join(', ')} cannot be changed — changing what it is reading while it reads it would make the record describe something that did not happen. How it ENDED can still be recorded.`)
        }
      }
      if (now.state === 'done') throw new Error(`${now.ref} is decided. A judgement is a record of what somebody thought at a moment — edit it and it stops being that. Ask for another one.`)
      return judging.update(id, judgement || {})
    }
  },

  judgementQueue: {
    about: 'Put a judgement in the queue. It goes ahead of tasks, because it reads work that is already waiting',
    needs: 'workspace',
    takes: ['id'],
    run: async ({ id }) => {
      const it = judging.get(id)
      if (it.state === 'done') throw new Error(`${it.ref} has already been decided. Ask for a new judgement rather than reopening one — the record of what was thought, and when, is the thing being kept.`)
      if (it.by === 'person') {
        throw new Error(`${it.ref} is for a person to read. The queue would give it to a machine and run a worker over it. Record what you decide with judgementVerdict instead.`)
      }
      if (!it.job) {
        throw new Error(`${it.ref} has no job, so there is nothing for a machine to run. A judgement without a chain is an opinion with nothing behind it — give it one with judgementUpdate.`)
      }

      const queued = judging.update(id, { state: 'queued' })
      log.on('judging', it.id).good(`${it.ref} queued — reads ${it.subject.name}`)
      return {
        ...queued,
        note: 'Queued ahead of any task waiting. A judgement reads work that is already waiting to land; a task makes more of it.'
      }
    }
  },

  judgementUnqueue: {
    about: 'Take a judgement back out of the queue. Does not stop one already running',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => {
      const it = judging.get(id)
      if (it.state !== 'queued') throw new Error(`${it.ref} is "${it.state}", not queued. One already given out is not called back by this — the machine is reading and would have to be stopped on it.`)
      return judging.update(id, { state: 'draft' })
    }
  },

  // WHAT A JUDGEMENT'S RUN SAID, which is a different question from what it
  // HANDED BACK.
  //
  // `judgementFindings` is the answer: the files a judge wrote deliberately,
  // for somebody to read. This is the transcript of the run that produced them —
  // and the only thing that answers "why is there no answer", which is the
  // question asked about every judgement that fails.
  //
  // IT EXISTS BECAUSE ITS ABSENCE WAS EXPENSIVE. The supervisor, looking for why
  // J41 came back empty, asked `taskLog` three times and was refused three
  // times: a judgement is not a task, and `taskLog` was the only log-reading
  // tool in the app. Same shape as the queue not adopting judgements and the
  // conclusion reader not knowing the third lane — written for tasks, judging
  // added later, and the second kind left out of a rule that already existed.
  judgementLog: {
    about: "One attempt's output from a judgement, kept on this host so it survives the machine",
    needs: 'workspace',
    takes: ['id', 'run', 'lines'],
    run: ({ id, run, lines }) => {
      const it = judging.get(id)
      if (!it) throw new Error(`There is no judgement "${id}". Ask for "judging" to see what there is.`)
      const ref = it.ref || judging.refOf(it.number)

      const kept = archive.list(it.uid)
      if (!run) {
        return {
          judgement: it.id,
          ref,
          attempts: kept,
          // A JUDGEMENT WITH NO KEPT LOG IS NOT THE SAME AS ONE THAT SAID
          // NOTHING, and the difference is worth a sentence: every judgement
          // read before this existed has no transcript at all, and no amount of
          // asking will produce one.
          note: kept.length
            ? 'Ask for one by run id.'
            : `Nothing was kept for ${ref}. Judgements read before this app started keeping their logs have none — the machine was rolled back and the output went with it.`
        }
      }
      return { judgement: it.id, ref, ...archive.read(it.uid, run, { lines }) }
    }
  },

  judgementFindings: {
    about: 'What a judgement handed back: the files it wrote, and one of them in full',
    needs: 'workspace',
    takes: ['id', 'file'],
    run: ({ id, file }) => {
      const it = judging.get(id)

      // THE ONLY WAY A JUDGE CAN SAY ANYTHING. It may not push to what it reads
      // — that is refused on the host, in the git route — so everything it found
      // arrives as files filed under the judgement.
      const handed = files.list(it.uid) || []

      // AND THIS IS THE SUPERVISOR'S ONE WINDOW ONTO THE CODE, which is the
      // whole reason it is worth being careful about. A supervisor decides what
      // to do next on a line from what a JUDGE says about it, not from reading
      // the repositories: it is not given the diff, the files a task delivered,
      // or a change to read. So what a judge hands back is not a convenience —
      // it is the channel, and if a judge says nothing the supervisor knows
      // nothing, which is the correct outcome rather than a gap to route around.
      if (!file) {
        return {
          ...whose(it),
          files: handed.map(f => ({ name: f.file, bytes: f.bytes, kept: f.kept || null })),
          // A RUN THAT CRASHED IS NOT A JUDGE THAT FOUND NOTHING, and saying so
          // is the whole of this branch. It said "it read the change and handed
          // nothing back. That is an answer" about a job that died at `require`
          // before reading a line — which sends whoever asked looking at the
          // code for a fault that is in the judge.
          //
          // From the attempt's exit code, which the queue records — see
          // tasks/queue.js. Absent on judgements from before that was kept, and
          // absent reads as the old sentence, which is right for them.
          note: handed.length
            ? 'Ask again with a file name to read one in full.'
            : it.state !== 'done'
              ? 'Nothing yet — it has not finished reading.'
              : (it.attempts || []).some(a => a.exit != null && a.exit !== 0)
                ? `The run FAILED — it did not read the change. Nothing here is a finding about the code. Look at what it said before the machine was put away: taskLogs, or judgementFindings once it has run properly. Exit ${(it.attempts || []).map(a => a.exit).filter(x => x != null).pop()}.`
                : 'It read the change and handed nothing back. That is an answer: there is no finding, and nothing about the code is known from it.'
        }
      }

      // ---- BY THE NAME SOMEBODY WOULD USE, NOT ONLY THE ONE ON DISK -------
      //
      // A handed-back file is stored as `<run>--<name>`, so the run it came from
      // is part of its identity and two runs of one judgement cannot overwrite
      // each other. That prefix is this app's bookkeeping, and asking for
      // "CLAIM.md" is what anybody reading the contract would do -- the
      // supervisor did exactly that and was refused for naming the file the job
      // was told to write.
      //
      // ONLY WHERE IT IS UNAMBIGUOUS. If two runs both handed back a CLAIM.md,
      // the short name names two things and the refusal is right -- so it lists
      // them and asks for the one that is meant, rather than picking the newer
      // and being quietly wrong about which reading is being read.
      const want = String(file)
      const ends = handed.filter(f => f.file === want || String(f.file).endsWith(`--${want}`))
      const one = ends.length === 1 ? ends[0] : handed.find(f => f.file === want)

      if (!one && ends.length > 1) {
        throw new Error(`${it.ref} handed back ${ends.length} files called "${want}", from different runs. Name the one that is meant: ${ends.map(f => f.file).join(', ')}.`)
      }
      if (!one) {
        throw new Error(`${it.ref} handed back nothing called "${file}". It handed back: ${handed.map(f => f.file).join(', ') || 'nothing at all'}.`)
      }
      // `files.read` refuses what is not text rather than mangling it, and says
      // so — which is the right answer to pass straight through.
      const body = files.read(it.uid, one.file)
      return { ...whose(it), file: one.file, bytes: one.bytes, text: body.text }
    }
  },

  judgementVerdict: {
    about: 'Record what a judgement decided: accepted or rejected, and why',
    needs: 'workspace',
    takes: ['id', 'verdict', 'note'],
    run: async ({ id, verdict, note }) => {
      const it = judging.get(id)

      const said = String(verdict || '').trim().toLowerCase()
      if (!judging.VERDICTS.includes(said)) {
        throw new Error(`A verdict is ${judging.VERDICTS.join(' or ')}. "${verdict}" is neither, and a judgement that cannot say which is one that has not been made.`)
      }

      // A REJECTION SAYS WHY, and this refusal is inherited from taskJudge, which
      // is the one thing in it worth keeping. The old wording promised the note
      // was "sent back to a worker" — nothing was sent anywhere, and it still is
      // not: a rejection is a RECORD, and what happens to the work is a person's
      // decision. Said plainly here rather than implied by a sentence that
      // describes something this app does not do.
      const why = String(note || '').trim()
      if (said === 'rejected' && !why) {
        throw new Error('Say why it was rejected. A rejection with no reason cannot be acted on by anybody — and nothing is automatically re-run, so this note is the whole of what survives.')
      }

      // WHAT IT WAS READ AGAINST, taken now, from git. This is what lets the
      // verdict say later whether it still describes what is there: a judgement
      // made before another push is a judgement of something else.
      //
      // REFUSED WHEN THERE ARE NONE, for either kind. The first version asked
      // `prtemplate.about` for both and got an empty object for every branch
      // judgement — recorded, accepted, and unable ever to go stale. An empty
      // set of tips is not "no information", it is a judgement that will read as
      // current for ever, which is the shape that lies.
      const tips = tipsFor(it.subject)
      if (!Object.keys(tips).length) {
        throw new Error(`This host cannot see where ${it.subject.name} is now, so a verdict could not record what it was made against — and would read as current for ever. Nothing was filed. Check the branch still exists across the repositories it was cut in.`)
      }

      const decided = judging.update(id, {
        state: 'done',
        verdict: said,
        note: why || null,
        tips,
        decided: new Date().toISOString()
      })

      // AND IT REACHES THE CUT, when the subject is one. A verdict living only
      // on the judgement is a verdict nobody looking at the change can see —
      // which is what taskJudge did, and why nothing about a landing ever said
      // whether it had been read.
      let onTheCut = null
      if (it.subject.kind === 'cut') {
        onTheCut = judgements.add(it.subject.source, it.subject.target, {
          verdict: said,
          note: why || null,
          by: it.by,
          judgement: it.id,
          ref: it.ref,
          job: it.job || null,
          contractName: it.contractName || null,
          tips
        })
      }

      log.on('judging', it.id)[said === 'accepted' ? 'good' : 'warn'](`${it.ref} ${said} — ${it.subject.name}`)
      return {
        ...decided,
        onTheCut,
        note: it.subject.kind === 'cut'
          ? `Recorded, and filed against ${it.subject.name}. It stops describing what is there the moment anything is pushed to it.`
          : `Recorded against ${it.subject.name}. Nothing is re-run and nothing is sent anywhere — what happens to the work is a person's decision.`
      }
    }
  },

  judgementRemove: {
    about: 'Throw a judgement away. The verdicts it reached, if any, stay on the cut',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => judging.remove(id)
  }
}
