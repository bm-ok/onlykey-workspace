'use strict'

// The two bans in CONTRACT.md, as things that run rather than claims in a doc.
//
// Both measure CODE, not comments. A comment recording why a mistake is a mistake
// couples nothing and is worth keeping; a test that cannot tell the difference
// gets ignored, and an ignored test protects nothing.

const fs = require('node:fs')
const path = require('node:path')

const CORE = path.join(__dirname, '..', 'core')

// 1. The core may know nothing about any particular project. `machines/` is
//    exempt by design: a virtual machine is not a project-specific concept, and
//    keeping VM lifecycle out of the LOOP was the point, not banning the word.
const PROJECT = /onlykey|firmware|emulator|teensy|usb|udc|vbox|virtualbox|\brole\b/i

// 2. Nothing rewrites history. The HEAD rule is the whole of what replaced the
//    branch, so it is worth more than a promise. `reset --soft HEAD~1` is the one
//    permitted form, used to undo a commit this same action just made.
const REWRITE = /\brevert\b|--amend|filter-branch|push[^\n]*--force|--force[^\n]*push/
const RESET_OK = /reset', '--soft', 'HEAD~1'|reset', '--hard', 'HEAD'\]/

const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])

const isComment = line => /^\s*(\/\/|\*|\/\*)/.test(line)

let leaks = 0
let rewrites = 0
let comments = 0

for (const file of files(CORE).filter(f => f.endsWith('.js'))) {
  const where = path.relative(CORE, file)
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const hitProject = PROJECT.test(line)
    const hitRewrite = REWRITE.test(line)
    const hitReset = /reset'/.test(line) && !RESET_OK.test(line)

    if (!hitProject && !hitRewrite && !hitReset) return
    if (isComment(line)) { comments++; return }

    if (hitProject) { console.error(`  PROJECT LEAK  ${where}:${i + 1}  ${line.trim()}`); leaks++ }
    if (hitRewrite) { console.error(`  REWRITES HISTORY  ${where}:${i + 1}  ${line.trim()}`); rewrites++ }
    if (hitReset) { console.error(`  UNAPPROVED RESET  ${where}:${i + 1}  ${line.trim()}`); rewrites++ }
  })
}

console.log(`core/ code that knows about one project: ${leaks}`)
console.log(`core/ code that rewrites history: ${rewrites}`)
console.log(`comments recording why (allowed, couple nothing): ${comments}`)

if (leaks) console.error('\nThe core learned something about one project. Move it into an ecosystem file.')
if (rewrites) console.error('\nSomething rewrites history. See CONTRACT.md, "Isolation" — that rule is what replaced the branch.')
if (leaks || rewrites) process.exit(1)

console.log('PASS — the core knows nothing about any project, and rewrites nothing.')
