'use strict'

// WHAT A SUPERVISOR MAY ASK THIS HOST FOR, and nothing else exists for it.
//
// A supervisor is a machine running Claude Code whose job is to drive work
// through this app: write a task, queue it, watch what came back, and decide
// what to write next. It is a project manager rather than a worker — it does
// none of the work itself, and the machine it runs on is out of the task pool
// for good (see tasks/queue.js).
//
// NOT THE COMMAND LINE, WHICH WAS THE ORIGINAL PLAN. Handing a supervisor
// `okc.js` is the obvious way to let it drive, and it is a security fault rather
// than a shortcut: the CLI is the WHOLE action surface — it deletes machines,
// approves jobs, hands out credentials, opens and merges pull requests. A
// supervisor with a shell has all of it, and so does anything that talks its way
// into that shell. A model reading a repository is a model reading text somebody
// else wrote.
//
// AN ALLOWLIST, NOT A FILTER. Every action a supervisor may ask for is named
// here, one line each, with why it is on the list. The consequence is the point:
// adding an action to this app adds nothing to what a supervisor can do. A
// deny-list, or a rule like "anything that only reads", would quietly grant each
// new capability on the day it was written, and the person writing it would not
// be thinking about supervisors at all.
//
// IT STILL GOES THROUGH THE ACTIONS. What is named here is called through the
// same `call()` every other caller uses, so every refusal, every workspace gate
// and every record still applies. This decides WHETHER, never HOW.
//
// WHAT IS DELIBERATELY ABSENT, and each one is a decision rather than an
// oversight:
//
//   approving anything     jobApprove, promptApprove, contractApprove. Approving
//                          is already refused over the wire, on purpose, and a
//                          supervisor is over the wire. It may write a task under
//                          a job a PERSON approved; it cannot decide what a
//                          worker is allowed to be told.
//   deleting anything      taskRemove, branchDelete, jobForget, prCutForget. A
//                          project manager that can throw work away is one bad
//                          turn from an empty board, and nothing here needs it.
//   machines               every vm*. It is a machine itself; giving it the power
//                          to start, snapshot or delete machines makes it the
//                          administrator of the thing it runs on.
//   credentials and keys   never. It does not need to see one to use one, and
//                          "a model may know something was done in the Keys tab
//                          without knowing what" is the rule this app is built to.
//   landing a change       prCutMake, prCutLand. Sending work out and merging it
//                          are the two acts with consequences outside this host.
//                          They are the natural next things to add and they are
//                          not on this list today.
//   judging                taskJudge. A verdict decides whether work was any
//                          good, and a supervisor judging its own delivery is a
//                          worker marking its own homework. Judging is being
//                          built as its own thing; see the judging suite.

// The list, and the reason each one is on it. The reason is not decoration: it is
// shown to the supervisor when it asks what it may do, so it can choose without
// guessing, and it is what somebody adding a line here has to be able to write.
const MAY = {
  // ---- what it may see -----------------------------------------------------
  tasks: 'the board: every task, and whether its branch has anything on it yet',
  taskProgress: 'every attempt at one task, and what its worker is doing now',
  taskArtifact: "what arrived on a task's branch: commits and files, per repository",
  taskDiff: "one repository's changes on a task's branch, in full",
  taskLog: "one attempt's output, so it can read why a run did what it did",
  branchBoard: 'every branch, who claims it, and what is on it',
  lines: 'the named lines, which are what a branch is cut from',
  jobs: 'the jobs it may write a task under — a job is a script a person approved',
  prompts: 'the prompt library, which is what a worker can be told',
  contracts: 'the contract library, which is the rules a worker is held to',
  prCuts: 'every change that has been sent out, and how far each has got',
  judgements: 'what has been judged about a change, and whether it still describes what is there',

  // ---- what it may do ------------------------------------------------------
  //
  // Four verbs, and they are one flow: cut a branch, write a task on it, queue
  // it, and take it back out if it was wrong. Everything else a supervisor wants
  // to do is one of these repeated.
  branchCreate: 'cut a branch across the repositories, which is where a task delivers',
  taskCreate: 'write a task on a branch that has been cut, under a job and contract a person approved',
  taskQueue: 'put a task in the queue, so the next free machine takes it',
  taskUnqueue: 'take a task back out of the queue, for one that should not have gone in'
}

// Whether an action is on the list. The name is compared exactly: a supervisor
// asking for "TaskCreate" is asking for something that does not exist, and
// matching loosely is how a list stops being a list.
const may = what => Object.prototype.hasOwnProperty.call(MAY, String(what || ''))

// THE REFUSAL SAYS WHAT IT MAY DO INSTEAD, because the thing reading it is a
// model that will otherwise try the same call again with a different spelling.
// It does not say why the action was left off — that is in the comment above,
// for people — and it never hints at what else this host can do.
const refuse = what =>
  `A supervisor may not ask for "${what}". What it may ask for: ${Object.keys(MAY).join(', ')}. ` +
  'Everything else on this host does not exist for a supervisor — it is a named list rather than a filter, ' +
  'so nothing is unlocked by an action being added elsewhere.'

// What the supervisor is told when it asks what it may do. Sorted, so the answer
// is stable and a model comparing two answers sees a real difference.
const list = () => Object.keys(MAY).sort().map(name => ({ what: name, why: MAY[name] }))

module.exports = { MAY, may, refuse, list }
