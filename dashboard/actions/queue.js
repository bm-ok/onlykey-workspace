'use strict'

// THE QUEUE, AS A THING OF ITS OWN.
//
// It used to be one panel inside Tasks, answered by an action that lived with
// the task actions, because for a long time a task was the only thing that could
// be queued. That stops being true the moment judging exists: a judgement waits
// for a machine exactly as a task does, and the two share one queue rather than
// having one each.
//
// TWO QUEUES WOULD BE THE FAULT THIS FILE EXISTS TO PREVENT. Given a queue of
// tasks and a queue of judgements, there are two answers to "what is next" and
// no answer at all to "what is this host doing" — and the priority between them
// becomes a thing nobody wrote down, decided by whichever loop ticked first.
//
// SO WHAT IS QUEUED IS AN ENTRY, and its `kind` says what it is. Everything else
// here — the ordering, the machines that could take it, the reasons they cannot
// — is the same question for both, which is the argument for one queue.
//
// THE ORDER IS NOT DECIDED HERE. `tasks/queue.js` owns it, because that file
// dispatches: a board that sorts its own copy is a board that can disagree with
// what actually goes out, and the two halves would both look right on their own.

const actions = require('./table')
const s = require('./shared')
const { tasks, judging, queue } = s

module.exports = {
  queueState: {
    about: 'What the queue is doing: what is waiting, in what order, and which machines could take it',
    needs: 'workspace',
    run: async () => {
      const { vms } = await actions.vmList.run({})

      // The STORE, not the `tasks` action.
      //
      // That action reads every task's branch out of git to say what is on it,
      // which is three or four processes per repository per task -- and this is
      // asked for on every draw, alongside the action that already does it.
      // Nothing here needs to know what a branch contains: a queued task is
      // queued whatever is on its branch.
      // BOTH KINDS, READ SEPARATELY AND SORTED TOGETHER. Two stores, because a
      // judgement and a task are different records; one line, because they want
      // the same machines. `queue.order` is what decides which goes first, and
      // it is the same function the tick dispatches by.
      const toJudge = (judging.read() || [])
        .filter(j => j.state === 'queued')
        .map(j => ({
          kind: 'judgement',
          number: j.number,
          // ITS OWN LABEL, carried rather than derived. A judgement and a task
          // can both be number 4, and nothing drawing a row should have to know
          // this app's prefix conventions to say which is which.
          ref: judging.refOf(j.number),
          id: j.id,
          title: j.title,
          // What it READS. A judgement takes no branch of its own — it is not
          // delivering anywhere — so this is the subject, not a destination.
          on: j.subject && j.subject.name,
          reads: j.subject && j.subject.kind,
          tag: j.tag || null
        }))

      const toDo = tasks.read()
        .filter(t => t.state === 'queued')
        .map(t => ({
          // WHAT KIND OF WORK THIS IS, said on every entry rather than implied
          // by which list it came from. A board that has to know where a row was
          // read from to say what it is cannot show two kinds in one list.
          kind: 'task',
          number: t.number,
          ref: `#${t.number}`,
          id: t.id,
          title: t.title,
          // What it delivers on. A task works on a branch; a judgement will name
          // the cut or line it reads instead, which is why this is not called
          // "branch" at the top level of an entry.
          on: t.branch,
          branch: t.branch,
          // A tagged entry waits for its own kind of machine rather than taking
          // somebody else's — so a row that is not moving has its reason here
          // rather than in a log line nobody was watching.
          tag: t.tag || null
        }))

      const waiting = queue.order([...toJudge, ...toDo])

      // ---- AND WHAT HAS ALREADY BEEN THROUGH -----------------------------
      //
      // A QUEUE WITH NOTHING IN IT LOOKS THE SAME AS ONE NOTHING HAS EVER USED,
      // and those want opposite responses: one is a host keeping up, the other
      // is a host where something is wrong upstream and no work is arriving.
      // "Nothing is waiting and nothing is running" was the whole screen on an
      // idle host, and it said neither.
      //
      // FROM THE SAME TWO STORES the waiting list is read from, and ended by the
      // same words the rest of this app uses. A run that never started is in
      // here too -- it went through the queue, and "it was given a machine and
      // produced nothing" is exactly the history somebody is looking for.
      const ENDED = new Set(['done', 'accepted', 'rejected', 'failed'])
      const when = r => r.read || r.updated || r.created || ''

      const past = [
        ...(judging.read() || []).filter(j => ENDED.has(j.state)).map(j => ({
          kind: 'judgement',
          ref: judging.refOf(j.number),
          id: j.id,
          title: j.title,
          on: j.subject && j.subject.name,
          machine: j.machine || null,
          at: when(j),
          state: j.state,
          // A JUDGEMENT ENDING IS NOT A VERDICT. `done` means somebody read it;
          // what they decided is recorded separately and is often not decided
          // at all, which is a real state and worth showing as one.
          verdict: j.verdict || null,
          concluded: j.concluded || null
        })),
        ...tasks.read().filter(t => ENDED.has(t.state)).map(t => ({
          kind: 'task',
          ref: `#${t.number}`,
          id: t.id,
          title: t.title,
          on: t.branch,
          machine: t.machine || null,
          at: when(t),
          state: t.state,
          verdict: t.verdict || null,
          // WHETHER IT RAN AT ALL. A task can be `done` having never been given
          // a machine -- see what the queue does when it can be given no
          // identity -- and a history that showed those the same as a real run
          // would be the most misleading list on the screen.
          tries: (t.attempts || []).length
        }))
      ]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        // ENOUGH TO SEE THE SHAPE OF THE DAY, not an archive. The Tasks and
        // Judge tabs are where everything lives; this is the last few things
        // this queue did, beside what it is about to do.
        .slice(0, 12)

      return {
        ...queue.state(),
        waiting,
        history: past,
        // Counted per kind, because "four waiting" says nothing about whether
        // this host is behind on reading work or behind on doing it.
        counts: waiting.reduce((n, e) => ({ ...n, [e.kind]: (n[e.kind] || 0) + 1 }), {}),
        machines: queue.availability(vms),
        order: queue.ORDER,
        every: `${queue.TICK / 1000}s`
      }
    }
  }
}
