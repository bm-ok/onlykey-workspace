'use strict'

// What the kept record may and may not hold.
//
// The live log stays in memory because command output carries sign-in URLs and
// tokens (see core/log.js). core/events.js is the durable half, and it only gets
// to exist on two conditions: an allowlist of acts, and redaction at the
// boundary. Both are checked here, against the real sentences this app writes —
// including the one that would have leaked, which was found by reading rather
// than by being caught.
//
// A guard is not a guard until something has been refused by it.

const events = require('../core/events')

let bad = 0
const check = (what, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want
  if (!ok) {
    bad++
    console.log(`  FAIL  ${what}`)
    console.log(`        got: ${JSON.stringify(got)}`)
  }
}

// ---- what is kept at all ------------------------------------------------

const entry = (tags, level = 'info') => ({ at: '2026-01-01T00:00:00.000Z', level, tags, text: 'x' })

check('an act is kept', events.worthKeeping(entry(['task'])), true)
check('a machine act is kept', events.worthKeeping(entry(['vm', 'runner1'])), true)
check('command output is not', events.worthKeeping(entry(['vm', 'runner1'], 'out')), false)
// A guest is a machine talking, and it says whatever a worker printed.
check('anything a guest said is not', events.worthKeeping(entry(['vm', 'runner1', 'guest'])), false)
check('which tab you are on is not', events.worthKeeping(entry(['window'])), false)
check('a screenshot is not', events.worthKeeping(entry(['capture'])), false)
check('an unknown tag is not', events.worthKeeping(entry(['something-new'])), false)

// ---- what may not survive inside one ------------------------------------

// THE ONE THAT WOULD HAVE LEAKED. actions/credentials.js writes this under the
// `vm` tag, which is kept.
const signIn = events.scrub('runner1 is waiting to be signed in — open https://claude.ai/oauth/authorize?code=abc123XYZ&state=zz')
check('a sign-in URL keeps only its host', signIn, s => !s.includes('authorize') && !s.includes('abc123XYZ'))
check('and says where it went', signIn, s => s.includes('claude.ai'))

// How a machine's token rides in a git remote.
const remote = events.scrub('cloning https://runner1:9f2b1c8e4a7d@192.168.1.5:7373/git/local-repo-a')
check('a credential in a URL goes', remote, s => !s.includes('9f2b1c8e4a7d'))

// Tokens get pasted into sentences by lines nobody has checked yet.
check('a long random string goes', events.scrub('kept sk-ant-oat01-AAAABBBBCCCCDDDDEEEEFFFFGGGG'),
  s => !s.includes('AAAABBBBCCCCDDDDEEEEFFFFGGGG'))
check('anything naming itself goes', events.scrub('token: hunter2'), s => !s.includes('hunter2'))

// And the ordinary sentence survives intact, or this is a shredder rather than a
// record.
check('an ordinary line is untouched',
  events.scrub('cut "job/test1" in local-repo-a from master — proving a thing'),
  'cut "job/test1" in local-repo-a from master — proving a thing')
check('a task line is untouched',
  events.scrub('#34 "code checking time" written, delivering on inspection/check1'),
  '#34 "code checking time" written, delivering on inspection/check1')

// THE DENY LIST FIRES, which it did not for as long as it had been written down.
//
// Every one of these also carries a tag that IS kept — a channel line is tagged
// `vm` — so an allowlist checked first let all of them through, and the record
// filled with a poll: 89 of 400 entries were one machine being asked for its runs
// every thirteen seconds. A record that keeps the heartbeat and loses the acts is
// worse than no record, because it is believed.
check('a command sent down the channel is not an act',
  events.worthKeeping({ level: 'info', tags: ['vm', 'runner2', 'channel'], text: 'running on runner2: reading its runs' }), false)
check('a socket coming and going is not an act',
  events.worthKeeping({ level: 'info', tags: ['vm', 'runner2', 'channel'], text: 'runner2 dialled in from 192.168.51.60' }), false)
check('which tab somebody is on is not an act',
  events.worthKeeping({ level: 'good', tags: ['window'], text: 'window opened — nw.js' }), false)

// And the acts those tags travel beside are still kept, or this is a mute button.
check('a machine being made is an act',
  events.worthKeeping({ level: 'good', tags: ['vm', 'runner1'], text: 'runner1 created' }), true)
check('the queue putting a task back is an act',
  events.worthKeeping({ level: 'good', tags: ['queue', 'runner2'], text: 'it dialled back in still holding #35' }), true)

if (bad) {
  console.log(`\nFAIL — ${bad} thing(s) the kept record gets wrong. It is written to disk, so this matters.`)
  process.exit(1)
}
console.log('PASS — the kept record holds acts, and holds no credentials.')
