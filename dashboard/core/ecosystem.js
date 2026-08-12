'use strict'

// An ecosystem is data the tool is pointed at, never code inside it.
//
// Everything that makes a project itself lives here: which repos it is made of,
// what work is worth doing, what has to be true before a result counts. The core
// reads all of it as opaque values. It does not know what a firmware is, what a
// USB device is, or what any check actually checks -- it knows only that the
// ecosystem said to run one and whether it passed.

const fs = require('node:fs')
const path = require('node:path')

const DIR = path.join(__dirname, '..', 'ecosystems')

function list () {
  if (!fs.existsSync(DIR)) return []
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
}

// Takes a name from `ecosystems/`, or a path to any JSON file anywhere. The
// second form is the point: pointing this at a set of repos should not require
// putting anything inside the tool.
function load (nameOrPath) {
  const direct = nameOrPath.endsWith('.json')
  const file = direct ? path.resolve(nameOrPath) : path.join(DIR, `${nameOrPath}.json`)
  if (!fs.existsSync(file)) {
    throw new Error(direct ? `No ecosystem file at ${file}` : `No ecosystem named "${nameOrPath}" in ecosystems/`)
  }
  const eco = JSON.parse(fs.readFileSync(file, 'utf8'))

  eco.id = nameOrPath
  eco.file = file
  eco.repos = (eco.repos || []).map(r => ({
    // The one branch work happens on. There is no base/work split -- see
    // CONTRACT.md, "Isolation".
    branch: 'master',
    ...r,
    // Relative to the ecosystem file, so a pack can be moved without editing it.
    dir: path.resolve(path.dirname(file), r.path)
  }))
  eco.tasks = (eco.tasks || []).map(t => ({
    // A task with no repos listed spans all of them: the common case should not
    // need saying.
    repos: eco.repos.map(r => r.name),
    checks: [],
    ...t
  }))
  return eco
}

const repo = (eco, name) => {
  const found = eco.repos.find(r => r.name === name)
  if (!found) throw new Error(`Ecosystem "${eco.id}" has no repo named "${name}"`)
  return found
}

const task = (eco, id) => {
  const found = eco.tasks.find(t => t.id === id)
  if (!found) throw new Error(`Ecosystem "${eco.id}" has no task named "${id}"`)
  return found
}

const reposFor = (eco, t) => t.repos.map(name => repo(eco, name))

// Reports which repos are actually present. A pack that names a repo nobody
// cloned is the failure mode that hid a whole seam violation in the last
// version: nine of ten repos dangled and nothing said so.
async function health (eco) {
  return eco.repos.map(r => ({
    name: r.name,
    dir: r.dir,
    present: fs.existsSync(path.join(r.dir, '.git'))
  }))
}

module.exports = { list, load, repo, task, reposFor, health, DIR }
