'use strict'

// Open every tab and every pane, and say which ones did not come up.
//
// WHY THIS EXISTS, AND IT IS NOT A NICE-TO-HAVE. The Settings tab rendered
// nothing at all — a ReferenceError in the pane, thrown on every render, caught
// by React and left as a blank page — and `npm test` was green through the whole
// of it. Twenty-one checks, all passing, describing a tab that did not exist.
//
// Every check in test/ reads FILES. That is the right thing for the things they
// check, and it means none of them can see a pane that parses, builds, ships and
// then throws when it runs. The only thing that knows is the page.
//
// SO THIS ASKS THE PAGE. `show` puts a tab on screen and `windowControls` says
// what is there — both already exist, both are read-only, and between them they
// answer the one question the file checks cannot: did it come up.
//
// WHAT COUNTS AS FAILING.
//
//   the page did not answer      the driver timed out. Almost always a render
//                                that threw, because a thrown render leaves no
//                                page for it to talk to.
//   no controls, N chars          it answered and has content, just nothing to press
//   nothing on screen            it answered, and there is neither content nor control
//                                and no card. Sometimes correct — a pane can
//                                honestly have nothing yet — so this is
//                                reported rather than failed, and the person
//                                reading knows which panes are meant to be bare.
//
// NOT PART OF `npm test`, on purpose. It needs the app running, and a suite that
// silently passes when the app is down is worse than no suite: it would have
// been green for this bug too.

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const OKC = path.join(__dirname, 'okc.js')

// A NAME NOTHING COULD BE CALLED, used to make the app list what it does have.
// It was a leading space once, which is invisible in a diff and turned out to
// carry a NUL byte through an edit -- so the refusal that came back was node's
// complaint about the argument rather than the app's list, and the walk found
// no tabs while every tab was fine.
const NOPE = '__no_such_thing__'

// WHAT A FAILED RUN ACTUALLY SAID.
//
// Two traps, both hit on the first attempt. `execFileSync` puts the output on
// the thrown error as BUFFERS, and an empty Buffer is truthy — so
// `e.stdout || e.stderr` hands back the empty one and the refusal on stderr is
// never read. And a refusal here is not an error to this tool: it is the answer.
function said (e) {
  const bits = [e.stdout, e.stderr].map(b => (b && b.length ? String(b) : '')).filter(Boolean)
  return (bits.join(' ') || e.message || '').trim()
}

// The list out of a refusal like:
//   there is no tab called "x" — there is Repositories, Machines, ...
// THE LAST "there is", not the first. The first one is part of the complaint,
// and matching it returns the complaint as though it were the list.
function listedIn (text) {
  // THE LAST ONE, FOUND BY POSITION AND NOT BY MATCHING TWICE. A regex over the
  // line finds only the first: the character class is greedy, so the first
  // "there is" swallows the second along with everything after it, and what
  // comes back is the complaint -- which then reads as a tab named
  //   no tab called "x" - there is Repositories
  // Two "take the last match" attempts failed exactly that way before this.
  const mark = 'there is '
  const at = text.lastIndexOf(mark)
  if (at < 0) return []
  const tail = text.slice(at + mark.length).split(String.fromCharCode(10))[0].trim()
  // "there is none" and "there is no tab called" are both refusals with nothing
  // in them, and both start where a list would.
  if (/^none/.test(tail) || /^no /.test(tail)) return []
  return tail.split(',').map(s => s.trim()).filter(Boolean)
}

function okc (args) {
  const out = execFileSync(process.execPath, [OKC, ...args, '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    // STDERR IS CAPTURED, NOT PASSED THROUGH. Half the calls here are meant to
    // fail -- asking for a tab that cannot exist is how the list of real ones is
    // obtained -- so letting those refusals reach the terminal fills the report
    // with eleven complaints about a thing nobody asked for.
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return JSON.parse(out)
}

// LOOK UNTIL IT HAS STOPPED ARRIVING.
//
// Every pane asks for its data when it mounts, so a look taken straight after a
// switch catches the skeleton: no buttons, no fields, and a report of "nothing
// on screen" for a pane that is perfectly fine.
//
// TWO LOOKS WAS THE FIRST ATTEMPT AND IT WAS NOT ENOUGH. The Cuts pane asks
// GitHub about every cut it has and takes about sixteen seconds; Branches goes
// through the relay. So the count of bare panes wandered between runs — 8, 9,
// 11, 12, 10 — and none of those numbers meant anything.
//
// Which is this tool making the same mistake it exists to catch: "there is
// nothing here" and "nothing has arrived yet" are different answers, and only
// one of them is worth acting on. The app now SAYS which, by reporting whether a
// skeleton is on the screen, so this waits on a fact rather than on a guess.
function look (patience) {
  var seen = okc(['windowControls'])
  var tries = patience == null ? 40 : patience
  while (seen.loading && tries-- > 0) seen = okc(['windowControls'])
  return seen
}

function main () {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet')

  let where
  try {
    where = okc(['actions'])
  } catch (e) {
    console.error('no app is listening — start it with `npm start`')
    process.exit(3)
  }
  if (!where.actions.some(a => a.name === 'show')) {
    console.error('this app has no `show` action, so there is nothing to walk')
    process.exit(1)
  }

  // Which tabs and panes there are is not written down anywhere this can read —
  // a tab is a folder that registers itself. So it is asked for by asking for
  // one that does not exist: the refusal lists them all, which is a refusal
  // written to be useful rather than merely correct.
  let tabs = []
  try {
    okc(['show', '--tab', NOPE])
  } catch (e) {
    tabs = listedIn(said(e))
  }
  if (!tabs.length) {
    console.error('could not find out what tabs there are')
    process.exit(1)
  }

  const bad = []
  const bare = []
  const slow = []
  let walked = 0

  for (const tab of tabs) {
    okc(['show', '--tab', tab])

    // The panes of this tab, by the same trick.
    let panes = []
    try {
      okc(['show', '--tab', tab, '--pane', NOPE])
    } catch (e) {
      panes = listedIn(said(e))
    }

    const stops = panes.length ? panes.map(p => ({ tab, pane: p })) : [{ tab, pane: null }]

    for (const stop of stops) {
      const name = stop.tab + (stop.pane ? '/' + stop.pane : '')
      walked++
      try {
        okc(stop.pane ? ['show', '--tab', stop.tab, '--pane', stop.pane] : ['show', '--tab', stop.tab])
        const seen = look()

        const acts = (seen.buttons || []).filter(b => !b.nav)
        const anything = acts.length + (seen.fields || []).length

        // `on` COMES BACK FROM THE PAGE, so it is also the proof the page is
        // there at all. A thrown render answers nothing and this reads "?".
        if (!seen.on || seen.on === '?') {
          bad.push(`${name} — the page answered with no region, so nothing rendered`)
        } else if (seen.loading) {
          // Still arriving after every look this was willing to take. Not a
          // failure — some of these are genuinely slow — but not an answer
          // about the pane either, so it is neither counted as bare nor
          // reported as fine.
          slow.push(name)
          if (!quiet) console.log(`  ${name.padEnd(28)} still arriving`)
        } else if (!anything) {
          // NO CONTROLS IS NOT NO CONTENT, and conflating them is how this tool
          // reported "nothing on screen" for a pane that had just been
          // photographed full of libraries and chains. A reading pane has
          // nothing to press ON PURPOSE. Only a pane with neither is a fault,
          // and only that one is counted.
          const chars = seen.content || 0
          if (chars > 200) {
            if (!quiet) console.log(`  ${name.padEnd(28)} no controls, ${chars} chars of content`)
          } else {
            bare.push(name)
            if (!quiet) console.log(`  ${name.padEnd(28)} nothing on screen`)
          }
        } else if (!quiet) {
          console.log(`  ${name.padEnd(28)} ${acts.length} button(s), ${(seen.fields || []).length} field(s)`)
        }
      } catch (e) {
        const why = said(e).split('\n')[0]
        bad.push(`${name} — ${why}`)
        if (!quiet) console.log(`  ${name.padEnd(28)} FAILED: ${why}`)
      }
    }
  }

  console.log(`\nwalked ${walked}, ${bad.length} did not come up, ${bare.length} had nothing on screen`)

  if (bad.length) {
    console.error('\nthese did not come up:')
    for (const b of bad) console.error('  ' + b)
    console.error('\nA pane that throws while rendering leaves a blank page and no error anywhere a file check can see it.')
    process.exit(1)
  }
}

// EXIT 3 MEANS NOTHING IS LISTENING, WHEREVER IT HAPPENS.
//
// It was handled on the first call only, so a walk started a moment too early
// after a restart got past that check and then died on the next one with a
// stack trace — which says "this tool is broken" when what it means is "the app
// is not up yet". The friendly sentence already existed; it was just in the
// wrong number of places.
try {
  main()
} catch (e) {
  if (e && e.status === 3) {
    console.error('the app is not listening — start it with `npm start`, or it may still be coming up')
    process.exit(3)
  }
  throw e
}
