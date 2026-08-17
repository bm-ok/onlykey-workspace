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

const { it, draft, requires } = require('../../../tasks/harness')

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

draft('and the window cannot be driven while the drills are off',
  'THE REFUSAL: "The window is only driven while testing mode is on for this workspace." — actions/app.js. ' +
  'It matters more than it looks: windowClick and windowFill reach the SAME handlers a person\'s press reaches, so an unguarded one is a way around every refusal this app makes about the command line — approving a job, landing a change, switching the drills on. ' +
  'WHY IT IS NOT A CHECK HERE: a drill runs only while testing mode is on, which is exactly when this is allowed. Proving the refusal means turning testing mode OFF, which stops the drills. ' +
  'HOW TO WRITE IT: from outside the kit — a script that turns testing mode off at the window, calls windowClick over the wire, sees the refusal, and turns it back on. That is a person-driven drill rather than one the harness can run, and it belongs in the same family as the sign-in that needs somebody to visit a page. ' +
  'WHAT CAN BE CHECKED FROM HERE AND IS NOT YET: that a press driven from outside carries the mark — press an APPROVE button through windowClick and watch it refused for being over the wire. That proves the anti-bypass property without turning anything off. See drivenFromTheWire in ui/base.js.')

draft('and a change cannot be landed from outside the window while the drills are off',
  'THE REFUSAL: "Landing a cut from outside the window is only done while testing mode is on for this workspace… this is a model merging into somebody\'s repository, and that needs to have been said out loud first." — actions/repos.js. ' +
  'It is the one act in this app with consequences outside this host: everything before a merge is reversible from GitHub and a merge is not. ' +
  'WHY IT IS NOT A CHECK HERE: same as above — the drills run with testing mode on, which is the state in which this is permitted. ' +
  'THE CHECK, WHEN THERE IS A WAY TO WRITE IT: with testing mode off, prCutLand over the wire is refused and names the window; with it on, the refusal is not what stops it — a cut that is not ready still is. ' +
  'AND THE RELATED ONE WORTH HAVING EITHER WAY: a supervisor is refused prCutLand whatever testing mode says, because it is not on its list at all. That one IS checked — see the supervisor suite.')
