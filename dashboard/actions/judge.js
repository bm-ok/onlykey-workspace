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
const { log, judging, jobs } = s

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
    about: 'Ask for a judgement of a branch cut or a PR cut: what is read, and which job reads it',
    needs: 'workspace',
    takes: ['kind', 'branch', 'source', 'target', 'job', 'by', 'tag'],
    run: async ({ kind, branch, source, target, job, by, tag }) => {
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

      // THE CHAIN IT WILL BE READ UNDER, and it is approved or it does not run.
      // A judging job is a job — same library, same approval, same rule that a
      // model may write one and may not ratify its own. Nothing new appears
      // here, which is most of the argument for this shape.
      let chain = {}
      if (job) {
        const which = jobs.get(job)
        if (!which) throw new Error(`There is no job "${job}". Ask jobs for the list — a judgement runs a job like any other work.`)
        const answer = await actions.jobs.run({})
        const said = (answer.jobs || []).find(j => j.id === which.id) || {}
        if (!said.runnable) {
          throw new Error(`The job "${which.id}" cannot run: ${said.whyNot || 'something in its chain is not approved'}. A judgement is held to the same approvals as any other work — more so, since its whole purpose is to say whether rules were followed.`)
        }
        // COPIES, NEVER NAMES. The spine's rule, and it matters most here: a
        // judgement read six weeks later has to be able to say what it was
        // holding the work to, and a library entry rewritten since would
        // silently change the answer.
        chain = {
          job: which.id,
          brief: said.brief || which.brief || null,
          promptId: said.promptId || null,
          promptName: said.promptName || null,
          rules: said.rules || null,
          contractId: said.contractId || null,
          contractName: said.contractName || null
        }
      }

      const made = judging.add({ subject, by, tag, ...chain })
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

  judgementRemove: {
    about: 'Throw a judgement away. The verdicts it reached, if any, stay on the cut',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => judging.remove(id)
  }
}
