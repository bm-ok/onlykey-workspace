'use strict'

// This app is meant to be generic, so that is checked rather than trusted.
//
// Two rules:
//
//   1. Nothing anywhere knows about a particular project. Provisioning scripts
//      included -- they are the most tempting place to bake something in, because
//      they are where the real work of a machine gets described.
//   2. Only machines/ talks to the VirtualBox command line. Naming VirtualBox is
//      fine and often necessary -- the server wires machines/ up, and the window
//      has to be able to tell a person it was not found. What must not spread is
//      DRIVING it: the moment a second place shells out to VBoxManage there are
//      two opinions about VM state, and they will disagree.
//
// Both measure CODE, not comments. A comment recording why a mistake is a mistake
// couples nothing and is worth keeping; a test that cannot tell the difference
// gets ignored, and an ignored test protects nothing.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const PROJECT = /onlykey|firmware|emulator|teensy|\bhalfkay\b/i
const VBOX = /vboxmanage/i

// Where to look, and where not to. node_modules is somebody else's code and
// state/ is whatever happened to be produced at runtime.
const SKIP = new Set(['node_modules', 'state', '.git'])

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (SKIP.has(e.name)) return []
  const full = path.join(dir, e.name)
  return e.isDirectory() ? walk(full) : [full]
})

const isComment = line => /^\s*(\/\/|\*|\/\*|#)/.test(line)

const files = walk(ROOT).filter(f => /\.(js|sh)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`))

let leaks = 0
let spread = 0
let comments = 0

for (const file of files) {
  const where = path.relative(ROOT, file).split(path.sep).join('/')
  const inMachines = where.startsWith('machines/')

  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const project = PROJECT.test(line)
    const vboxOutside = !inMachines && VBOX.test(line)
    if (!project && !vboxOutside) return

    if (isComment(line)) { comments++; return }

    if (project) {
      console.error(`  KNOWS A PROJECT     ${where}:${i + 1}  ${line.trim().slice(0, 90)}`)
      leaks++
    }
    if (vboxOutside) {
      console.error(`  DRIVES VBOXMANAGE   ${where}:${i + 1}  ${line.trim().slice(0, 90)}`)
      spread++
    }
  })
}

console.log(`files checked: ${files.length}`)
console.log(`code that knows about one project: ${leaks}`)
console.log(`code outside machines/ driving VBoxManage: ${spread}`)
console.log(`comments recording why (allowed, couple nothing): ${comments}`)

if (leaks) console.error('\nSomething learned about one project. It belongs in a swappable script or a machine\'s own spec.')
if (spread) console.error('\nSomething outside machines/ drives VBoxManage. Two places driving it means two opinions about VM state.')
if (leaks || spread) process.exit(1)

console.log('PASS — generic, and only machines/ drives VBoxManage.')
