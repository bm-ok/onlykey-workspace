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
const { log, judging, jobs, prompts, contracts, judgements, prtemplate, branches, repos, files } = s

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
  judging: {
    about: 'Every judgement: what is waiting to be read, what is being read, and what was decided',
    needs: 'workspace',
    run: () => {
      const all = judging.all()
      return {
        judgements: all,
        // Counted by state, because "eleven judgements" says nothing about
        // whether this host is behind. What somebody wants is how many are
        // still to happen.
        waiting: all.filter(j => j.state === 'queued').length,
        running: all.filter(j => j.state === 'given').length,
        decided: all.filter(j => j.state === 'done').length,
        note: all.length
          ? null
          : 'Nothing has been asked for yet. A judgement reads a branch cut or a PR cut — judgementCreate says which.'
      }
    }
  },

  judgementCreate: {
    about: 'Ask for a judgement of a branch cut or a PR cut: what is read, which job reads it, and what question it is being asked',
    needs: 'workspace',
    takes: ['kind', 'branch', 'source', 'target', 'job', 'by', 'tag', 'question'],
    run: async ({ kind, branch, source, target, job, by, tag, question, _overTheWire }) => {
      // WHAT IS BEING READ, resolved before anything is written, so a judgement
      // is never filed against a cut that does not exist. `subjectFrom` is where
      // the two shapes are understood, and it refuses anything else.
      const subject = judging.subjectFrom({ kind, branch, source, target })

      // AND IT HAS TO BE THERE. A judgement of something this host cannot find is
      // a machine booted to read nothing, twenty minutes from now, and a verdict
      // filed under a name that is nearly right.
      if (subject.kind === 'cut') {
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
      if (now.state === 'given') throw new Error(`${now.ref} is out on ${now.machine || 'a machine'}. Changing what it is reading while it reads it would make the record describe something that did not happen.`)
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
          note: handed.length
            ? 'Ask again with a file name to read one in full.'
            : it.state === 'done'
              ? 'It read the change and handed nothing back. That is an answer: there is no finding, and nothing about the code is known from it.'
              : 'Nothing yet — it has not finished reading.'
        }
      }

      const one = handed.find(f => f.file === String(file))
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
