'use strict'

// The window's names, checked against the window.
//
// THIS IS THE ONE PLACE THAT FAILS SILENTLY. Everywhere else in this app a wrong
// name is an error: a missing module throws, a missing action is refused by
// name, a bad JSON key is visible in the output. A stylesheet is not like that.
// `className: 'picked'` when the stylesheet says `pick` produces NO error, NO
// warning, and a panel that renders -- just unstyled. That exact mistake shipped
// here and was found by a person saying "the tasks list is not selectable",
// which is the most expensive way available to discover a typo.
//
// The same is true of `$('term-tabs')` when the markup says `term-tab-strip`:
// that one does throw, but only when the code path runs, which for a panel
// behind a tab can be days later and somewhere unrelated.
//
// So: every class the window applies exists in the stylesheet, every custom
// property it reads is declared, and every id it looks up is in the markup.
// None of this needs a browser, which is why it can be a test rather than an
// opinion about a screenshot.

const fs = require('node:fs')
const path = require('node:path')

const UI = path.join(__dirname, '..', 'ui')

// EVERY SCRIPT IN ui/, not one named file. The window was one file and is now a
// list of them, and a check that reads only the file it was written against
// passes by looking at less and less of what it is meant to be checking -- which
// is the quietest way for a test to stop being one.
const scripts = fs.readdirSync(UI).filter(f => f.endsWith('.js')).sort()
const js = scripts.map(f => fs.readFileSync(path.join(UI, f), 'utf8')).join('\n')
const css = fs.readFileSync(path.join(UI, 'ui.css'), 'utf8')
const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8')

const set = (s, re, group = 1) => new Set([...s.matchAll(re)].map(m => m[group]))

// ---- what exists ------------------------------------------------------

const cssClasses = set(css, /\.([a-zA-Z][a-zA-Z0-9_-]*)/g)
const cssVars = set(css, /(--[a-zA-Z0-9-]+)\s*:/g)
// Declared in the markup, or built by the code. Both are real -- a panel that
// makes its own sub-element and then looks it up again is an ordinary thing to
// do, and a test that only read the markup would call every one of those a bug.
const htmlIds = new Set([
  ...set(html, /\bid="([^"]+)"/g),
  ...set(js, /\bid:\s*'([^']+)'/g)
])

// Applied by a third party rather than by this code. xterm writes its own class
// names into the element it is given, and its stylesheet -- vendored beside it --
// is what defines them.
const NOT_OURS = /^xterm/

// ---- what the window uses ---------------------------------------------

// `className: 'a b'` and `className: `a ${x} b``. The interpolated parts are
// dropped rather than guessed at: what a template produces is a runtime
// question, and a test that reports maybes gets ignored.
const classNames = new Set()
for (const m of js.matchAll(/className:\s*(['"])([^'"]*)\1/g)) {
  for (const c of m[2].split(/\s+/)) if (c) classNames.add(c)
}
for (const m of js.matchAll(/className:\s*`([^`]*)`/g)) {
  for (const c of m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (c) classNames.add(c)
}
for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\(\s*(['"`])([^'"`]+)\1/g)) {
  classNames.add(m[2])
}

const ids = set(js, /\$\(\s*'([^']+)'\s*\)/g)
const varsUsed = set(js + css, /var\((--[a-zA-Z0-9-]+)\)/g)

// ---- the three questions ----------------------------------------------

const unstyled = [...classNames].filter(c => !cssClasses.has(c) && !NOT_OURS.test(c)).sort()
const undeclared = [...varsUsed].filter(v => !cssVars.has(v)).sort()
const missing = [...ids].filter(i => !htmlIds.has(i)).sort()

for (const c of unstyled) console.error(`  NO SUCH CLASS       .${c}  — ui.js applies it, ui.css does not define it`)
for (const v of undeclared) console.error(`  NO SUCH PROPERTY    ${v}  — read with var(), never declared`)
for (const i of missing) console.error(`  NO SUCH ELEMENT     #${i}  — ui.js looks it up, index.html has no such id`)

console.log(`classes applied: ${classNames.size}, defined: ${cssClasses.size}`)
console.log(`custom properties read: ${varsUsed.size}, declared: ${cssVars.size}`)
console.log(`ids looked up: ${ids.size}, present in the markup: ${htmlIds.size}`)

if (unstyled.length || undeclared.length || missing.length) {
  console.error('\nA name in the window does not match what it names. None of these throw in a browser — a class that does not exist is simply not applied, which renders as a panel that looks nearly right.')
  process.exit(1)
}

console.log('PASS — every class, custom property and id the window uses exists.')
