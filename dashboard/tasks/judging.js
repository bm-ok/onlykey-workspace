'use strict'

// A JUDGEMENT, AS A PIECE OF WORK.
//
// Not a field on the thing being judged. A judgement gets a machine, a run, a
// job that says how it is done and a contract that says what it may not do —
// everything a task gets — because "why was this accepted" has to be answerable
// six weeks later by something other than asking whoever typed it.
//
// WHAT IT IS ABOUT IS NEVER A TASK. `taskJudge` wrote a verdict onto the task
// that produced the work, which is the wrong subject twice over: a change may
// come from more than one task, and a task may deliver nothing worth reading.
// Judging follows the CHANGE. So a judgement reads one of two things:
//
//     a branch cut   the work as it stands across the repositories
//     a PR cut       the change as it is proposed for landing, one pull
//                    request per repository, taken as one act
//
// AND IT TAKES NO BRANCH OF ITS OWN, which follows from reading rather than
// writing. A judgement claiming a branch would hold a machine on it for no
// reason, and there would be two things with a claim on one branch.
//
// WHAT IT IS FOR, in the words this was asked for in: did the work follow the
// rules, is it secure, and are there bugs nobody caught. That is a different
// question from "did it do what was asked", which is what the work's own
// contract was about — which is why the judging chain is its own job, prompt and
// contract rather than a re-reading of the task's.
//
// TWO STORES, ON PURPOSE. This holds the WORK — waiting, running, decided. The
// verdict it reaches is appended to `repos/judgements.js`, which keeps opinions
// against a cut and knows when one has gone stale because the code moved. One is
// a queue; the other is a record. Merging them would make a finished judgement
// indistinguishable from a queued one on a board built to show what is left.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const workspaces = require('../core/workspaces')
const log = require('../core/log')

const STATE = () => workspaces.stateDir()

// `judging.json`, NOT `judgements.json` — that name is taken by the verdicts
// kept against a cut, and two files one letter apart holding different things is
// how somebody eventually reads the wrong one.
const FILE = () => { const at = STATE(); return at ? path.join(at, 'judging.json') : null }

// The same high-water mark a task number uses, and for the same reason: throw
// the highest one away and the next written must not take its number back. See
// tasks/store.js, where that happened.
const COUNTER = () => { const at = STATE(); return at ? path.join(at, 'judging-highest.json') : null }

const STATES = ['draft', 'queued', 'given', 'done']
const VERDICTS = ['accepted', 'rejected']

function read () {
  if (!FILE() || !fs.existsSync(FILE())) return []
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, ''))
    return Array.isArray(data) ? data : []
  } catch (e) {
    // SAID, NOT SWALLOWED. An unreadable file and an empty one look identical
    // from a board, and only one of them is somebody's afternoon.
    log.on('judging').bad(`${FILE()} could not be read (${e.message}). Fix or delete it; no judgement is listed until then.`)
    return []
  }
}

function write (list) {
  fs.mkdirSync(STATE(), { recursive: true })
  fs.writeFileSync(FILE(), JSON.stringify(list, null, 2))
  return list
}

function highest () {
  let kept = 0
  try { kept = Number(JSON.parse(fs.readFileSync(COUNTER(), 'utf8')).highest) || 0 } catch { /* first run */ }
  return Math.max(kept, ...read().map(j => Number(j.number) || 0), 0)
}

function claimNumber () {
  const next = highest() + 1
  try {
    fs.mkdirSync(STATE(), { recursive: true })
    fs.writeFileSync(COUNTER(), JSON.stringify({ highest: next, at: new Date().toISOString() }, null, 2))
  } catch { /* the number is right for this call; it is only not remembered */ }
  return next
}

// J1, J2 — its own sequence, and its own prefix.
//
// A judgement and a task can both be #4, and they share one queue and one board.
// So what a row shows is not a bare number: the label is part of the record, and
// nothing drawing it has to know this convention to get it right.
const refOf = number => `J${number}`

// ---- what a judgement is about ---------------------------------------------
//
// Two shapes, one function, because every caller wants the same three answers:
// what kind, what to call it, and the key it is filed under. A PR cut is
// `source -> target`, which is the key `repos/judgements.js` already uses — so a
// verdict reaching the cut needs no translation and cannot land under a name
// that is nearly right.
function subjectFrom (input) {
  const kind = String(input.kind || (input.target ? 'cut' : 'branch')).trim().toLowerCase()

  if (kind === 'cut') {
    const source = String(input.source || input.branch || '').trim()
    const target = String(input.target || '').trim()
    if (!source || !target) {
      throw new Error('A PR cut is a source line and a target — say both, exactly as prCuts lists them. Without the target this would be filed under a cut that does not exist.')
    }
    return { kind: 'cut', source, target, name: `${source} -> ${target}` }
  }

  if (kind === 'branch') {
    const branch = String(input.branch || input.source || '').trim()
    if (!branch) throw new Error('Name the branch cut to be read.')
    return { kind: 'branch', branch, name: branch }
  }

  throw new Error(`"${kind}" is not something this app knows how to judge. A judgement reads a "branch" — the work as it stands — or a "cut", the change as it is proposed for landing.`)
}

const uid = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')

const newId = (subject, taken) => {
  const base = `judge-${subject.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'judge'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

// ---- what is here ----------------------------------------------------------

function all () {
  return read().map(j => ({ ...j, ref: refOf(j.number) }))
}

// By number, ref or id, because a person says "J3", a script keeps the uid, and
// the id is what reads well in a command.
function get (ref) {
  const want = String(ref || '').trim()
  const bare = want.replace(/^[#J]/i, '')
  const found = read().find(j => j.id === want || j.uid === want || String(j.number) === bare)
  if (!found) throw new Error(`There is no judgement "${ref}". Ask for the list to see what there is — a number like J3, a uid or a name all work.`)
  return { ...found, ref: refOf(found.number) }
}

function add (input) {
  const subject = subjectFrom(input.subject || input)

  const list = read()

  // ONE OPEN JUDGEMENT PER SUBJECT. A second one queued against the same change
  // is two machines reading the same thing to reach two verdicts, and the board
  // then has to explain which is the answer. Re-judging AFTER one is decided is
  // the case that matters and is allowed — that is the sequence the record is
  // built for.
  const already = list.find(j => j.subject && j.subject.name === subject.name && j.state !== 'done')
  if (already) {
    throw new Error(`${refOf(already.number)} is already reading ${subject.name} and has not finished. Wait for it, or remove it — two judgements of one change at once is two answers to one question.`)
  }

  const made = {
    id: newId(subject, new Set(list.map(j => j.id))),
    number: claimNumber(),
    uid: uid(),
    subject,
    // What it is called on a board. Derived rather than typed: a judgement is
    // always "read this", and asking for a title would produce a list of
    // sentences that all say the same thing.
    title: `judge ${subject.name}`,
    written: new Date().toISOString(),

    // THE CHAIN, AND EVERY ARROW CARRIES A COPY. Same rule as a task: the words
    // and the rules are copied in, never referenced, because a library entry
    // rewritten later would silently change what a finished judgement appears to
    // have been held to.
    job: input.job ? String(input.job) : null,
    brief: input.brief ? String(input.brief) : null,
    // THE PARTICULAR THING IT WAS ASKED, kept beside the brief that carries it.
    // The brief has it appended already — this is so a board can show what was
    // asked without printing the whole approved prompt to find out.
    question: input.question ? String(input.question) : null,
    promptId: input.promptId ? String(input.promptId) : null,
    promptName: input.promptName ? String(input.promptName) : null,
    rules: input.rules ? String(input.rules) : null,
    contractId: input.contractId ? String(input.contractId) : null,
    contractName: input.contractName ? String(input.contractName) : null,

    // WHO READS IT. A person and a worker are the same act with a different
    // body — see the suite's README. A person's judgement is a judgement with no
    // run, which is why this is a field rather than two kinds of record.
    by: input.by === 'person' ? 'person' : 'worker',

    // Which machines it will accept, exactly as a task does. Judging the test
    // pool's work on the test pool's machines is the ordinary reason.
    tag: input.tag ? String(input.tag) : null,

    state: 'draft',
    machine: null,
    attempts: [],

    // Filled when it finishes. `tips` is what each repository was at when it was
    // read, which is what lets the verdict say later whether it still describes
    // what is there.
    verdict: null,
    note: null,
    tips: null,
    decided: null
  }

  write([...list, made])
  return get(made.id)
}

function update (ref, patch) {
  const found = get(ref)
  if (patch.state && !STATES.includes(patch.state)) {
    throw new Error(`"${patch.state}" is not a state a judgement can be in. They are: ${STATES.join(', ')}.`)
  }
  if (patch.verdict && !VERDICTS.includes(patch.verdict)) {
    throw new Error(`"${patch.verdict}" is not a verdict. It is ${VERDICTS.join(' or ')} — a judgement that cannot say which is a judgement that has not been made.`)
  }
  const list = read().map(j => (j.uid === found.uid ? { ...j, ...patch, touched: new Date().toISOString() } : j))
  write(list)
  return get(found.uid)
}

function remove (ref) {
  const found = get(ref)
  if (found.state === 'given') {
    throw new Error(`${found.ref} is out on ${found.machine || 'a machine'} right now. Removing it here would leave a machine reading something nothing on this host is waiting for.`)
  }
  write(read().filter(j => j.uid !== found.uid))
  return { removed: found.ref, of: found.subject.name }
}

module.exports = { all, get, add, update, remove, read, write, subjectFrom, refOf, STATES, VERDICTS, FILE }
