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
// WAITED IN SECONDS, NOT IN TRIES, and that is the fix.
//
// FORTY TRIES SOUNDED PATIENT AND WAS NOT. Each look is a subprocess, so forty
// of them is six or seven seconds — while the comment directly above says the
// Cuts pane takes about SIXTEEN. The three slowest panes in this app were
// therefore never once checked by this tool: Branches Cut, Protected and PR cuts
// came back "still arriving" every single run, and the summary counted them as
// walked.
//
// A COUNT IS A CLAIM. "walked 44, 0 did not come up" while four of them had not
// finished arriving is this tool making, again, exactly the mistake it exists to
// catch: a number that reads as coverage and is not.
//
// AND A DEADLINE SURVIVES A SLOW HOST. Tries measure how fast subprocesses
// spawn on this machine; a deadline measures the thing anybody actually cares
// about.
// AND IT PAUSES BETWEEN LOOKS, WHICH MATTERS MORE THAN THE DEADLINE DOES.
//
// This polled in a tight loop with no gap at all — a subprocess spawned and a
// round trip to the page, as fast as the machine could manage, for as long as
// the pane said it was loading. So the tool waiting for a pane to finish was
// competing for the CPU with the pane it was waiting for, and asking it to
// describe itself several times a second while it tried to fetch its data.
//
// THAT IS WHY THE SLOW PANES WERE ALWAYS THE SLOW ONES. Branches Cut, Protected
// and PR cuts are the three that reach furthest for their data, so they are the
// three this hammered hardest and the three it gave up on — a measurement that
// changed what it measured, and then reported the result as a fact about the
// app.
//
// Simply raising the deadline would have made that worse: the same tight loop,
// running five times longer. The gap is the fix; the deadline only decides when
// to stop.
var HOW_LONG = Number(process.env.OKC_WALK_PATIENCE || 30000)
var BETWEEN = 400

// A SYNCHRONOUS PAUSE, because everything in this file is synchronous — `okc`
// shells out and blocks, and the walk reads top to bottom. Atomics.wait on a
// buffer nothing will ever notify is the way to hold a thread still without
// spinning it.
function pause (ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function look (patience) {
  var until = Date.now() + (patience == null ? HOW_LONG : patience)
  var seen = okc(['windowControls'])
  while (seen.loading && Date.now() < until) {
    pause(BETWEEN)
    seen = okc(['windowControls'])
  }
  return seen
}

function main () {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet')

  // ---- WALKING ONE THING, WHICH IS MOST OF WHAT THIS IS FOR ---------------
  //
  // A full walk is forty-seven panes and several minutes, and the usual reason
  // to run one is a change to ONE of them. So anything that is not a flag is a
  // pattern, matched against `Tab` and `Tab/Pane`, case-insensitively, as a
  // substring:
  //
  //     npm run walk -- protected          the pane, wherever it lives
  //     npm run walk -- repositories       the tab, every pane in it
  //     npm run walk -- tasks/jobs judge   more than one, any of them
  //
  // TABS ARE STILL ENTERED TO FIND OUT WHAT IS IN THEM — a pane is not listed
  // anywhere this can read until its tab is on screen — but a tab that cannot
  // match anything is left after one look rather than walked through.
  //
  // AND THE SUMMARY SAYS IT WAS NARROWED. A count that came from a filter and
  // reads like a count of everything is the same fault as the one that let four
  // panes go unchecked; see `slow`.
  const only = args.filter(a => !a.startsWith('--')).map(a => a.toLowerCase())
  const wanted = (tab, pane) => {
    if (!only.length) return true
    const full = (tab + (pane ? '/' + pane : '')).toLowerCase()
    return only.some(w => full.includes(w))
  }
  // A tab is worth entering if it might hold something wanted.
  //
  //   `protected`               no slash, so it could name a pane in ANY tab
  //   `repositories/protected`  names the tab, so only that tab is opened
  //
  // THIS WAS A TERNARY THAT COULD NOT SAY NO. `a || b ? c : true` binds as
  // `(a || b) ? c : true`, so a pattern matching neither fell to `true` and
  // every tab was opened — which, together with the filter below never being
  // called at all, is why `npm run walk -- protected` walked all forty-seven
  // and reported "(only protected)" over the top of it.
  const worthOpening = (tab) => {
    if (!only.length) return true
    const t = tab.toLowerCase()
    return only.some(w => (w.includes('/') ? t.includes(w.split('/')[0]) : true) || t.includes(w))
  }

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
  const broke = []
  const slow = []
  let walked = 0

  for (const tab of tabs) {
    // NARROWED BEFORE THE TAB IS EVEN OPENED, which is most of what makes a
    // targeted walk quick — and is the half that was written and then never
    // wired to anything.
    if (!worthOpening(tab)) continue

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
      if (!wanted(stop.tab, stop.pane)) continue
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
        } else if (seen.broke) {
          // A PANE THAT CRASHED IS NOT A PANE THAT CAME UP, and until now this
          // tool could not tell the difference. The error boundary renders TEXT,
          // so `content` counted it and every check below was satisfied by the
          // message saying the pane was broken -- 44 of 44 reported fine while
          // one had blown up the moment anything was selected in it.
          //
          // CHECKED FIRST, because a crashed pane has both content and controls
          // and would otherwise be caught by whichever branch matched first.
          broke.push(`${name} — ${seen.broke}`)
          if (!quiet) console.log(`  ${name.padEnd(28)} CRASHED: ${seen.broke}`)
        } else if (!anything) {
          // NO CONTROLS IS NOT NO CONTENT, and conflating them is how this tool
          // reported "nothing on screen" for a pane that had just been
          // photographed full of libraries and chains. A reading pane has
          // nothing to press ON PURPOSE. Only a pane with neither is a fault,
          // and only that one is counted.
          // ANYTHING AT ALL COUNTS, and the threshold that used to sit here was
          // a guess. "Nothing has moved on both sides" plus an empty state is
          // 183 characters, and a pane that says its answer briefly is not a
          // broken one -- it was reported as "nothing on screen" purely for
          // being concise. Only a pane that rendered literally nothing is a
          // fault, and now that no pane fakes a loading state with the word
          // "asking" there is nothing left for a threshold to filter out.
          const chars = seen.content || 0
          if (chars > 0) {
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

  // THE SUMMARY SAYS EVERYTHING THE WALK DID NOT SETTLE, or it is not a summary.
  // `slow` was left out of this line, so a pane this tool gave up on was reported
  // once in the body and then quietly absent from the count — which reads as
  // "checked and fine" to anybody scanning the last line, which is everybody.
  // AND IT SAYS WHEN IT WAS NARROWED, always. A count that came from a filter
  // and reads like a count of everything is the same fault as the one that let
  // four panes go unchecked while this line called them walked.
  console.log(`\nwalked ${walked}${only.length ? ' (only ' + only.join(', ') + ')' : ''}, ${bad.length} did not come up, ${broke.length} crashed, ${bare.length} had nothing on screen`
    + (slow.length ? `, ${slow.length} NEVER FINISHED LOADING and were not checked` : ''))

  if (slow.length) {
    console.error(`\nthese were still arriving after ${Math.round(HOW_LONG / 1000)}s, so nothing above is a statement about them:`)
    for (const n of slow) console.error('  ' + n)
    console.error('give it longer with OKC_WALK_PATIENCE=60000, or find out why they are slow')
  }

  //A CRASH EXITS NON-ZERO, like a pane that did not come up at all. It used to
  //be invisible: the boundary's own message satisfied every check this tool
  //had, so a pane that blew up counted towards "44 of 44 fine".
  if (broke.length) {
    console.error('\nthese crashed while rendering:')
    for (const b of broke) console.error('  ' + b)
    console.error('\nThe pane is caught by its boundary, so the window stays up and the message is on screen where the pane was.')
  }

  if (bad.length || broke.length) {
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
