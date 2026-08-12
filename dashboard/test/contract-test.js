'use strict'

// Test 1 from CONTRACT.md, as a thing that runs rather than a claim in a doc.
//
// It measures CODE, not comments. The last version's raw grep found 99 mentions
// of which only 47 were code -- the other 52 were comments recording history,
// which couple nothing and are worth keeping. A test that cannot tell those
// apart overstates the problem by more than double and gets ignored.

const fs = require('node:fs')
const path = require('node:path')

const BANNED = /onlykey|firmware|emulator|teensy|usb|udc|vbox|virtualbox|\brole\b/i
const CORE = path.join(__dirname, '..', 'core')

const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])

let bad = 0
let commentsAllowed = 0

for (const file of files(CORE).filter(f => f.endsWith('.js'))) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!BANNED.test(line)) return
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) { commentsAllowed++; return }
    console.error(`  LEAK ${path.relative(CORE, file)}:${i + 1}  ${line.trim()}`)
    bad++
  })
}

console.log(`core/ code mentions of a specific project: ${bad}`)
console.log(`comments recording why (allowed, couple nothing): ${commentsAllowed}`)

if (bad > 0) {
  console.error('\nFAIL — the core learned something about one project. Move it into an ecosystem file.')
  process.exit(1)
}
console.log('PASS — the core knows nothing about any particular project.')
