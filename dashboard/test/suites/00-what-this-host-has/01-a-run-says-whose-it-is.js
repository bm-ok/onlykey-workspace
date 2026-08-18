'use strict'

// a run says whose it is — so nothing else declares it dead
//
// A RUN IN FLIGHT IS WRITTEN DOWN AS RUNNING, and that record outlives the
// process writing it. So something has to decide, on the way up, whether a run
// found in that state belongs to a process that is gone — the app was restarted
// or killed mid-drill — or to one that is still going.
//
// IT USED TO DECIDE THAT BY ASKING ITSELF WHETHER IT WAS STARTING. `tookOver()`
// runs at module load of actions/tests.js, so anything that loads this app said
// "a run was going when I started, therefore it is dead" — which is true of the
// dashboard starting and false of every other process that loads these modules.
//
// AND ONE OF THOSE IS A DOCUMENTED VERIFICATION STEP. `node -e
// "require('./server.js')"` is what CLAUDE.md tells people to run to catch a
// dangling export. Running it while the drills were going marked the live run
// interrupted and flipped every check in flight to `interrupted` — corrupting
// the board the run was still writing to, from a command whose whole purpose is
// to be safe to run.
//
// WHAT IT COST BEYOND THE BOARD: `interrupted` is what makes a keeping drill
// resume rather than start over, so a spurious one changes what the next run
// does. And the banner that says a run is going stayed dark through a run that
// was plainly happening, which is how this was found at all.
//
// SO A RUN NAMES ITS PROCESS. Nothing takes over a run whose process is still
// alive. A pid could in principle be reused by something unrelated, and the
// worst that does is leave a stale run marked running, which the next `suiteRun`
// reports plainly — against a LIVE run marked interrupted, which corrupts what
// is being written. Between those two the choice is not close.

const { it } = require('../../../tasks/harness')
const testruns = require('../../../core/testruns')

it('a process that is running reads as running, and one that is not does not', ({ assert, log }) => {
  // SIGNAL 0 ASKS THE OPERATING SYSTEM whether a pid exists without sending it
  // anything. It is in node itself — no binary, which this project does not have
  // and does not want.
  assert.ok(testruns.stillThere(process.pid), 'this very process does not read as running, so nothing built on that reading can be trusted')

  // A pid nothing could be using. If this ever starts failing on a host, that is
  // worth knowing rather than worth loosening.
  assert.ok(!testruns.stillThere(0x7fffffff), 'a pid nothing is using reads as alive, so a dead run would never be taken over')
  assert.ok(!testruns.stillThere(null), 'no pid at all reads as alive')
  assert.ok(!testruns.stillThere(undefined), 'an absent pid reads as alive')

  log(`pid ${process.pid} is alive, 0x7fffffff is not, and neither is nothing`)
})

it('and the run happening right now says which process it belongs to', ({ assert, log }) => {
  // SELF-REFERENTIAL ON PURPOSE, AND THAT IS WHAT MAKES IT HONEST: this check is
  // itself part of a run, so a run IS in flight while it is asked. There is no
  // arranging to do and no fake board — the thing being described is the thing
  // doing the asking.
  //
  // BEFORE THE FIX THIS FAILED ON THE FIRST LINE, because a run recorded no pid
  // at all. There was nothing to consult, which is why the question was answered
  // with "am I starting?" instead.
  const run = testruns.lastRun()
  assert.ok(run, 'there is no record of a run, and this check is inside one')
  assert.ok(run.running, 'the run this check belongs to does not read as running — something has already taken it over')
  assert.ok(run.pid, 'the run does not say which process it belongs to, so anything loading this app would declare it dead')
  assert.ok(testruns.stillThere(run.pid), `the run names pid ${run.pid}, which is not alive`)
  assert.ok(!run.interrupted, 'the run this check is part of is marked interrupted, which is the exact corruption this exists to prevent')

  log(`this run belongs to pid ${run.pid}, which is alive, and is not marked interrupted`)
})
