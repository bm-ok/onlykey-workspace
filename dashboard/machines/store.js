'use strict'

// The machines you have, as editable configuration rather than something baked
// in. Add and remove them from the page; this is where they are kept.

const fs = require('node:fs')
const path = require('node:path')
const log = require('../core/log')

const STATE = process.env.OKC_STATE || path.join(__dirname, '..', 'state')
const FILE = path.join(STATE, 'machines.json')

// This machine always exists and cannot be removed. Without it the page opens
// with nothing to act on, and the one machine everybody has is the one nobody
// should have to configure.
const HERE = { id: 'here', name: 'This machine', kind: 'local', fixed: true }

function all () {
  if (!fs.existsSync(FILE)) return [HERE]
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  return [HERE, ...saved.filter(m => m.id !== 'here')]
}

const save = list => {
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(list.filter(m => !m.fixed), null, 2))
}

const get = id => {
  const m = all().find(m => m.id === id)
  if (!m) throw new Error(`No machine called "${id}"`)
  return m
}

function add (m) {
  if (!m.name || !m.name.trim()) throw new Error('Give the machine a name.')
  const id = (m.id || m.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!id) throw new Error('That name has no letters or numbers in it.')
  if (all().some(x => x.id === id)) throw new Error(`There is already a machine called "${id}".`)
  if (m.kind === 'ssh' && !m.host) throw new Error('An ssh machine needs a host, like user@address.')

  const machine = {
    id,
    name: m.name.trim(),
    kind: m.kind === 'ssh' ? 'ssh' : 'local',
    host: m.host || '',
    path: m.path || '',
    editor: m.editor || '',
    vm: m.vm && m.vm.name ? { provider: 'virtualbox', name: m.vm.name } : null,
    provision: Array.isArray(m.provision) ? m.provision : []
  }
  save([...all(), machine])
  log.on('machines').good(`Added machine "${machine.name}"`)
  return machine
}

function update (id, patch) {
  const list = all()
  const m = list.find(x => x.id === id)
  if (!m) throw new Error(`No machine called "${id}"`)
  if (m.fixed && (patch.kind || patch.host)) throw new Error('This machine cannot be turned into something else.')
  Object.assign(m, patch, { id: m.id, fixed: m.fixed })
  save(list)
  log.on('machines', id).info(`Changed "${m.name}"`)
  return m
}

function remove (id) {
  const m = get(id)
  if (m.fixed) throw new Error('This machine cannot be removed.')
  save(all().filter(x => x.id !== id))
  log.on('machines', id).info(`Removed "${m.name}". Nothing on it was touched.`)
  return { removed: id }
}

module.exports = { all, get, add, update, remove }
