'use strict'

// Launches the app in NW.js.
//
// The npm `nw` package extracts to a versioned directory (nwjs-sdk-v0.114.1-...)
// and its own shim looks for a plain `nwjs/` that is not always there. Rather
// than pin a path that changes on every upgrade, find the binary.

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const NW_ROOT = path.resolve(__dirname, '..', 'node_modules', 'nw')
const APP = path.resolve(__dirname, '..')
const BINARIES = { win32: 'nw.exe', darwin: 'nwjs.app/Contents/MacOS/nwjs', linux: 'nw' }

function findBinary () {
  const name = BINARIES[process.platform] || 'nw'
  if (!fs.existsSync(NW_ROOT)) throw new Error('NW.js is not installed. Run:  npm install')
  for (const dir of ['nwjs', ...fs.readdirSync(NW_ROOT).filter(d => d.startsWith('nwjs'))]) {
    const candidate = path.join(NW_ROOT, dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Could not find ${name} under ${NW_ROOT}`)
}

let binary
try {
  binary = findBinary()
} catch (err) {
  console.error(`\n${err.message}\n`)
  process.exit(1)
}

console.log(`launching ${path.relative(APP, binary)}`)
const child = spawn(binary, [APP, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', code => process.exit(code === null ? 1 : code))
