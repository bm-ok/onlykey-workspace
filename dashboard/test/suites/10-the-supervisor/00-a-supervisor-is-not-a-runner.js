'use strict'

// a supervisor is not a runner — the boundary, before there is anything on it
//
// A supervisor machine decides what work to give. A runner does the work. The
// only thing standing between those two sentences is a tag, so the tag is what
// this checks: it cannot be typed on, it cannot be typed off, a task cannot ask
// for a machine carrying it, and the queue never counts one as free.
//
// NONE OF THIS NEEDS A MACHINE. Every check reads this host's own records or
// tries something that is refused, which is why it can run in seconds beside
// drills that take twenty minutes. What needs a real supervisor machine — the
// API it talks to this host over — is drafted at the bottom and does not exist.

const { it, draft, requires } = require('../../../tasks/harness')

// A supervisor is a machine, and the queue it stays out of is the one that gives
// work to the machines. Both of those are proven before this.
requires('the machines are built')

it('a supervisor machine is one the queue never offers', async ({ okc, assert, state, log }) => {
  // FROM THE QUEUE'S OWN ANSWER, not from the tag this drill can see. The tag is
  // what the queue reads; whether it acts on it is the thing worth checking, and
  // a drill that compared a tag against a tag would prove only that a string is
  // itself.
  const machines = (await okc('vmList')).vms || []
  const supervisors = machines.filter(m => m.supervisor)
  state.supervisors = supervisors

  if (!supervisors.length) {
    log('there is no supervisor machine on this host yet, so there is nothing for the queue to skip')
    return
  }

  const queue = await okc('queueState')
  const said = new Map(((queue.machines) || []).map(m => [m.name, m]))
  for (const m of supervisors) {
    const how = said.get(m.name)
    assert.ok(how, `the queue says nothing at all about ${m.name}, so it cannot be shown to be skipping it`)
    assert.ok(how.free === false,
      `the queue counts the supervisor ${m.name} as free, so the next queued task can be given to it — which rolls it back to its base snapshot while it is deciding what work to give`)
    assert.ok(/supervisor/i.test(String(how.why || '')),
      `the queue holds ${m.name} back for the wrong reason: "${how.why}". A supervisor is out of the pool for good, and a reason that can change is one somebody will change`)
    log(`${m.name}: ${how.why}`)
  }
})

it('and the tag that makes it one cannot be typed on', async ({ okc, assert, state, log }) => {
  // THE TAG IS THE GUARANTEE, so the guarantee has to survive somebody editing
  // tags. A runner given the tag by hand would stop taking work and would still
  // have none of what a supervisor needs — which reads, from the board, as a
  // queue that has quietly gone dead.
  const machines = (await okc('vmList')).vms || []
  const runner = machines.find(m => !m.supervisor)
  assert.needs(runner, 'there is no ordinary runner on this host to try tagging as a supervisor')

  const was = runner.tags || []
  await assert.refuses(
    () => okc('vmTags', { name: runner.name, tags: [...was, 'supervisor'] }),
    'not a tag you can add',
    `"supervisor" was typed onto ${runner.name}, which takes it out of the queue without giving it any of what a supervisor needs`)

  const now = await okc('vmTags', { name: runner.name })
  assert.ok(!(now.tags || []).includes('supervisor'),
    `the refusal was reported and the tag went on anyway: ${runner.name} now carries ${(now.tags || []).join(', ')}`)
  log(`${runner.name} refused the tag, and still carries ${(now.tags || []).length ? now.tags.join(', ') : 'none'}`)
})

it('and it cannot be typed off one that has it', async ({ okc, assert, state, log }) => {
  // THE OTHER DIRECTION, which is the one that costs something. A supervisor
  // untagged is a supervisor in the pool, and the first queued task rolls it back
  // to base — losing whatever it was in the middle of, on a machine nobody
  // thought of as being at risk.
  const one = (state.supervisors || [])[0]
  assert.needs(one, 'there is no supervisor machine on this host to try untagging')

  await assert.refuses(
    () => okc('vmTags', { name: one.name, tags: (one.tags || []).filter(t => t !== 'supervisor') }),
    'keeps the "supervisor" tag',
    `"supervisor" was taken off ${one.name}, which puts it in the queue's pool and lets a task roll it back mid-thought`)

  const now = await okc('vmTags', { name: one.name })
  assert.ok((now.tags || []).includes('supervisor'),
    `the refusal was reported and the tag came off anyway: ${one.name} now carries ${(now.tags || []).join(', ')}`)
  log(`${one.name} kept its tag, and still carries ${now.tags.join(', ')}`)
})

it('and a task cannot ask to be run on one', async ({ okc, assert, log }) => {
  // A TASK ASKING FOR A SUPERVISOR IS A TASK THAT WAITS FOR EVER. The queue
  // waits rather than falling back when a tag matches nothing free — which is
  // right, and for this tag means a board showing work as queued that nothing
  // will ever pick up. Refused where it is written instead.
  //
  // AND REFUSED FOR THE TAG, not for anything else wrong with it. This drill
  // asked with no branch first and was told about the branch — a refusal that
  // would pass for ever without the tag being looked at once, which is why
  // `refuses` matches the sentence rather than only the throwing.
  //
  // What it found: the tag was checked in the task store, after the action had
  // already checked the branch exists. Both are true, and the order matters to
  // whoever reads it. A branch is about the workspace as it stands — cut it, and
  // the task is fine. A supervisor tag is impossible whatever anybody cuts, so
  // being told about the branch first sends somebody off to fix something that
  // was never the problem. taskCreate refuses it first now.
  await assert.refuses(
    () => okc('taskCreate', {
      task: {
        title: 'a drill asking for a supervisor',
        branch: 'drill/asks-for-a-supervisor',
        tag: 'supervisor'
      }
    }),
    'out of the pool for good',
    'a task was allowed to ask for a machine tagged "supervisor", which is work that will sit queued for ever')
  log('a task asking for a supervisor is refused when it is written, not left to wait')
})

// ---- what a supervisor will actually do, none of which exists --------------
//
// THE SHAPE FIRST, because it is the part that is decided rather than discovered:
//
//     a runner    is GIVEN work, over the jobs API, and hands results back
//     a supervisor  ASKS for work to exist, over an API of its own, and reads
//                   what came back
//
// Two directions, two APIs, and the second one has nothing written yet.

draft('and the jobs API a runner uses is proven end to end',
  'IT IS EXERCISED AND NOT PROVEN, which are different. A job on a machine is handed a set of calls — fetch its task, post an artifact, hand back its session, report a run — and suite 08 uses several of them by running a real task through the queue with the api-tour job. ' +
  'What is missing is a check of the API ITSELF: every call it offers, asked directly, with the answers and the refusals stated. Today a call that quietly stopped working would show up as a task that failed for some other-looking reason, twenty minutes into a drill that needs a machine. ' +
  'THE CHECK: from a machine, exercise every endpoint the jobs API exposes — the ones that should answer, and the ones that should be REFUSED when asked by a machine that is not running that task. Suite 08 already posts to /artifact and /session exactly as machines/job-api.js does, so the pattern is written; what is missing is the list being complete rather than the two calls a drill happened to need. ' +
  'AND IT IS THE MODEL FOR THE SUPERVISOR API BELOW, which is the other reason to write it first: the same drill shape, pointed at the other direction.')

// THE API THAT WAS DRAFTED HERE IS BUILT, and its checks are the file beside
// this one: "driving the app". What it settled, since a draft is only worth
// keeping while the questions in it are open:
//
//   the verbs      twelve to look at, four to do — cut a branch, write a task,
//                  queue it, take it back out. See core/supervisor.js.
//   approving      no, and not as a filter decision: jobApprove and its
//                  siblings are simply not on the list. A supervisor writes a
//                  task under a job a PERSON approved.
//   landing        no. prCutMake and prCutLand are the two acts with
//                  consequences outside this host, and they are the natural
//                  next additions rather than part of the first one.

// BOTH WRITTEN NOW, and neither needed what the draft assumed it would.
//
//   "holds no repositories and gets no project setup" — checked in "what its
//   model may run", against the machine as it stands rather than by building a
//   new one: nothing cloned, and its own first-boot log saying the project half
//   was skipped. The second half matters — a machine that RAN the project setup
//   and happened to clone nothing would pass the first on its own.
//
//   "signed in as a supervisor, not as a worker" — checked in the credential
//   suite. The rule turned out to be about the PAIR rather than the sign-in: a
//   supervisor identity belongs on a supervisor machine and nowhere else, and a
//   worker's belongs on a runner. Refusing a supervisor sign-in outright, which
//   is what the draft implied, would have left the one machine that needs one
//   unable to have it.
// ---- WHAT IT SAW ----------------------------------------------------------
//
// 16 August 2026, on a host with four runners and no supervisor machine yet.
// Three passed, one could not be tried, four are drafts.
//
//     there is no supervisor machine on this host yet, so there is nothing
//     for the queue to skip
//     PASS a supervisor machine is one the queue never offers (1s)
//
//     runner4 refused the tag, and still carries none
//     PASS and the tag that makes it one cannot be typed on (0s)
//
//     SKIP and it cannot be typed off one that has it -> there is no
//     supervisor machine on this host to try untagging
//
//     a task asking for a supervisor is refused when it is written, not left
//     to wait
//     PASS and a task cannot ask to be run on one (0s)
//
// THE SKIP IS THE HONEST ANSWER AND NOT A GAP: the machine it needs is one
// somebody ticks a box to make, and this host has not made one yet. It turns
// into a pass the day one exists, which is the point of saying "could not be
// tried" rather than "passed".
//
// THE REFUSALS, IN THEIR OWN WORDS, because the sentence is the part that gets
// edited without anybody noticing:
//
//     "supervisor" is not a tag you can add. It is what keeps a machine out of
//     the task pool and it decides what gets installed at first boot, so it is
//     chosen when the machine is made — tick "supervisor machine" then, or make
//     another one.
//
//     A task cannot ask for a machine tagged "supervisor". Those are out of the
//     pool for good — a supervisor decides what work to give and is never given
//     any — so this task would sit queued for ever waiting for one.
//
// The second one arrived only after the check was written twice. The first
// version asked with no branch and was refused for having no branch; the second
// gave it a branch that had not been cut and was refused for that. Both are true
// and neither was about the tag — which is why `refuses` matches the sentence.
// taskCreate now refuses the impossible thing before the not-yet thing.
