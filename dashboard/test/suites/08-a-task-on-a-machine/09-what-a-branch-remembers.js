'use strict'

// what a branch remembers — two passes over one cut
//
// A CLAUDE SESSION IS `~/.claude` WITHOUT THE CREDENTIAL: what a worker
// remembers, kept on this host because the machine that made it is rolled back.
// What it is FILED UNDER decides whether a second pass over the same branch
// arrives knowing anything.
//
//   filed by uid      every task starts cold and reads its way back to where the
//                     last one already was
//   filed by subject  several passes over one branch are one conversation
//
// See REMEMBERS in tasks/sessions.js, which is a constant in source rather than
// a setting, so that changing it means meeting the argument beside it.
//
// THIS CHECK IS TRUE EITHER WAY, which is what makes it a check rather than an
// experiment. It reads the flag and asserts what the flag PROMISES: with memory
// off, the second pass must say it has none; with memory on, it must produce
// something it could only know from the first. A drill that only worked in one
// position would have to be deleted the day somebody changed it.
//
// THE PROOF IS A NUMBER THAT EXISTS NOWHERE ON DISK. The first pass picks one and
// states it in its report, and is told not to write it into any file, commit
// message or anything else in the repository. So the second pass cannot find it
// by reading, cannot infer it, and cannot get it right by luck. Either the
// conversation carried it or it did not.
//
// IT SPENDS REAL MODEL TOKENS. Two Claude runs on a real machine, which is why
// it is gated behind `slow` and says so — every other drill in this suite is
// free to run and this one is not.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')
const sessions = require('../../../tasks/sessions')

const JOB = 'do-the-work'
const KIND = 'test'

// WHAT THE FIRST PASS IS ASKED FOR. Real work AND a number, because a pass that
// only picked a number would leave nothing on the branch and the second pass
// would have nothing to be continuing.
const ONE = [
  'Two things, and the second one matters most.',
  '',
  'FIRST: in local-repo-a, add a file called PASS-ONE.md containing one line saying what this branch is for, and commit it.',
  '',
  'SECOND: pick a four-digit number yourself, at random. State it in your report on a line of its own, exactly like this:',
  'CHOSEN NUMBER: 1234',
  '',
  'Do NOT write that number into any file, any commit message, or anywhere in the repository. It must exist only in your report and in your own memory of this conversation.'
].join('\n')

// AND THE SECOND, WHICH IS THE WHOLE DRILL. It is given a way to say it does not
// know, because "it made something up" and "it remembered" are the same shape
// unless the honest answer is available and easy.
const TWO = [
  'Do NOT read the repository, do not open any file, and do not run git.',
  '',
  'Answer from memory alone. On the previous pass over this same branch, what did you do, and what four-digit number did you choose?',
  '',
  'State it exactly like this:',
  'REMEMBERED NUMBER: 1234',
  '',
  'If you have no memory of a previous pass on this branch, reply with exactly this and nothing else:',
  'NO MEMORY'
].join('\n')

const wait = ms => new Promise(r => setTimeout(r, ms))

// Queue it, wait for it to end, and hand back everything it printed.
async function runIt (okc, assert, state, title, brief) {
  const { contracts } = await okc('contracts')
  const contract = (contracts || []).find(c => c.approved && (c.kind || 'task') === 'task')
  assert.needs(contract, 'no task contract is approved, and a task carries the rules a worker is held to')

  const task = await okc('taskCreate', {
    task: { title, brief, branch: state.branch, job: JOB, contractId: contract.id, tag: state.tag }
  })
  state.tasks.push(task)
  await okc('taskQueue', { id: task.id })

  let done = null
  for (let i = 0; i < 180; i++) {
    const { tasks } = await okc('tasks')
    const t = (tasks || []).find(x => x.id === task.id)
    if (t && t.state === 'done') { done = t; break }
    await wait(5000)
  }
  assert.ok(done, `"${title}" never finished`)

  // WHAT THE WORKER ACTUALLY SAID, which is in the run's own output rather than
  // in what the job returned — the job hands back a summary, and the words are
  // the point here.
  const progress = await okc('taskProgress', { id: task.id })
  const last = (progress.attempts || [])[(progress.attempts || []).length - 1]
  assert.ok(last && last.run, `"${title}" recorded no attempt to read`)
  const kept = await okc('taskLog', { id: task.id, run: last.run })
  return { task: done, text: String(kept.text || kept.log || '') }
}

it('a branch, and a first pass that picks a number it writes down nowhere', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this runs TWO real Claude workers on a real machine and SPENDS MODEL TOKENS — minutes, and money. Ask for it with: suiteRun --suite "a task on a machine" --slow true')

  const { vms } = await okc('vmList')
  const free = vms.filter(v => v.stage === 'ready' && !v.branch && !v.borrowed && v.forTasks !== false && v.baseSnapshot)
  assert.needs(free.length, 'no machine is free, ready and holding nothing')
  state.tag = free.some(v => (v.tags || []).includes(KIND)) ? KIND : null

  const job = ((await okc('jobs')).jobs || []).find(j => j.id === JOB && j.approved)
  assert.needs(job, `"${JOB}" is not an approved job here, and this drill needs the one that gives a brief to a worker`)

  state.line = await aLine(okc, assert)
  state.branch = scratch('remembers')
  state.tasks = []
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving what a branch does or does not remember between passes', group: state.line })

  const first = await runIt(okc, assert, state, 'pass one: do a little work and choose a number', ONE)

  const said = first.text.match(/CHOSEN NUMBER:\s*(\d{4})/)
  assert.ok(said, `the first pass never stated a number in the form asked for, so there is nothing for the second pass to remember. It ended: ${first.text.slice(-400)}`)
  state.number = said[1]

  // AND IT IS NOWHERE ON THE BRANCH. If the worker wrote it into a file after
  // all, the second pass could read it and this drill would prove nothing —
  // so that is checked rather than trusted.
  const art = await okc('taskArtifact', { id: state.tasks[0].id })
  const everything = JSON.stringify(art)
  assert.ok(!everything.includes(state.number),
    `the number ${state.number} appears in what the first pass committed, so the second pass could simply read it and this proves nothing about memory`)

  log(`pass one chose ${state.number}, and it is not on the branch`)
}, { gate: true, minutes: 30 })

it('and the second pass knows what the flag says it should know', async ({ okc, assert, state, log }) => {
  const second = await runIt(okc, assert, state, 'pass two: say what you remember', TWO)
  const text = second.text

  const remembered = (text.match(/REMEMBERED NUMBER:\s*(\d{4})/) || [])[1] || null
  const blank = /NO MEMORY/.test(text)
  const remembers = !!(sessions.REMEMBERS && sessions.REMEMBERS.worker)

  // THE ASSERTION FOLLOWS THE FLAG, so this check is true in both positions and
  // does not have to be rewritten when somebody changes it.
  if (remembers) {
    assert.ok(!blank, `sessions are filed by subject, so the second pass over "${state.branch}" should have carried the first pass's conversation — and it said it had no memory at all`)
    assert.ok(remembered, `it did not say what it remembered in the form asked for. It ended: ${text.slice(-400)}`)
    assert.equal(remembered, state.number,
      `it remembered ${remembered} and the first pass chose ${state.number}. A number it could not read and did not carry is a number it INVENTED, which is worse than not remembering: it is a worker that is confident and wrong`)
    log(`memory is on: pass two recalled ${remembered}, which pass one chose and never wrote down`)
  } else {
    assert.ok(!remembered || remembered !== state.number,
      `sessions are filed by uid, so the second pass should have started cold — and it produced ${remembered}, the number the first pass chose. Either the conversation carried when it should not have, or the number reached the branch after all`)
    assert.ok(blank, `it started cold, correctly, and did not say so in the form asked for. It ended: ${text.slice(-400)}`)
    log('memory is off: pass two started cold and said so, which is what filing by uid means')
  }
})

cleanup(async ({ okc, state }) => {
  for (const t of state.tasks || []) await okc('taskRemove', { id: t.id }).catch(() => {})

  // The machine lets go before the branch can. See the cleanup in "a run that
  // loses the network".
  for (let i = 0; i < 24; i++) {
    const busy = ((await okc('vmList')).vms || []).some(v => v.branch === state.branch)
    if (!busy) break
    await new Promise(r => setTimeout(r, 5000))
  }
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
  state.tasks = null
  state.branch = null
})
