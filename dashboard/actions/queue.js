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
const { tasks, queue } = s

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
      const waiting = queue.order(tasks.read()
        .filter(t => t.state === 'queued')
        .map(t => ({
          // WHAT KIND OF WORK THIS IS, said on every entry rather than implied
          // by which list it came from. A board that has to know where a row was
          // read from to say what it is cannot show two kinds in one list.
          kind: 'task',
          number: t.number,
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
        })))

      return {
        ...queue.state(),
        waiting,
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
