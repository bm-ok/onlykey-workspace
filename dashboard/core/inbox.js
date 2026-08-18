'use strict'

// EVERYTHING WAITING ON A PERSON, IN ONE LIST.
//
// This app has a lot of doors, and each one grew its own way of saying "somebody
// has to look at this": a badge on Actions, an amber number on Judge, a strip
// above the judgements, a banner. Each is right about its own corner and none of
// them is the answer to "what is waiting on me", which is the question actually
// asked — usually after something has sat unnoticed for a day.
//
// SO THE LIST IS THE THING AND THE BADGES COUNT IT. Not the other way round.
// `waiting` in actions/app.js composed its own version of most of this, and two
// places computing what needs a person is the disagreement this project keeps
// finding — a badge saying three beside a pane showing one. There is one
// composer now, here, and everything else asks it.
//
// COMPUTED, NEVER STORED. An inbox with its own store is one that has to be kept
// in step with the truth by remembering to write to it, and the entry nobody
// remembered is exactly the one that matters. Every item below is derived from
// what already exists, so an item disappears the moment the thing it is about is
// dealt with, whoever dealt with it and however.
//
// WHAT BELONGS HERE is anything a PERSON must decide or do. Not what a machine
// is doing, not what is queued, not what failed and will be retried — those are
// the queue's and the board's business. The test is: would this sit for a week
// if nobody read it?

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')
const chat = require('./chat')
const todo = require('./todo')
const jobs = require('../tasks/jobs')
const prompts = require('../tasks/prompts')
const contracts = require('../tasks/contracts')
const judging = require('../tasks/judging')
const landings = require('../repos/landings')
const remotes = require('../repos/remotes')

// ---- PUT AWAY, WHICH IS NOT THE SAME AS DEALT WITH ----------------------
//
// Some of what lands here is a thing to read once and never act on: a
// judgement that ended without a verdict weeks ago, a change somebody else
// merged. It is honest for those to appear and it is not useful for them to
// stay, because a list that is never empty is a list nobody reads — which is
// the exact failure this whole thing exists to fix.
//
// SO ITEMS ARE PUT AWAY BY KEY, and the key is the careful part. It must be
// stable enough that hiding a thing hides THAT thing tomorrow, and specific
// enough that it never hides something NEW. Hiding "the supervisor said
// something" must not silence the next thing it says.
//
// So a key for one identifiable thing is its kind and its id — a judgement
// ref, a repository, an approval. A key for a RUNNING TALLY carries the thing
// that moves: the last message number, the number of items. When that moves,
// the key changes, the item is new again, and it comes back. That is the
// difference between putting something away and turning it off.
const HIDDEN = () => path.join(data.state(), 'inbox-hidden.json')

const hiddenNow = () => {
  try { return JSON.parse(fs.readFileSync(HIDDEN(), 'utf8')) || {} } catch { return {} }
}

const keepHidden = all => {
  try { fs.mkdirSync(data.state(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(HIDDEN(), JSON.stringify(all, null, 2)) } catch { /* the answer still stands */ }
  return all
}

function hide (key, { by = null, why = null } = {}) {
  const k = String(key || '').trim()
  if (!k) throw new Error('Say which item to put away — the key is on it.')
  const all = hiddenNow()
  all[k] = { at: new Date().toISOString(), by: by || null, why: why || null }
  keepHidden(all)
  return { key: k, hidden: true }
}

function show (key) {
  const k = String(key || '').trim()
  const all = hiddenNow()
  const had = !!all[k]
  delete all[k]
  keepHidden(all)
  return { key: k, hidden: false, was: had }
}

// WHERE TO GO, as the window's own words for a place: a view, the pane in it,
// and what to select when it gets there. Written per item rather than looked up
// later, because the thing that knows where an approval lives is the thing that
// found it.
const at = (view, pane = null, pick = null) => ({ view, pane, pick })

// One item. `mine` marks the ones a person alone can clear — an approval, a
// verdict, a choice — as opposed to something merely worth knowing about.
// `id` is what makes this item THAT item tomorrow. For a tally, pass the
// number that moves — see the note on keys above.
function item (kind, what, why, where, opts) {
  const o = opts || {}
  const id = o.id == null ? what : o.id
  return {
    kind,
    what,
    why,
    where,
    since: o.since == null ? null : o.since,
    mine: o.mine === undefined ? true : o.mine,
    id,
    key: `${kind}::${id}`
  }
}

function all () {
  const out = []

  // ---- things written and not approved -----------------------------------
  //
  // A job, a prompt or a contract that nothing may run until somebody reads it.
  // Two libraries and they live on different tabs, so each item says which.
  // TWO MEANINGS OF "kind" MEET HERE, and keeping them apart is the whole of
  // this block. `type` is what the artifact IS — a job, a prompt, a contract.
  // `lane` is who it is FOR — "task" ones live under Actions, "judge" ones
  // under Judge. Counting them together once put a badge on a tab the things
  // were not on and sent a button to a pane where they are not.
  const unapproved = [
    ...jobs.all().filter(j => !j.approved).map(j => ({ ...j, type: 'job' })),
    ...prompts.all().filter(p => !p.approved).map(p => ({ ...p, type: 'prompt' })),
    ...contracts.all().filter(c => !c.approved).map(c => ({ ...c, type: 'contract' }))
  ]
  for (const one of unapproved) {
    const lane = String(one.kind || 'task') === 'judge' ? 'judge' : 'task'
    out.push(item(
      `${one.type} to approve`,
      one.name || one.id,
      `Nothing can run it until somebody reads it. ${one.lapsed
        ? 'It was approved and then edited, so what was approved is not what would be sent.'
        : 'Written and never approved.'}`,
      lane === 'judge' ? at('judge', 'judges', one.id) : at('actions', `${one.type}s`, one.id),
      { since: one.edited || one.written || null, id: one.id }
    ))
  }

  // ---- READINGS WITHOUT A VERDICT ARE NOT HERE, DELIBERATELY ---------------
  //
  // They were, and they were eight of the first fourteen items — every one of
  // them a judgement that finished days ago and had never been decided about.
  //
  // A JUDGEMENT THAT ENDED WITHOUT A VERDICT IS HISTORY, not an errand. Nothing
  // is blocked by it: the change it read can still be sent, another reading can
  // still be asked for, and the finding it handed back is on the Judge tab
  // whenever anybody wants it. Recording a verdict is worth doing and it is not
  // a thing that goes stale, which is exactly the test for belonging here —
  // "would this sit for a week if nobody read it" has to mean "and that would
  // be a problem".
  //
  // AND A COUNT THAT IS NEVER ZERO IS A COUNT NOBODY READS. The Judge badge sat
  // at eight all day while the two things that genuinely needed somebody — a
  // repository pointing nowhere, an arrived pull request — were a smaller
  // number beside it. That is the failure this list was built to fix, arriving
  // through this list.
  //
  // The Judge tab still badges what is actually owed there: a judging job,
  // prompt or contract that nothing may run until it is read. See `waiting` in
  // actions/app.js.

  // ---- somebody else's pull request, waiting to be allowed ----------------
  //
  // The one decision in this app a model may not make for itself, so it is the
  // one most worth surfacing: nothing happens to it at all until a person looks.
  // ONE READING, NO GIT. Same reason as `waiting`: nothing below asks
  // about a branch or a head, and this is composed every time the window
  // draws to put a number on the Dashboard button.
  const rows = remotes.notesOnly()
  const ourRemotes = new Set(rows.filter(x => x.remote).map(x => `${x.remote.owner}/${x.remote.repo}`))

  for (const r of rows) {
    const target = remotes.targetOf(r.repo)
    for (const p of r.pulls || []) {
      if (p.state !== 'open' || p.merged) continue
      const from = String(p.headRepo || '').trim()
      const ours = ourRemotes.has(from)
      if (ours) continue
      out.push(item(
        'pull request to allow',
        `${target.on}#${p.number} — ${p.title || ''}`.trim(),
        `It arrived from outside this workspace${p.by ? `, from ${p.by}` : ''}. Judging it means fetching a stranger's change onto a machine holding a credential, so nothing reads it until you say so.`,
        at('repos', 'todo'),
        { since: p.at || null, id: `${r.repo}#${p.number}` }
      ))
    }
  }

  // ---- a repository nobody has pointed anywhere ---------------------------
  //
  // NOT AN ERROR, and that is exactly why it belongs here: keeping to itself is
  // a valid and safe state, so nothing refuses and nothing goes red — which is
  // how it sits for a week while somebody wonders why no issue ever arrives.
  for (const r of rows) {
    if (!r.remote || r.remote.kind !== 'github') continue

    // NOTHING KNOWN, OR NOTHING KNOWN ABOUT *THIS* REMOTE.
    //
    // This block used to require `fork === true`, which silently excluded the
    // one state that matters most: a repository just pointed somewhere new,
    // where nothing has been asked yet and so nothing is a fork as far as this
    // app can tell. Two of three repositories were in exactly that state and
    // the list said nothing about either.
    //
    // `stale` is the sharper half — asked, answered, and the remote has moved
    // since, so everything known describes somewhere else. A full panel of
    // confident facts about the wrong repository is worse than an empty one.
    if (!r.checked || r.stale) {
      out.push(item(
        'ask GitHub about this one',
        r.repo,
        r.stale
          ? `What is known about "${r.repo}" was learnt about ${r.about}, and it points at ${r.remote.owner}/${r.remote.repo} now — so its parent, its chain and what the token may do all describe somewhere else.`
          : `Nothing has been asked about "${r.repo}" yet, so nothing here knows whether it is a fork, what is above it, or whether this token may push to it.`,
        at('repos', 'repos', r.repo),
        { since: r.checked || null, id: r.repo }
      ))
      continue
    }

    const target = remotes.targetOf(r.repo)
    if (target.chosen) continue
    // Only worth raising for a fork. A repository that is nobody's fork IS the
    // project, and keeping to itself is the whole of the right answer.
    if (r.fork !== true) continue
    out.push(item(
      'where work goes',
      r.repo,
      `It is a fork and nothing has been picked, so issues and pull requests both stay on ${target.self} and nothing upstream is watched. Walk the fork chain and say where work goes.`,
      at('repos', 'repos', r.repo),
      { since: null, id: r.repo }
    ))
  }

  // ---- work that is out and has not landed --------------------------------
  for (const c of landings.readings().filter(r => !r.landed && (r.pulls || []).some(p => p.number))) {
    out.push(item(
      'change out and not merged',
      `${c.source} into ${c.target}`,
      `Open on somebody else's repository and waiting on a merge — as last read from GitHub. ${(c.pulls || []).map(p => `${p.repo} #${p.number}`).join(', ')}`,
      at('repos', 'cuts', c.source),
      { since: c.opened || null, mine: false }
    ))
  }

  // ---- what the supervisor said -------------------------------------------
  const from = chat.fromMark()
  const said = chat.all().filter(m => m.who === 'supervisor' && Number(m.n) > Number(from || 0))
  if (said.length) {
    const last = said[said.length - 1]
    out.push(item(
      'the supervisor said something',
      `${said.length} message${said.length === 1 ? '' : 's'} since your bookmark`,
      String(last.text || '').slice(0, 200),
      at('chat', 'chat'),
      // Keyed on the LAST MESSAGE, so putting this away puts away what has been
      // said so far and the next thing said brings it straight back.
      { since: last.at || null, mine: false, id: `up to n${last.n}` }
    ))
  }

  // ---- and what it can no longer see --------------------------------------
  const readMark = chat.readMark ? chat.readMark() : null
  const beyond = chat.since(Number(readMark && readMark.n) || 0).missed || 0
  if (beyond) {
    out.push(item(
      'the supervisor cannot see this any more',
      `${beyond} message${beyond === 1 ? '' : 's'} past what it can read back`,
      'It reads the most recent 200 and there is no call that returns the rest, so anything you said before that has quietly stopped applying.',
      at('chat', 'chat'),
      { since: null, id: `${beyond} beyond reach` }
    ))
  }

  // ---- what somebody wrote down for themselves ----------------------------
  //
  // Only the ones a person put there. A todo the supervisor wrote is its own
  // note about its own work, and putting those here would make this list a
  // second copy of the Todo pane.
  for (const t of todo.all()) {
    if (t.state === 'done') continue
    if (!t.by || /^supervisor/i.test(String(t.by))) continue
    out.push(item(
      'on your list',
      `${t.ref} — ${t.what}`,
      t.why || 'You wrote this down.',
      at('chat', 'todo', t.ref),
      { since: t.at || null, id: t.ref }
    ))
  }

  // MARKED RATHER THAN REMOVED, so the caller decides. The window shows the
  // visible ones and can ask for the rest; nothing here silently drops
  // anything, which is what a list that can hide things has to promise.
  const away = hiddenNow()
  return out.map(i => (away[i.key]
    ? { ...i, hidden: true, hiddenAt: away[i.key].at, hiddenWhy: away[i.key].why || null }
    : { ...i, hidden: false }))
}

// COUNTED BY WHERE IT LIVES, so a tab badge is a filter of this list rather than
// a second opinion about it.
// NO DEFAULT THAT CALLS A FUNCTION, in either of these two. The name checker in
// `npm test` reads `items = all()` as a use of an undeclared name — a false
// positive, and cheaper to write around than to argue with.
function byView (list) {
  const items = list || live()
  const out = {}
  for (const i of items) {
    const v = (i.where && i.where.view) || 'other'
    out[v] = (out[v] || 0) + 1
  }
  return out
}

// A function declaration rather than an arrow, to match byView above -- and
// because the name checker in npm test reads a default on an arrow parameter as
// an undeclared name. A false positive, and not worth the argument.
function mine (list) {
  return (list || live()).filter(i => i.mine)
}

// COUNTED WITHOUT THE PUT-AWAY ONES, because the badge is the reason somebody
// looks and a badge that counts things you have already dismissed is the
// nagging this was built to stop.
function live (list) {
  return (list || all()).filter(i => !i.hidden)
}

module.exports = { all, live, byView, mine, hide, show, hiddenNow }
