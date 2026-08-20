'use strict'

// a session is not tied to a key — the conversation outlives the credential
//
// THE CLAIM THIS SUITE NOW MAKES, and it is the one the rest of the app was
// quietly contradicting: a Claude SESSION and a Claude CREDENTIAL are two
// different things with two different lifetimes.
//
//   a credential   replaceable in a minute by somebody at a login page
//   a session      what a worker worked out about a branch line, which is not
//                  replaceable at all
//
// So a key can be swapped underneath a conversation and the conversation
// survives. A session is filed under WHAT IT IS ABOUT — the branch line — and
// WHICH LANE it is in: worked on, or read. Never under who paid for it.
//
// HOW THIS WAS FOUND, because it is the argument for the check existing. Moving
// one sign-in from worker to judge — a relabelling that does not touch the token
// — carried twenty-three WORKER sessions onto the judge pane with it, every one
// of them badged `worker`. The window was filtering the session list by which
// credential signed each run, so the sessions appeared to swap roles along with
// the key. Nothing threw and nothing was lost; the app simply said the opposite
// of what it claims.
//
// WHAT IS CHECKED HERE IS THE RULE, not the pane. `keyFor` and `aboutWork` are
// functions of a piece of work, and the whole question can be asked of them in
// milliseconds — where proving it through the window means real runs on real
// machines with two real credentials. What needs a machine is the drill next
// door; this is the arithmetic underneath it.

const { it, cleanup } = require('../../harness')
const sessions = require('../../../tasks/sessions')
const guests = require('../../../core/guests')

const branchWork = (uid, branch) => ({ kind: 'task', uid, item: { branch } })
const reading = (uid, branch, extra = {}) =>
  ({ kind: 'judgement', uid, item: { subject: { kind: 'branch', branch }, ...extra } })

it('the same branch line keys the same session, whoever is paying', ({ assert, log }) => {
  // TWO DIFFERENT PIECES OF WORK on one branch line, which is the ordinary case
  // — a task, then another task on the same line a week later. They must reach
  // the same conversation, and nothing about a credential appears in the answer.
  const first = sessions.keyFor(branchWork('uid-one', 'fix/thing'))
  const second = sessions.keyFor(branchWork('uid-two', 'fix/thing'))

  assert.equal(first, second,
    `two tasks on "fix/thing" keyed differently — ${first} and ${second}. A worker would start cold on a line it has already been down`)
  assert.ok(first.includes('fix') || first.includes('thing'),
    `the key does not name the branch line it is for: ${first}`)
  log(`both tasks on fix/thing key to ${first}`)
})

it('and the lane is part of the key, so reading and writing never collide', ({ assert, log }) => {
  // THE ONE THING THAT MUST SEPARATE TWO CONVERSATIONS ABOUT ONE LINE. A worker
  // that wrote the change and a judge that read it are different accounts on
  // purpose — that separation is what makes a verdict worth more than a
  // signature — and sharing one transcript would collapse it more completely
  // than sharing a credential ever could.
  const worked = sessions.keyFor(branchWork('uid-one', 'fix/thing'))
  const read = sessions.keyFor(reading('uid-three', 'fix/thing', { remembers: true }))

  assert.notEqual(worked, read,
    `the worker and the judge on "fix/thing" share one conversation (${worked}). The judge would be reading its own notes about work it wrote`)
  log(`worked ${worked}; read ${read}`)
})

it('and what a session is about is the line, not the task that started it', ({ assert, log }) => {
  // WHY THIS IS ASKED SEPARATELY FROM THE KEY: the key is a filename and the
  // question somebody has in front of a list of sessions is "which branch line
  // was this run under". That was answerable only by parsing the filename, so
  // every panel that showed a session showed the NUMBER of the work that last
  // wrote it — and a session outlives the task that started it, so those lists
  // read "#61, task is gone" about conversations in daily use.
  const w = sessions.aboutWork(branchWork('uid-one', 'fix/thing'))
  assert.equal(w.lane, 'worker', `work on a branch reports lane "${w.lane}"`)
  assert.equal(w.about, 'fix/thing', `work on fix/thing says it is about "${w.about}"`)

  const r = sessions.aboutWork(reading('uid-three', 'fix/thing'))
  assert.equal(r.lane, 'judge', `a judgement reports lane "${r.lane}"`)
  assert.equal(r.about, 'fix/thing', `a judgement of fix/thing says it is about "${r.about}"`)

  // A READING OF SOMEBODY ELSE'S PULL REQUEST is about that pull request, which
  // is not a branch on this host at all — so "the subject" has to be wider than
  // "a branch" or arrived work gets filed under nothing.
  const p = sessions.aboutWork({
    kind: 'judgement', uid: 'uid-four', item: { subject: { kind: 'pull', on: 'owner/repo', number: 13 } }
  })
  assert.equal(p.about, 'owner/repo#13', `a reading of an arrived pull request says it is about "${p.about}"`)
  log('every session says its lane and its subject, in words rather than in a filename')
})

it('and a piece of work may ask to remember, over the default', ({ assert, log }) => {
  // THE CHOICE IS ON THE JUDGEMENT, made by a person at the Ask-for-a-judgement
  // dialog where the trade is written on the box: a judge that carries on from
  // its last reading can say what you fixed and what you did not, and can also
  // agree with itself. REMEMBERS is what work that did NOT say gets.
  const cold = sessions.keyFor(reading('uid-cold', 'fix/thing'))
  const warm = sessions.keyFor(reading('uid-warm', 'fix/thing', { remembers: true }))

  assert.equal(cold, 'uid-cold',
    `a judgement that did not ask to remember was given a shared key (${cold}), so it would arrive having already decided something`)
  assert.notEqual(warm, 'uid-warm',
    'a judgement that asked to carry on was keyed to itself, so it starts cold anyway and the checkbox does nothing')

  // ONLY UPWARDS. A default that could switch OFF something a person deliberately
  // asked for would make the quiet setting beat the deliberate arrangement.
  assert.ok(!sessions.REMEMBERS.judge,
    'this check assumes judging is cold by default; REMEMBERS.judge is on, so what it proves is no longer what it says')
  log(`without the box ${cold}; with it ${warm}`)
})

it('and a credential can be relabelled without touching the token', ({ assert, state, log }) => {
  // THE OTHER HALF OF "NOT TIED", from the credential's end. A sign-in changing
  // role is a RELABELLING: the fingerprint afterwards is the same one, which is
  // how somebody can tell nothing was re-sealed or re-read. If this were a
  // replacement, swapping roles would cost a sign-in and the separation between
  // reading and writing would be expensive enough that nobody would keep it.
  const free = guests.all().find(g => g.role !== 'supervisor' && !g.holder)
  assert.needs(free, 'no sign-in here is free to relabel — one that is out on a machine is refused, correctly')

  const was = free.role
  state.put = { name: free.name, role: was }

  const to = was === 'judge' ? 'worker' : 'judge'
  const now = guests.roleOf(free.name, to)
  assert.equal(now.role, to, `"${free.name}" was asked to become a ${to} and reports ${now.role}`)
  assert.equal(now.fingerprint, free.fingerprint,
    `"${free.name}" changed role and its fingerprint moved, ${free.fingerprint} to ${now.fingerprint} — the token was touched, so this is a replacement rather than a label`)

  guests.roleOf(free.name, was)
  state.put = null
  log(`${free.name} went ${was} to ${to} and back, fingerprint ${free.fingerprint} throughout`)
})

cleanup(({ state }) => {
  // A ROLE PUT BACK. The check above moves one; if it fails between the move and
  // the move back, a sign-in is left as the wrong kind — and the queue honours
  // that, quietly taking it out of the pool it belongs to.
  if (state.put) {
    try { guests.roleOf(state.put.name, state.put.role) } catch { /* it is already back */ }
    state.put = null
  }
})
