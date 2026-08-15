'use strict'

// Every bare identifier a file uses that nothing declares.
//
// THIS HAS SHIPPED THREE TIMES AND `node --check` PASSED EVERY TIME. A bare
// identifier is valid syntax; it fails when its line is evaluated, which here
// has meant inside an action, inside a queue, on a machine that had already
// booted -- or inside a `.then` in the window, where it is swallowed by the
// catch and shows up as a panel that quietly stopped repainting.
//
//   files   dropped by the server split. The artifact endpoint hung with no
//           response: a ReferenceError in a request handler leaves the socket
//           open
//   port    dropped by the same split, four times in one file. vmWorkspace threw
//           for every task whose branch existed -- and in runs.js the same name
//           was inside a try/catch, so `base` stayed null and no guest was ever
//           told where to hand an artifact back
//   mine    left behind when a checkbox was removed. The branch list stopped
//           painting while its counts kept updating, so the screen said "0 in
//           all" above a row that was still there
//
// All three are the same shape: something was removed or moved, and a name that
// used to be in scope was left behind. That is what this looks for.
//
// TWO KINDS OF FILE, and the difference matters. Under actions/, tasks/ and the
// rest, each file is a module with its own scope. Under ui/, every file is a
// classic script sharing ONE global scope on purpose -- see ui/load.js -- so a
// name declared in base.js is legitimately used in tasks.js, and checking those
// per file would report hundreds of names that are perfectly fine.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

const GLOBALS = new Set([
  'require', 'module', 'exports', 'process', 'console', 'Buffer', 'JSON', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Math', 'Date', 'Promise', 'Error', 'Map', 'Set', 'WeakMap',
  'RegExp', 'URL', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  '__dirname', '__filename', 'globalThis', 'TextEncoder', 'TextDecoder', 'AbortController',
  'queueMicrotask', 'structuredClone', 'Symbol', 'Intl', 'isNaN', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'fetch',
  'typeof', 'new', 'return', 'await', 'async', 'function', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'in', 'of',
  'instanceof', 'delete', 'void', 'yield', 'class', 'extends', 'super', 'static', 'this',
  // The window's own surroundings: a browser, and what NW.js adds to it.
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'alert',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'nw', 'ace', 'marked',
  'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'Image', 'Blob', 'FileReader',
  'DOMParser', 'MutationObserver', 'ResizeObserver', 'Terminal', 'FitAddon', 'performance'
])

// Everything that is CODE, with comments, strings and template text blanked to
// spaces -- but keeping `${...}`, which is code and is exactly where two of the
// three bugs above were hiding.
//
// A scan rather than regexes because what is being removed nests: these files
// carry template literals holding shell scripts holding their own comments in
// English. A regex that removed templates would remove the evidence; one that
// kept them read a shell script as JavaScript.
function codeOnly (src) {
  const out = new Array(src.length).fill(' ')
  const keep = i => { out[i] = src[i] }

  const regexCanStart = i => {
    for (let j = i - 1; j >= 0; j--) {
      const c = src[j]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue
      return !/[\w$)\]]/.test(c)
    }
    return true
  }

  const stack = []
  let i = 0
  while (i < src.length) {
    const top = stack[stack.length - 1]
    const c = src[i]
    const next = src[i + 1]

    if (top === 'line') {
      if (c === '\n') { stack.pop(); keep(i) }
      i++
      continue
    }
    if (top === 'block') {
      if (c === '*' && next === '/') { stack.pop(); i += 2; continue }
      if (c === '\n') keep(i)
      i++
      continue
    }
    if (top === "'" || top === '"') {
      if (c === '\\') { i += 2; continue }
      if (c === top) { stack.pop(); keep(i) }
      i++
      continue
    }
    if (top === '`') {
      if (c === '\\') { i += 2; continue }
      if (c === '$' && next === '{') { stack.push('${'); keep(i); keep(i + 1); i += 2; continue }
      if (c === '`') { stack.pop(); keep(i); i++; continue }
      if (c === '\n') keep(i)
      i++
      continue
    }
    if (top === 'regex') {
      if (c === '\\') { i += 2; continue }
      if (c === '[') { stack.push('class'); i++; continue }
      if (c === '/') {
        stack.pop()
        keep(i)
        i++
        // The flags belong to the literal. Without this `/^HTTP/mi` leaves `mi`
        // looking like an identifier -- the exact shape of the bug this file
        // exists to find, reported about itself.
        while (i < src.length && /[a-z]/.test(src[i])) i++
        continue
      }
      i++
      continue
    }
    if (top === 'class') {
      if (c === '\\') { i += 2; continue }
      if (c === ']') stack.pop()
      i++
      continue
    }

    if (c === '/' && next === '/') { stack.push('line'); i += 2; continue }
    if (c === '/' && next === '*') { stack.push('block'); i += 2; continue }
    if (c === '/' && regexCanStart(i)) { stack.push('regex'); keep(i); i++; continue }
    if (c === "'" || c === '"' || c === '`') { stack.push(c); keep(i); i++; continue }
    if (c === '}' && top === '${') { stack.pop(); keep(i); i++; continue }
    keep(i)
    i++
  }
  return out.join('')
}

// Every binding form, generously. Being generous is the point: a false
// "declared" costs nothing, and a false "undeclared" would make this noisy
// enough to stop being run, which is the only way a check like this fails.
function declaredIn (src, into = new Set()) {
  const add = s => { if (s && /^[A-Za-z_$][\w$]*$/.test(s)) into.add(s) }
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1])
  for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) add(part.split(':').pop().split('=')[0].trim())
  }
  // Both sides of a rename: `({ task: taskId })` binds the right-hand name.
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const clean = part.replace(/[{}[\]]/g, ' ').split('=')[0]
      for (const bit of clean.split(':')) add(bit.trim())
    }
  }
  for (const m of src.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1])
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1])
  // A method on an object literal is a declaration, not a call: `log (line) {`
  // reads exactly like `log(line)` to a regex, and so does `async refuses (f) {`.
  for (const m of src.matchAll(/(?:^|[,{]\s*)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g)) add(m[1])
  // Array destructuring, which is how `for (const [i, step] of ...)` binds.
  for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const part of m[1].split(',')) add(part.split('=')[0].replace(/\./g, '').trim())
  }
  // A defaulted destructured parameter: `{ port = Number(...) }`.
  for (const m of src.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*=/g)) add(m[1])
  return into
}

// Used as `x.y`, `x(`, or interpolated bare into a template.
function usedIn (src, declared, into = new Map()) {
  const note = n => {
    if (GLOBALS.has(n) || declared.has(n)) return
    into.set(n, (into.get(n) || 0) + 1)
  }
  for (const m of src.matchAll(/(?:^|[^\w$.'"`\\])([a-z][\w$]*)\s*[.(]/g)) note(m[1])
  for (const m of src.matchAll(/\$\{\s*([a-z][\w$]*)\s*[}.]/g)) note(m[1])
  return into
}

const read = f => codeOnly(fs.readFileSync(f, 'utf8'))
const jsIn = dir => {
  const at = path.join(ROOT, dir)
  if (!fs.existsSync(at)) return []
  return fs.readdirSync(at).filter(f => f.endsWith('.js')).map(f => path.join(at, f))
}

let bad = 0
const say = (where, names) => {
  bad += names.size
  console.log(`\n  ${where}`)
  for (const [n, c] of [...names].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${n}  (${c} use${c === 1 ? '' : 's'})`)
  }
}

// A module per file.
for (const dir of ['actions', 'tasks', 'machines', 'repos', 'core']) {
  for (const file of jsIn(dir)) {
    const src = read(file)
    const used = usedIn(src, declaredIn(src))
    if (used.size) say(path.relative(ROOT, file), used)
  }
}

// The window: one scope across all of them, plus the two vendored globals and
// whatever index.html defines. Checked together, or every cross-file call in a
// deliberately shared scope would be reported as a fault.
{
  const files = jsIn('ui')
  const sources = files.map(f => [f, read(f)])
  const declared = new Set()
  for (const [, src] of sources) declaredIn(src, declared)
  for (const [file, src] of sources) {
    const used = usedIn(src, declared)
    if (used.size) say(path.relative(ROOT, file), used)
  }
}

if (bad) {
  console.log(`\nFAIL — ${bad} name(s) used but never declared. Each throws the moment its line runs,\nand node --check passes on every one of them.`)
  process.exit(1)
}
console.log('PASS — every bare name these files use is declared somewhere they can see it.')
