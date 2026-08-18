'use strict'

// changing its instructions — from the window, and never by the thing being held
//
// THE SKILL IS WHERE THE CONTROL LIVES. A supervisor wakes, reads its skill, and
// does what it says. So the file is not documentation about the supervisor; it
// is the supervisor's instructions, and everything about who may write it and
// what a written one has to contain is a question about control rather than
// about editing.
//
// WHO MAY NOT: the supervisor itself. That refusal is not in this action and
// deliberately so -- `skillSave` is simply not on the supervisor's allowlist, so
// it cannot call it at all. A second copy of the rule here would catch the wrong
// callers and read as though the allowlist were a formality. It is checked where
// it lives, in "what its model may run".
//
// WHO MAY: anything with a shell, because this is an ordinary file in a checkout
// and pretending otherwise protects nothing. `skillSave` used to refuse the
// command line, which left the real writer untouched and made the action useless
// to the one caller that could not reach around it.
//
// SO WHAT IS ACTUALLY WORTH REFUSING is narrower and more human: overwriting
// somebody mid-sentence, and writing a file the CLI will silently never load.
// Those two are what this asks about.
//
// IT WRITES THE REAL SKILL, ONCE, AND PUTS IT BACK. Every check but one is a
// refusal and touches nothing. The one that writes takes a copy first, and the
// cleanup at the bottom restores it whether the run finished or not -- a drill
// that leaves a supervisor with a drill's instructions is worse than no drill.

const { it, cleanup } = require('../../../tasks/harness')

const WHICH = 'supervisor'

// The smallest thing that is still a skill: the CLI needs a name and a
// description in frontmatter or it never loads the file at all.
const ENOUGH = [
  '---',
  'name: supervisor',
  'description: a drill wrote this and is about to put the real one back',
  '---',
  '',
  'If this is being read by a supervisor, a drill did not finish. The real',
  'instructions are in the checkout; restore them.'
].join('\n')

it('its instructions can be read, and they are a skill', async ({ okc, assert, state, log }) => {
  const one = await okc('skills', { which: WHICH })
  assert.ok(one.text && one.text.length > 100, `a supervisor skill of ${one.text ? one.text.length : 0} characters is not instructions`)
  assert.ok(/^---\s*\n/.test(one.text), 'it does not start with frontmatter, so the CLI would never load it')

  // KEPT FOR THE CLEANUP, and taken before anything below can write.
  state.was = one.text
  state.where = one.where
  log(`${one.characters} characters, ${one.lines} lines, at ${one.where}`)
}, { gate: true })

it('and a skill with no frontmatter is refused, because the CLI would ignore it', async ({ okc, assert, log }) => {
  // THE MOST EXPENSIVE FAILURE THIS APP CAN HAVE, and the quietest. A skill
  // without a name and a description is not loaded, the supervisor wakes with
  // the brief alone, and what that looks like from the outside is a model that
  // has stopped following its instructions. Somebody then spends a day reading
  // transcripts.
  const threw = await assert.refuses(() => okc('skillSave', { which: WHICH, text: 'this is advice, not a skill' }),
    'name:', 'a file with no frontmatter was accepted as a skill')
  const why = threw.message
  assert.ok(/description:/.test(why), `the refusal has to name both, and said: ${why}`)
  log(`refused, and named both: ${why.slice(0, 90)}...`)
})

it('and an empty one is refused rather than quietly disarming it', async ({ okc, assert, log }) => {
  // NOT THE SAME REFUSAL. Empty is the shape somebody reaches for when they mean
  // "stop using this", and it would work -- the supervisor would wake to nothing
  // at all. Refusing it makes disarming a supervisor something you do on purpose
  // in a checkout, rather than by clearing a text box.
  const threw = await assert.refuses(() => okc('skillSave', { which: WHICH, text: '   \n  \n' }),
    'nothing in it', 'a skill with nothing in it was written')
  log(`refused: ${threw.message.slice(0, 90)}...`)
})

it('and a save is refused while somebody has it open with unsaved edits', async ({ okc, assert, state, log }) => {
  // THE WINDOW SAYS SO, and only the window may: `skillHolding` refuses anything
  // over the wire or driven, because it is a statement about what is on
  // somebody's screen and nothing else can honestly make it.
  await okc('skillHolding', { which: WHICH, holding: true })
  state.holding = true

  const threw = await assert.refuses(() => okc('skillSave', { which: WHICH, text: ENOUGH }),
    'force', 'a save went through on top of somebody\'s unsaved edits')
  const why = threw.message

  // AND IT DID NOT WRITE. A refusal that half happened is worse than one that
  // did not: the point of this is that nothing was lost.
  const still = await okc('skills', { which: WHICH })
  assert.equal(still.text, state.was, 'the file changed despite the save being refused')

  log(`refused while held, and the file is untouched: ${why.slice(0, 80)}...`)
})

it('and force writes anyway, and says that it trampled something', async ({ okc, assert, state, log }) => {
  // FORCE IS NOT A WAY ROUND THE RULE, it is the answer to it: somebody decided,
  // on behalf of whoever was typing. So the one thing it must not do is go
  // through quietly. The window reloads from disk and says its edits were
  // dropped; this checks the half that makes that possible.
  const done = await okc('skillSave', { which: WHICH, text: ENOUGH, force: true })
  state.wrote = true
  assert.ok(done.saved, 'force did not write')
  assert.ok(done.forced, 'it wrote over unsaved edits and did not record that it had')

  const now = await okc('skills', { which: WHICH })
  assert.equal(now.text, ENOUGH, 'what is on disk is not what was forced over it')

  // AND THE HOLD IS GONE, because what was being held no longer exists. Leaving
  // it set would refuse every later save on behalf of edits nobody can recover.
  const again = await okc('skillSave', { which: WHICH, text: ENOUGH + '\n' })
  assert.ok(!again.forced, 'the hold survived the save that trampled it, so the next save is refused for edits that are already gone')

  log('forced over the hold, recorded as forced, and the hold cleared behind it')
})

it('and putting it back is an ordinary save', async ({ okc, assert, state, log }) => {
  // THE RESTORE, ASKED AS A CHECK rather than left to the cleanup alone. A
  // cleanup that fails is logged and fails nothing, which is right for tidying
  // up and wrong for this: the supervisor's instructions are the thing being
  // handled, and "it was put back" is worth a red line of its own.
  assert.needs(state.was, 'nothing was read at the start, so there is nothing to put back')
  await okc('skillSave', { which: WHICH, text: state.was })

  const now = await okc('skills', { which: WHICH })
  assert.equal(now.text, state.was, 'the real instructions are not back on disk')

  // AND SAVING THE SAME THING AGAIN WRITES NOTHING, which is what stops a
  // window that saves on a timer from filling the record with rewrites of the
  // same file.
  const nothing = await okc('skillSave', { which: WHICH, text: state.was })
  assert.ok(!nothing.saved, 'saving an identical file wrote it again')

  state.wrote = false
  log(`${state.was.length} characters restored, and an identical save wrote nothing`)
})

cleanup(async ({ okc, state, log }) => {
  // BELT AND BRACES. The check above is the one that reports; this is what runs
  // when the check above never got to.
  try { await okc('skillHolding', { which: WHICH, holding: false }) } catch { /* nothing was held */ }
  if (state.was && state.wrote) {
    try {
      await okc('skillSave', { which: WHICH, text: state.was, force: true })
      log('the real supervisor skill was put back by the cleanup')
    } catch (e) {
      log(`THE SUPERVISOR SKILL IS STILL A DRILL'S -- put it back from the checkout: ${e.message}`)
    }
  }
  state.was = null
  state.wrote = false
  state.holding = false
})
