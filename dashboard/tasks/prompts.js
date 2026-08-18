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

// Every prompt, with what it is approved against compared to what it says now.
//
// APPROVAL IS ON THE WORDS, not on the record. A prompt is what a worker is
// actually told, and it is the half of a job that changes -- so a job read and
// approved in January can be handed a rewritten instruction in March and do
// something nobody agreed to, while every tick on the screen stays green. The
// hash is of the text, so an edit lapses it and the run is refused until
// somebody reads it again.
const all = () => read().map(p => {
  const now = hash(p.text)
  return {
    ...p,
    // Filled at read time, so an entry written before there were two
    // libraries answers rather than answering undefined. See save().
    kind: p.kind === 'judge' ? 'judge' : 'task',
    hash: now,
    approved: !!(p.approval && p.approval.hash === now),
    lapsed: !!(p.approval && p.approval.hash !== now),
    approvedAt: p.approval ? p.approval.at : null,
    approvedBy: p.approval ? p.approval.by : null
  }
})
const get = id => all().find(p => p.id === id) || null

// An id from the name, so a prompt is findable by a person reading the file and
// a reference to one is legible in whatever consumes it.
const idFor = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// Written, or rewritten. The id never changes once made: something may be
// pointing at it, and a rename that silently becomes a different prompt is the
// quietest way to break a reference.
// `kind` — WHAT THIS IS FOR: being given to a worker doing work, or to one
// judging it. Two libraries in one store, so a judging chain cannot be picked
// for work or the other way round with nothing but a name to tell them apart.
// Defaults to `task`, and an existing entry keeps what it had: everything
// written before there were two was written for work.
function save ({ id, name, text, about, contractId, kind }, by = 'the window') {
  const title = String(name || '').trim()
  if (!title) throw new Error('Give it a name. A prompt with no name is one nobody finds again.')
  const body = String(text || '').trim()
  if (!body) throw new Error('Write the prompt. An empty one would be handed to a worker as an empty instruction.')

  const list = read()
  const key = id || idFor(title)
  if (!key) throw new Error('That name has no letters or numbers in it.')

  const at = list.findIndex(p => p.id === key)
  const now = new Date().toISOString()

  // Written at the window is approved by whoever wrote it -- writing it there IS
  // the reading. Written down the pipe it waits for a person, because a model may
  // write one and may not ratify its own.
  const stamp = by === 'the window' ? { at: now, by, hash: hash(body) } : null

  // THE RULES THESE WORDS HAVE TO HOLD TO.
  //
  // A contract hangs off the prompt rather than off the job, because the prompt
  // is the thing that has to be consistent with it: "refactor across every
  // repository" and "touch nothing you were not asked about" are a brief and a
  // limit that contradict each other, and the only moment anybody would notice
  // is while reading one against the other. Which is the moment a prompt is
  // approved -- so that is where they belong together.
  //
  // Left alone when nothing is sent, like the code on a job: a save that means
  // "rename this" must not quietly unbind the rules.
  const rules = contractId === undefined
    ? (at === -1 ? null : list[at].contractId || null)
    : (String(contractId || '').trim() || null)

  const which = kind === undefined
    ? (at === -1 ? 'task' : list[at].kind || 'task')
    : (String(kind) === 'judge' ? 'judge' : 'task')

  if (at === -1) {
    list.push({ id: key, name: title, about: String(about || '').trim() || null, text: body, contractId: rules, kind: which, written: now, edited: null, approval: stamp })
  } else {
    const was = list[at]
    // THE CONTRACT IS PART OF WHAT WAS APPROVED. Changing which rules a prompt
    // runs under changes what somebody agreed to just as much as rewriting a
    // sentence of it does -- more, since the words look identical afterwards.
    const changed = was.text !== body || (was.contractId || null) !== rules
    list[at] = {
      ...was,
      name: title,
      about: String(about || '').trim() || null,
      text: body,
      contractId: rules,
      kind: which,
      edited: changed ? now : was.edited,
      // A changed save is re-approved only if a person is the one saving it. An
      // unchanged one keeps whatever approval it had — OR TAKES ONE, if it had
      // none and a person is the one saving.
      //
      // THAT LAST CLAUSE IS THE WHOLE OF A BUG THAT COST AN HOUR. The dialog
      // for these says, truthfully, "saving it here approves it: writing it at
      // the window IS the reading" — and this only stamped when something had
      // CHANGED. So a person opening an unapproved prompt, reading it, and
      // pressing Save left it unapproved for ever, with the window reporting
      // "saved, and waiting to be read" exactly as designed. The only way
      // through was to edit it first, which nobody would guess and which makes
      // reading-then-approving impossible without altering what you read.
      //
      // Reading it and pressing Save IS the approval. `stamp` is null when the
      // save did not come from the window, so nothing down the pipe approves
      // itself by saving twice.
      //
      // jobs.js has always done it this way — `by === 'the window' ? stamp :
      // null`, unconditionally — which is why a job approved from the same pane
      // where a prompt and a contract would not. Three stores, two behaviours,
      // and the odd one out was the one that matched what the screen said.
      approval: changed ? stamp : (was.approval || stamp)
    }
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

function approve (id, note = null) {
  const list = read()
  const at = list.findIndex(p => p.id === id)
  if (at === -1) throw new Error(`There is no prompt called "${id}".`)
  list[at] = { ...list[at], approval: { at: new Date().toISOString(), by: 'the window', note: String(note || '').trim() || null, hash: hash(list[at].text) } }
  write(list)
  return get(id)
}

// IN PLAY, OR KEPT AND OUT OF THE WAY.
//
// A library only grows. Every prompt ever written stays, because what a worker
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
// anything that could set aside and restore could take an approved prompt,
// park it, and bring it back whenever it liked, which is the approval gate with
// a door beside it. At the window it is a person doing it and the approval
// stands; over the wire it waits to be read again, exactly like a rewrite.
function use (id, on, { by = 'the window' } = {}) {
  const list = read()
  const at = list.findIndex(x => x.id === id)
  if (at === -1) throw new Error(`There is no prompt called "${id}".`)

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
  const at = list.findIndex(p => p.id === id)
  if (at === -1) throw new Error(`There is no prompt called "${id}".`)
  list[at] = { ...list[at], approval: null }
  write(list)
  return get(id)
}

module.exports = { all, get, save, approve, use, withdraw, forget, hash, idFor, FILE }
