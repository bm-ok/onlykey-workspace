'use strict'

// The rules a worker is given, written once and kept.
//
// THE THIRD THING THAT IS TEXT SOMEBODY HAS TO READ. A prompt is what a worker
// is told to do; a contract is what it may and may not do while doing it -- do
// not touch the default branch, do not install anything, say so rather than
// guessing. They are separate because they change on different clocks: a brief
// is written for one occasion, and the rules are the same for a hundred of them.
//
// IT WAS A PATH ON THIS HOST, and that is why it was used once. `--contract
// ./state/task-contract.md` names a file nothing in this app creates, edits,
// reads back or checks -- so the rules a run was governed by lived outside
// everything that governs runs. Nobody approved them, an edit went unnoticed,
// and a task written in January could be dispatched in March under rules that
// had been rewritten in between with every tick on the screen still green.
//
// So it becomes a thing with a name, a hash and an approval, exactly like a
// prompt -- and for the sharper reason. A prompt that has drifted produces work
// nobody asked for; a contract that has drifted removes a limit nobody agreed to
// remove, and does it silently, because a run with no rules looks identical to a
// run with rules from everywhere except the file itself.
//
// KEPT FOR THIS COMPUTER, NOT FOR A WORKSPACE, for the same reason a prompt is:
// "do not force-push" names no repository. It sits with the keys, the prompts
// and the approvals -- the things that are true whatever is being worked on.

const fs = require('node:fs')
const path = require('node:path')
const data = require('../core/data')

const FILE = () => path.join(data.state(), 'contracts.json')

// The same fingerprint the prompts and the jobs use. Short, stable, and about
// the text rather than about when it was written.
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

// APPROVAL IS ON THE WORDS, not on the record, and an edit lapses it.
const all = () => read().map(c => {
  const now = hash(c.text)
  return {
    ...c,
    // Filled at read time, so an entry written before there were two
    // libraries answers rather than answering undefined. See save().
    kind: c.kind === 'judge' ? 'judge' : 'task',
    hash: now,
    approved: !!(c.approval && c.approval.hash === now),
    lapsed: !!(c.approval && c.approval.hash !== now),
    approvedAt: c.approval ? c.approval.at : null,
    approvedBy: c.approval ? c.approval.by : null,
    lines: String(c.text || '').split('\n').length
  }
})
const get = id => all().find(c => c.id === id) || null

const idFor = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// Written, or rewritten. The id never changes once made: something may be
// pointing at it, and a rename that silently becomes a different contract is the
// quietest way to break a reference.
// `kind` — WHAT THESE RULES ARE FOR: a worker doing work, or one judging it.
// Two libraries in one store. Defaults to `task`, and an existing contract keeps
// what it had: everything written before there were two was written for work.
function save ({ id, name, text, about, kind }, by = 'the window') {
  const title = String(name || '').trim()
  if (!title) throw new Error('Give it a name. A contract with no name is one nobody finds again.')
  const body = String(text || '').trim()
  // The same refusal vmDispatch already makes about an empty file, made earlier.
  // An empty contract is worse than none: everything downstream reports that
  // rules were applied.
  if (!body) throw new Error('Write the rules. An empty contract is worse than none — it reads as though rules were applied.')

  const list = read()
  const key = id || idFor(title)
  if (!key) throw new Error('That name has no letters or numbers in it.')

  const at = list.findIndex(c => c.id === key)
  const now = new Date().toISOString()

  // Written at the window is approved by whoever wrote it -- writing it there IS
  // the reading. Written down the pipe it waits for a person.
  const stamp = by === 'the window' ? { at: now, by, hash: hash(body) } : null

  const which = kind === undefined
    ? (at === -1 ? 'task' : list[at].kind || 'task')
    : (String(kind) === 'judge' ? 'judge' : 'task')

  if (at === -1) {
    list.push({ id: key, name: title, about: String(about || '').trim() || null, text: body, kind: which, written: now, edited: null, approval: stamp })
  } else {
    const was = list[at]
    const changed = was.text !== body
    list[at] = {
      ...was,
      name: title,
      about: String(about || '').trim() || null,
      text: body,
      kind: which,
      edited: changed ? now : was.edited,
      // OR TAKES ONE, if it had none and a person is the one saving. See the
      // note in tasks/prompts.js: this stamped only on a CHANGE, so reading an
      // unapproved contract and pressing Save left it unapproved, while the
      // dialog said saving it at the window is what approves it. Reading it and
      // pressing Save is the approval; `stamp` is null when the save did not
      // come from the window, so nothing approves itself down the pipe.
      approval: changed ? stamp : (was.approval || stamp)
    }
  }

  write(list)
  return { ...get(key), created: at === -1 }
}

function forget (id) {
  const list = read()
  const found = list.find(c => c.id === id)
  if (!found) throw new Error(`There is no contract called "${id}".`)
  write(list.filter(c => c.id !== id))
  return { forgotten: found.id, name: found.name }
}

function approve (id, note = null) {
  const list = read()
  const at = list.findIndex(c => c.id === id)
  if (at === -1) throw new Error(`There is no contract called "${id}".`)
  list[at] = { ...list[at], approval: { at: new Date().toISOString(), by: 'the window', note: String(note || '').trim() || null, hash: hash(list[at].text) } }
  write(list)
  return get(id)
}

// IN PLAY, OR KEPT AND OUT OF THE WAY.
//
// A library only grows. Every contract ever written stays, because what a worker
// was held to six weeks ago has to remain readable -- and the cost of that is a
// list where the two that are current sit among six that are not. A supervisor
// choosing from the whole of it is choosing from history.
//
// So this is not deleting. `forget` deletes; this sets aside. The text, the
// approval and the record are all untouched, and the only thing that changes is
// whether anything is offered it.
//
// ABSENT MEANS IN USE. Everything written before this existed carries no flag
// and must keep working, so the question asked everywhere is "has it been set
// aside", never "has it been marked usable".
//
// BRINGING ONE BACK OVER THE WIRE COSTS ITS APPROVAL, and that is the whole
// safety of it. Setting aside is harmless from anywhere -- it takes something
// out of play. Putting it BACK is the direction that matters: without this,
// anything that could set aside and restore could take an approved contract,
// park it, and bring it back whenever it liked, which is the approval gate with
// a door beside it. At the window it is a person doing it and the approval
// stands; over the wire it waits to be read again, exactly like a rewrite.
function use (id, on, { by = 'the window' } = {}) {
  const list = read()
  const at = list.findIndex(x => x.id === id)
  if (at === -1) throw new Error(`There is no contract called "${id}".`)

  const wanted = on !== false && on !== 'false'
  const wasAside = list[at].setAside === true
  const next = { ...list[at], setAside: wanted ? false : true }

  if (wanted && wasAside && by !== 'the window') {
    next.approval = null
  }

  list[at] = next
  write(list)
  return get(id)
}

function withdraw (id) {
  const list = read()
  const at = list.findIndex(c => c.id === id)
  if (at === -1) throw new Error(`There is no contract called "${id}".`)
  list[at] = { ...list[at], approval: null }
  write(list)
  return get(id)
}

// The starter, for somebody writing their first one. Rules rather than a brief:
// what a worker may not do, and what to do instead of guessing.
const STARTER = `# What this worker may and may not do

- Work only on the branch you were given. Never commit to the default branch.
- Do not force-push, and do not rewrite history that is already pushed.
- Do not install anything. If something is missing, say so and stop.
- Do not edit anything outside the repositories in this folder.

# When you are unsure

Say what you were unsure about and what you did instead. A note in the
transcript is worth more than a guess that looks like a decision.

# When you finish

Leave the work on the branch. Say in one paragraph what you changed and what you
did not get to.
`

module.exports = { all, get, save, approve, use, withdraw, forget, hash, idFor, FILE, STARTER }
