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
//   ...and the folder          which is HALF OF THE SAME PERMISSION and was not
//                             watched here until 20 August 2026. See the block
//                             above that check: the switch was guarded, the
//                             folder it points at was not, and moving the folder
//                             arms the drills without naming the guarded key
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

const { it, draft, cleanup, requires } = require('../../harness')

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

// ---------------------------------------------------------------------------
// AND THE OTHER HALF OF THE SAME PERMISSION, which this suite did not watch.
//
// The drills are allowed when `testsEnabled` AND `testsFor` is the folder open
// now. Two settings, both writable through `settingSet`, and only the switch was
// refused — so the way round the check above was to not touch it. Leave
// `testsEnabled` alone, which is very often already true (turned on last week
// against the scaffolding, never turned off), and write `testsFor` to whatever
// is open. The guarded key is never named, nothing refuses, and `testsAllowed`
// comes back true against somebody's real work.
//
// THAT IS THE EXACT STATE `testsFor` EXISTS TO MAKE SAFE. "On, for a folder that
// is not the one open" is the whole reason the second field is there, defeated
// by the setter for the second field.
//
// The same shape as 05-one-permission-many-gates.js in this folder: one
// permission, more than one gate, taught one at a time. Found on 20 August 2026
// while porting core/settings.js, after the check above had been passing for
// weeks with the door beside it standing open.
// ---------------------------------------------------------------------------
it('and the folder they are on for is part of the same door', async ({ okc, assert, log }) => {
  const before = (await okc('settings')).settings

  const refusal = await assert.refuses(
    () => okc('settingSet', { name: 'testsFor', value: 'c:\\somebody\\real-work' }),
    'other half of that same permission',
    'the folder the drills are armed against was moved by something other than a person at the window — which arms them without the guarded switch ever being touched')

  // THE REFUSAL HAS TO COME BEFORE THE WRITE. A guard that throws afterwards is
  // one that reports a refusal and does the thing anyway.
  const after = (await okc('settings')).settings
  assert.equal(after.testsFor, before.testsFor,
    'the folder moved anyway — the refusal was raised after it had already been written')
  assert.equal(after.testsEnabled, before.testsEnabled, 'the switch moved as well')

  log(refusal.message.slice(0, 150))
})

it('and a request to run them cannot be forged, only asked for', async ({ okc, assert, log }) => {
  // SMALLER, AND NOT NOTHING. A raised hand changes no permission by itself —
  // but it is a sentence that appears in a dialog somebody is about to read and
  // trust, attributed to a request that was never made. `testsAsk` is the door:
  // it takes a reason and stamps the folder itself.
  await assert.refuses(
    () => okc('settingSet', { name: 'testsAsked', value: 'anything at all' }),
    'other half of that same permission',
    'a standing request to run the drills was written directly, so the question a person answers can be put there by the thing asking')
  log('a request is raised with testsAsk, which takes a reason and stamps the folder itself')
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

// ---------------------------------------------------------------------------
// AND THE OTHER PERMISSION IN THAT FILE, which is not about the drills at all.
//
// WHOSE WORDS FROM GITHUB MAY BE READ AS A REQUEST. It does not open a door, it
// opens a CHANNEL: text written on somebody else's service, arriving here as
// something this host acts on. A caller able to write the list could name an
// account it controls, open an issue on it, and commission its own work through
// a door nobody watched it open.
//
// TWO KEYS AND BOTH ARE THE PERMISSION, which is the mistake this suite already
// caught once with `testsEnabled` and `testsFor`. Guarding the people and
// leaving the word is the same shape of hole: the word is applied to text that
// ALREADY EXISTS, so setting it to something a trusted person writes habitually
// turns their old comments into requests without anybody writing anything new.

it('and whose words from GitHub count cannot be decided down the pipe', async ({ okc, assert, log }) => {
  const before = await okc('settings')

  const refusal = await assert.refuses(
    () => okc('settingSet', { name: 'githubTrusted', value: ['an-account-i-control'] }),
    'opens a channel from the internet',
    'a name was added to the trusted list by something that is not a person at the window — which is a model granting itself an input from the internet')
  log(refusal.message.slice(0, 150))

  // AND THE LIST DID NOT MOVE. The refusal is the message; this is whether it
  // was thrown before the write or after it.
  const after = await okc('settings')
  assert.equal(
    JSON.stringify(after.settings.githubTrusted),
    JSON.stringify(before.settings.githubTrusted),
    'the list changed anyway, so the sentence was an apology rather than a refusal')
})

it('and neither can the word that makes them a request', async ({ okc, assert, log }) => {
  // THE HALF THAT LOOKS HARMLESS. A marker on its own trusts nobody, so guarding
  // it reads as ceremony until you notice what it is applied to.
  const before = await okc('settings')

  const refusal = await assert.refuses(
    () => okc('settingSet', { name: 'githubMarker', value: 'Update' }),
    'applied to text that already exists',
    'the marker was set by something other than a person, so every "Update: ..." a trusted person ever wrote becomes a request')
  log(refusal.message.slice(0, 150))

  const after = await okc('settings')
  assert.equal(after.settings.githubMarker, before.settings.githubMarker,
    'the marker changed anyway, so the sentence was an apology rather than a refusal')
})

it('and nor can the switch that posts a review unread', async ({ okc, assert, log }) => {
  // A REVIEW IS A VERDICT ON SOMEBODY ELSE'S PULL REQUEST, posted under this
  // host's token -- an APPROVE from here is this host's owner approving, and a
  // maintainer may merge on it. A caller able to turn this on could approve its
  // own reading by removing the person who reads it first.
  const before = await okc('settings')
  const refusal = await assert.refuses(
    () => okc('settingSet', { name: 'githubReviewDirect', value: true }),
    'approve its own reading',
    'the switch that posts a judge\'s review unread was set by something other than a person at the window')
  log(refusal.message.slice(0, 150))
  const after = await okc('settings')
  assert.equal(after.settings.githubReviewDirect, before.settings.githubReviewDirect,
    'the switch moved anyway, so the sentence was an apology rather than a refusal')
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

it('a press driven from the command line is still the command line', async ({ okc, assert, log }) => {
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
      () => okc(what, { id: 'anything-at-all', _driven: true }),
      'window|person|command line',
      `${what} let a press driven from the command line through`
    )
  }

  // AND THE SAME FOR ALLOWING SOMEBODY ELSE'S CODE TO BE READ, which is the
  // newest approval here and had the identical hole, written the identical way.
  await assert.refuses(
    () => okc('prAllowJudging', { repo: 'local-repo-c', number: 1, _driven: true }),
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
  //THE TAB IS `Worker` HERE, NOT `Actions`. Over there one library serves
  //workers and judges under a tab of that name; here it is split in two, and a
  //prompt saved with no `kind` is a task one -- so this is the half it lands in.
  await okc('windowClick', { text: 'Worker' })
  await okc('windowClick', { text: 'Prompts' })
  await okc('windowClick', { text: 'drill: press approve on me' })

  // AND THE WINDOW KNOWS IT IS BEING DRIVEN, which is the half that was never
  // checked. Everything below rests on this being true.
  const now = await okc('windowControls')
  assert.ok(now.driven, 'the window does not think it is being driven after three presses from out here — so nothing it does next carries the mark, and every approval guard that reads it is looking at the wrong thing')
  assert.ok((now.buttons || []).some(b => /approve/i.test(b.label)), `there is no Approve button on ${now.on}, so this proves nothing`)

  // ---- press it ------------------------------------------------------
  //
  // AND THIS IS WHERE THIS APP ANSWERS DIFFERENTLY FROM THE ONE IT WAS PORTED
  // FROM, so the check says which answer it is watching for.
  //
  // Over there a driven press is ALLOWED — "testing the approve button means
  // being able to press it" — and the mark set above is what refuses it at the
  // far end. So the walk there is: press, confirm, and find it still
  // unapproved.
  //
  // HERE THE DRIVER REFUSES THE PRESS ITSELF. core/drive will not click a
  // button marked protected at all, so the walk stops one step earlier and the
  // approval is never reached. That is the stronger of the two: nothing is
  // pressed, so nothing depends on what the far end does with the mark.
  //
  // BOTH GUARDS ARE STILL CHECKED, and that is the point of keeping this walk
  // rather than deleting it. The refusal below is the driver's; the check above
  // proved the MARK arrives, and the check before that proved the ACTION
  // refuses a call carrying it. Two pieces of code, each able to fail on its
  // own, each watched separately.
  //
  // THE DRIVER'S REFUSAL IS NOT ENOUGH BY ITSELF, which is why the other two
  // matter: it can only see a button the theme painted. A pane that builds its
  // own control is one the mark is invisible on, and then the far end is all
  // there is.
  const refusedPress = await assert.refuses(
    () => okc('windowClick', { text: 'Approve it' }),
    'protected|persons press|a person',
    'the window let a driven press land on Approve — over there that is allowed and the action refuses it, but here the driver is the guard and it just opened')

  // ---- and it is still not approved ----------------------------------
  //
  // THE EVIDENCE IS THE STATE, not the absence of a line in the log. Nothing
  // was pressed, so nothing wrote anything either way.
  const after = ((await okc('prompts')).prompts || []).find(p => p.id === ID)
  assert.ok(after && !after.approved, `a press driven from the command line approved a prompt. That is the whole bypass, and it did not even need the confirm dialog — approved by ${after && after.approvedBy}`)

  log(`wrote a prompt down the pipe, drove the window to it, and the press was refused:
${refusedPress.message.slice(0, 120)}`)
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
