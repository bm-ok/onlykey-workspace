'use strict'

// a run says whose it is — so nothing else declares it dead
//
// A RUN IN FLIGHT IS WRITTEN DOWN AS RUNNING, and that record outlives the
// process writing it. So something has to decide, on the way up, whether a run
// found in that state belongs to a process that is gone — the app was restarted
// or killed mid-drill — or to one that is still going.
//
// IT USED TO DECIDE THAT BY ASKING ITSELF WHETHER IT WAS STARTING. `tookOver()`
// ran at module load, so anything that loaded this app said "a run was going
// when I started, therefore it is dead" — which is true of the dashboard
// starting and false of every other process that loads these modules.
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
//
// ---- what this asks, and what it stopped asking --------------------------
//
// IT USED TO `require('../../../core/testruns')` AND CHECK `stillThere` DIRECTLY
// — that a live pid reads as alive and a made-up one does not. Two things were
// wrong with that and only one of them is the path.
//
// A DRILL CANNOT REACH THE APP'S INSIDES AT ALL HERE. These files are COPIED
// into `dist/suites` and run from there, with only the harness beside them —
// see the PAYLOADS list in webpack.config.js. Nothing else is there to require,
// so the module was not merely misnamed, it was unreachable. That is why this
// suite has read `will not load` since the port began.
//
// AND IT WAS A UNIT TEST WEARING A DRILL'S CLOTHES. Whether `stillThere` answers
// correctly about a pid is a question about a function, with no host, no
// machine and no run in it — `test/tabs/runs.test.js` asks exactly that, and is
// the right place for it. A drill is for what only a live host can show.
//
// SO WHAT IS LEFT HERE IS THE HALF THAT COULD NEVER BE A UNIT TEST: this check
// is itself part of a run, so it can ask the app what the run it is inside says
// about itself. Nothing is arranged and no board is faked — the thing being
// described is the thing doing the asking.

const { it } = require('../../harness')

it('the run happening right now says which process it belongs to', async ({ okc, assert, log }) => {
  // ASKED THROUGH THE ACTION, which is the only surface a drill has and the one
  // the window and the command line read too. If these three could ever
  // disagree, the drill would be checking a fourth thing nobody uses.
  const board = await okc('suites', {})
  const run = board.run

  assert.ok(run, 'there is no record of a run, and this check is inside one')
  assert.ok(run.running, 'the run this check belongs to does not read as running — something has already taken it over')
  assert.ok(run.pid, 'the run does not say which process it belongs to, so anything loading this app would declare it dead')

  // THE PID IS THIS PROCESS'S, and that is stronger than "some process is
  // alive". The drills run in the app, so the run in flight must belong to the
  // app — a run naming somebody else's pid while this check executes would mean
  // the record and the runner had come apart.
  assert.equal(run.pid, process.pid,
    `the run names pid ${run.pid} and this check is running in ${process.pid}`)

  assert.ok(!run.interrupted, 'the run this check is part of is marked interrupted, which is the exact corruption this exists to prevent')

  log(`this run belongs to pid ${run.pid}, which is the process asking, and is not marked interrupted`)
})
