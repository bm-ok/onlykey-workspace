'use strict'

// What a worker is told, written once and kept.
//
// Writing a task is writing a prompt. The brief IS the instruction -- "read the
// README against the code and say where they disagree" -- and until now it was
// typed fresh every time, drifting a little on each retype until there were four
// versions of the same intention and nobody knew which was the good one.
//
// So the text becomes a thing with a name. A task still carries its own copy of
// what the worker was given, because a task has to stay readable afterwards as
// what actually happened; this is the library it was copied FROM.
//
// KEPT FOR THIS COMPUTER, NOT FOR A WORKSPACE. Everything about a task belongs to
// the folder of repositories it delivers into -- see core/workspaces.js -- and a
// prompt does not: "read the README against the code" names no branch and no
// repository, and a library that emptied itself when somebody switched workspace
// is a library nobody would spend an afternoon building. It sits with the keys
// and the approvals, which are the other things true whatever is being worked on.
//
// A HASH, FOR THE SAME REASON THE DRILLS HAVE ONE. A pre-defined task that
// consumes a prompt is approved by somebody who read it; editing the prompt
// afterwards would leave that approval attached to an instruction nobody read.
// The hash is what lets an edit be noticed rather than trusted.

const fs = require('node:fs')
const path = require('node:path')
const data = require('../core/data')

const FILE = () => path.join(data.state(), 'prompts.json')

// The same shape as the drills' fingerprint: short, stable, and about the text
// rather than about when it was written.
function hash (text) {
  const s = String(text || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `${h.toString(16)}-${s.length}`
}

const read = () => {
  try {
    const kept = JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, ''))
    return Array.isArray(kept) ? kept : []
  } catch { return [] }
}

const write = list => {
  try { fs.mkdirSync(data.state(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(FILE(), JSON.stringify(list, null, 2)) } catch { /* the answer still stands for this call */ }
  return list
}

const all = () => read().map(p => ({ ...p, hash: hash(p.text) }))
const get = id => all().find(p => p.id === id) || null

// An id from the name, so a prompt is findable by a person reading the file and
// a reference to one is legible in whatever consumes it.
const idFor = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// Written, or rewritten. The id never changes once made: something may be
// pointing at it, and a rename that silently becomes a different prompt is the
// quietest way to break a reference.
function save ({ id, name, text, about }) {
  const title = String(name || '').trim()
  if (!title) throw new Error('Give it a name. A prompt with no name is one nobody finds again.')
  const body = String(text || '').trim()
  if (!body) throw new Error('Write the prompt. An empty one would be handed to a worker as an empty instruction.')

  const list = read()
  const key = id || idFor(title)
  if (!key) throw new Error('That name has no letters or numbers in it.')

  const at = list.findIndex(p => p.id === key)
  const now = new Date().toISOString()

  if (at === -1) {
    if (list.some(p => p.id === key)) throw new Error(`There is already a prompt called "${title}".`)
    list.push({ id: key, name: title, about: String(about || '').trim() || null, text: body, written: now, edited: null })
  } else {
    // WHAT CHANGED IS WORTH KNOWING, because an edit lapses whatever approved it.
    const was = list[at]
    const changed = was.text !== body
    list[at] = { ...was, name: title, about: String(about || '').trim() || null, text: body, edited: changed ? now : was.edited }
  }

  write(list)
  return { ...get(key), created: at === -1 }
}

function forget (id) {
  const list = read()
  const found = list.find(p => p.id === id)
  if (!found) throw new Error(`There is no prompt called "${id}".`)
  write(list.filter(p => p.id !== id))
  return { forgotten: found.id, name: found.name }
}

module.exports = { all, get, save, forget, hash, idFor, FILE }
