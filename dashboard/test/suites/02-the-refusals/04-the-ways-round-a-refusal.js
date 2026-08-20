'use strict'

// the ways round a refusal — the guards that protect the other guards
//
// Most of what this app refuses is about the thing being asked for: a branch
// that does not exist, a machine that is not dialled in, a job nobody approved.
// These are different. They are the refusals that stop something UNDOING the
// others, and each one is the answer to "could a model simply arrange to be
// allowed?".
//
//   switching the drills on   turns this app into one that writes tasks and
//                             takes credentials off machines, against whatever
//                             folder happens to be open
//   answering the request      to do that, on its own behalf
//   driving the window         a press made from outside reaches the same
//                             handlers a person's press does, so an unmarked one
//                             would be a way around every refusal about the
//                             command line
//   landing a change           merging into somebody's repository, which is the
//                             one act with consequences outside this host
//
// FOUND BY READING test/claims.md, which crosses every `throw` in the app against
// every `assert.refuses` in the kit: 242 of 292 refusals were watched by nothing,
// and these four were among them. The catalogue half of the kit earning its keep
// — see the header of test/outline.md.
//
// AND WRITING THEM FOUND A HOLE. The harness calls the action table in process,
// exactly as the window does, so a drill asking to switch the drills on looked
// like somebody clicking a button. Both guards count a drill as the pipe now,
// which is what makes the two checks below honest rather than decorative.

const { it, draft, cleanup, requires } = require('../../../tasks/harness')

requires('what this host has')

it('the drills cannot be switched on by anything but a person at the window', async ({ okc, assert, log }) => {
  // THE MOST VALUABLE FLAG IN THIS APP TO FORGE. With the drills on, this app
  // will write a task, dispatch it, and take a credential off a machine —
  // against the folder open at that moment. That is a decision about somebody's
  // repository, and the whole design is that a person makes it while looking at
  // which folder is open.
  //
  // Asked as a drill, which is the point: a drill is not a person either, and it
  // reaches the same door the window does.
  const refusal = await assert.refuses(
    () => okc('settingSet', { name: 'testsEnabled', value: true }),
    'switched on in the window',
    'the drills were switched on by something other than a person at the window — a model could then decide for itself that somebody\'s repository is a fine place to run them')
  log(refusal.message.slice(0, 150))
})

it('and a request to run them cannot answer itself', async ({ okc, assert, log }) => {
  // THE OTHER HALF OF THE SAME DOOR. `testsAsk` exists so a model can raise its
  // hand and a person can answer in the window — and something that can answer
  // its own request has not asked for anything.
  const refusal = await assert.refuses(
    () => okc('testsAnswer', { allow: true }),
    'answered in the window',
    'a request to run the drills was answered by something that is not a person at the window')
  log(refusal.message.slice(0, 150))
})

it('and the settings that can be changed are named, not assumed', async ({ okc, assert, log }) => {
  // A SMALL ONE THAT KEEPS THE ONE ABOVE HONEST. `settingSet` refuses a name it
  // does not know rather than writing it — so a typo cannot create a setting that
  // some later `read()` treats as meaningful, and the guard above cannot be
  // sidestepped by writing `testsenabled` in a different case.
  await assert.refuses(
    () => okc('settingSet', { name: 'testsEnabledPlease', value: true }),
    'is not a setting',
    'this app accepted a setting it has never heard of, which is how a guard on one name gets walked around with another')
  log('a setting this app does not have is refused rather than written')
})

// ---- what cannot be checked from inside a run that needs the drills on ------
//
// Both of these are refused UNLESS testing mode is on, and a drill only runs when
// it is — so from in here they are permitted, correctly, and the refusal they
// carry cannot be reached. Written down rather than left as a gap somebody
// discovers by assuming they were covered.

it('a press driven from the command line is still the command line', async ({ actions, assert, log }) => {
  // THE ANTI-BYPASS PROPERTY, AND IT DID NOT HOLD.
  //
  // `windowClick` and `windowFill` reach the same handlers a person's press
  // reaches. The window marks those calls `_driven`; every approval refused
  // only `_overTheWire`, which a driven press is NOT, because it happens in
  // the window's own process. So the command line could approve a job, a
  // prompt or a contract by pressing the button — two clicks instead of one,
  // with nothing in the way but testing mode being on.
  //
  // Found by trying it: one windowClick opened the confirm dialog and stopped,
  // which looked like the guard working and was only the dialog. The guard
  // itself was not there.
  //
  // Checked on all three, because they are three separate lines of code that
  // happen to agree, and the next one added will be a fourth.
  for (const what of ['jobApprove', 'promptApprove', 'contractApprove']) {
    await assert.refuses(
      () => actions[what].run({ id: 'anything-at-all', _driven: true }),
      'window|person|command line',
      `${what} let a press driven from the command line through`
    )
  }

  // AND THE SAME FOR ALLOWING SOMEBODY ELSE'S CODE TO BE READ, which is the
  // newest approval here and had the identical hole, written the identical way.
  await assert.refuses(
    () => actions.prAllowJudging.run({ repo: 'local-repo-c', number: 1, _driven: true }),
    'window|person|may not',
    'a pull request could be allowed by driving the window'
  )
  log('four approvals, none of them reachable by driving the window')
})

// The prompt this drill writes and throws away. Named once: it is used by the
// check, by its assertions and by the cleanup, and three copies of a string is
// how a cleanup ends up tidying something that was never made.
const ID = 'drill-approve-me'

it('and the whole way round it, from outside, ends where it started', async ({ okc, assert, state, log }) => {
  // THE SAME PROPERTY AS THE CHECK ABOVE, WALKED RATHER THAN ASSERTED.
  //
  // That one calls `jobApprove({ _driven: true })` and watches it refused,
  // which proves the guard is there. It cannot prove the mark ARRIVES: if
  // `windowClick` never set `_driven`, that check would still pass and the
  // command line could approve anything by pressing the button. The guard and
  // the mark are two separate pieces of code and only one of them was checked.
  //
  // So this does what somebody trying it would do: write a prompt down the
  // pipe, drive the window to it, and press Approve.
  //
  // OVER THE WIRE ON PURPOSE. A prompt written at the window is approved by
  // the writing -- that IS the reading -- so a drill that saved one normally
  // would have nothing to press. `_overTheWire` is how a drill says "pretend
  // this came down the pipe", the same way the checks above say it.
  await okc('promptSave', {
    id: ID,
    name: 'drill: press approve on me',
    text: 'A drill wrote this over the wire so that there would be an Approve button to press. It is thrown away again below.',
    about: 'written by a drill, and removed by it',
    _overTheWire: true
  })
  state.prompt = ID

  const before = ((await okc('prompts')).prompts || []).find(p => p.id === ID)
  assert.ok(before && !before.approved, 'the prompt this is about was approved as it was written, so there is nothing here to press')

  // ---- drive the window to it ----------------------------------------
  await okc('windowClick', { text: 'Actions' })
  await okc('windowClick', { text: 'Prompts' })
  await okc('windowClick', { text: 'drill: press approve on me' })

  // AND THE WINDOW KNOWS IT IS BEING DRIVEN, which is the half that was never
  // checked. Everything below rests on this being true.
  const now = await okc('windowControls')
  assert.ok(now.driven, 'the window does not think it is being driven after three presses from out here — so nothing it does next carries the mark, and every approval guard that reads it is looking at the wrong thing')
  assert.ok((now.buttons || []).some(b => /approve/i.test(b.label)), `there is no Approve button on ${now.on}, so this proves nothing`)

  // ---- press it ------------------------------------------------------
  //
  // TWICE, AND THE FIRST ONE PROVES NOTHING. Approving asks a question first,
  // and the original hole was found by stopping here: one press opened the
  // dialog and went no further, which looks exactly like a guard working. It
  // was the dialog. A check that stopped here would have passed against an app
  // with no guard at all.
  const asked = await okc('windowClick', { text: 'Approve it' })
  assert.ok(asked.asking, `pressing Approve went straight through without asking anything — expected the confirm dialog, got ${JSON.stringify(asked.now)}`)

  await okc('windowClick', { text: 'I have read it' })

  // ---- and it is still not approved ----------------------------------
  //
  // THE REFUSAL LEAVES NO LINE IN THE LOG, so the evidence is the state: the
  // prompt is unapproved and the dialog is still open, because the action threw
  // rather than returning and nothing closed it.
  const after = ((await okc('prompts')).prompts || []).find(p => p.id === ID)
  assert.ok(after && !after.approved, `a press driven from the command line approved a prompt. That is the whole bypass: two clicks instead of one, and approved by ${after && after.approvedBy}`)

  const still = await okc('windowControls')
  assert.ok(still.dialog, 'the dialog closed, which is what happens when the approval went through — the check above should have caught that first')

  await okc('windowClick', { text: 'Never mind' })
  log('wrote a prompt down the pipe, drove the window to it, pressed Approve and confirmed — still unapproved')
})

cleanup(async ({ okc, state }) => {
  // The dialog first: a drill that leaves one open leaves every check after it
  // pressing buttons it cannot see past.
  await okc('windowClick', { text: 'Never mind' }).catch(() => { /* it is already shut */ })
  if (state.prompt) await okc('promptForget', { id: state.prompt }).catch(() => { /* it was never written */ })
  state.prompt = null
})

// ---- TWO DRAFTS DROPPED ON PURPOSE, 19 August 2026 -------------------------
//
// "the window cannot be driven while the drills are off" and "a change cannot
// be landed from outside the window while the drills are off". Both needed
// testing mode OFF, and the drills only run with it ON — so neither could ever
// be a check in this kit, and each sat in the draft list describing a test
// nobody was going to write here. A draft is a note about work that could
// happen; these were notes about work that could not.
//
// WHAT THEY GUARD IS STILL GUARDED, and the parts that CAN be checked are:
//
//   a supervisor is refused prCutLand whatever testing mode says, because it is
//   not on its list at all -- "one permission many gates" in this suite, and
//   the supervisor suite
//
//   the whole way round a refusal, from outside, ends where it started -- the
//   check below: a prompt written down the pipe, the window driven to it,
//   Approve pressed and confirmed, and the thing still unapproved
//
// AND THE UNCOMFORTABLE FACT IS WRITTEN DOWN RATHER THAN DRAFTED, in "one
// permission many gates": during a kit run, testing mode is on by definition,
// so nothing but the absence of a call stands between this kit and a real
// merge. That is worth knowing and is not a test.
