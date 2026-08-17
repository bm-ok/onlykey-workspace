'use strict'

// WHAT A MACHINE IS RUNNING, of either kind, answered in one place.
//
// Every endpoint a guest can reach asks this question, and none of them asks the
// guest: a machine says which machine it is by holding its own token, and this
// host looks up what that machine was given. There is no argument to lie about,
// which is what makes the whole surface safe — see the jobs API drills.
//
// It was written out four times as `tasks.read().find(t => t.machine === name &&
// t.state === 'given')`, which was right while a task was the only thing a
// machine could be running. A judgement is the second, and four copies of a
// lookup is four places to remember when there is a third.
//
// JUDGEMENT FIRST, AND THAT ORDER IS DELIBERATE. A machine runs one thing at a
// time, so the two can only both answer if something has already gone wrong —
// and of the two possible wrong answers, "this is a judgement" is the one that
// refuses a push and files nothing against the work. When the record is
// confused, the safe reading wins.

const tasks = require('./store')
const judging = require('./judging')

// One shape for both, so a caller can do its job without knowing which it got:
// what to call it, what to file things under, and the record itself for the
// callers that do care.
function whatIsOn (name) {
  const machine = String(name || '')
  if (!machine) return null

  const judgement = judging.read().find(j => j.machine === machine && j.state === 'given')
  if (judgement) {
    return {
      kind: 'judgement',
      ref: judging.refOf(judgement.number),
      // The uid is what a session and an artifact are filed under. Never the
      // number, which is only unique within a kind — a judgement and a task can
      // both be 4, and filing them together would hand one's transcript to the
      // other.
      uid: judgement.uid,
      id: judgement.id,
      // WHAT IT IS READING, which is not a branch it may write to. See the git
      // route: a judgement reads, and a push from one is refused.
      reads: judgement.subject && judgement.subject.name,
      title: judgement.title,
      item: judgement
    }
  }

  const task = tasks.read().find(t => t.machine === machine && t.state === 'given')
  if (task) {
    return {
      kind: 'task',
      ref: `#${task.number}`,
      uid: task.uid,
      id: task.id,
      number: task.number,
      title: task.title,
      item: task
    }
  }

  return null
}

// For the callers that only want a task and would be wrong to accept a
// judgement — the ones that write to a task record. Named so the reading is
// obvious at the call site rather than a `.kind ===` somebody can forget.
const taskOn = name => {
  const on = whatIsOn(name)
  return on && on.kind === 'task' ? on.item : null
}

module.exports = { whatIsOn, taskOn }
