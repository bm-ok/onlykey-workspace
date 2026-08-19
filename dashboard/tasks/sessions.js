'use strict'

// What a worker remembers, kept here rather than on the machine that made it.
//
// THE MACHINE IS ROLLED BACK, WHICH IS THE WHOLE PROBLEM. A run leaves a Claude
// session in the guest's `~/.claude`, and the queue then restores that machine
// to its base snapshot -- so the record of what a worker actually did, turn by
// turn, existed only for as long as nobody tidied up after it. The log survived
// because it was copied here; this did not, because nothing copied it.
//
// That is worse than losing a log. A log is what the run printed; a session is
// what it was told, what it decided, what it ran and what came back -- the only
// thing that answers "why did it do that", and the only one you cannot
// reconstruct from the branch afterwards.
//
// THE WHOLE FOLDER, NOT THE TRANSCRIPT FILE. `~/.claude` holds the transcript
// and everything around it: which project directory it belongs to, the todos it
// was keeping, its own settings and history. Taking only the `.jsonl` means
// working out where to put it back -- Claude files a session under a slug made
// from the working directory -- and getting that wrong restores a transcript
// that nothing will ever find. An archive of the folder puts itself back.
//
// EXCEPT THE CREDENTIAL, and that exclusion is load-bearing. `~/.claude` also
// holds `.credentials.json`, the worker's own token. This host already holds one
// copy, sealed by core/secret.js; letting it ride along in every session archive
// would make an unsealed copy per task, sitting in a folder whose whole purpose
// is to be kept for a long time. The machine is handed a credential on its way
// up and it is taken back on the way down -- that path already exists and does
// not need a second one that nobody thought of as a credential path at all.
//
// KEYED BY TASK UID, exactly like the files beside them and for the same reason:
// a uid is never reused and never renamed, so throwing the task away does not
// orphan what it produced, and rebuilding the board does not move it.
//
// ONE PER TASK, and the guest does not get a say in that. A worker started for a
// task continues the same conversation every time it is started again, whichever
// machine it lands on -- which is what makes a task given out twice a second
// attempt rather than a stranger starting fresh. "Which conversation is this" is
// a question about the task, not about the run that happens to be executing it,
// so the guest is never asked and cannot answer.
//
// AND YET IT IS SIGNED BY ONE, which is a different question and had no answer.
// A transcript is what a Claude sign-in did: the turns in it were spent by a
// credential this host lent out, and were billed to whoever that identity
// belongs to. That was not written down anywhere -- the record held the machine
// and the run, and the machine is a box that was rolled back afterwards.
//
// So each keep() records WHICH GUEST WAS ON THE MACHINE at the time, and the set
// of every guest that has ever carried this conversation. Two fields rather than
// one because both questions get asked: "who spent this run" is the latest, and
// "which conversations has this credential been part of" needs all of them, since
// one task resumed across three runs may have been signed by three identities.
//
// STILL NOT THE TOKEN, and not a path to it. A name, which is what the guest
// list already shows -- see core/guests.js. The credential itself is excluded
// from the archive, as above, and pairing the two by name does not put it back.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const data = require('../core/data')
const { parseTar } = require('../vendors/nanotar/nanotar.js')

// ---- WHETHER WORK REMEMBERS WHAT IT DID LAST TIME ON THE SAME SUBJECT ------
//
// CHANGED HERE, IN SOURCE, ON PURPOSE. There is no setting for this and no
// button. It is a decision about how a model behaves, the difference is
// impossible to see from outside, and the argument for each side is below —
// which is the whole reason it is a constant somebody has to come and read
// rather than a checkbox somebody can flick without meeting any of this.
//
// FALSE IS TODAY'S BEHAVIOUR. A session is filed under the uid of the one piece
// of work, so a task resumed across three machines continues one conversation
// and a different task starts cold. Nothing about the app changes while these
// are false.
//
// TRUE FILES IT UNDER THE SUBJECT INSTEAD — the branch cut, or the pull request
// being read. Then several tasks on one branch are one continuing conversation:
// the worker is not re-told what it worked out last time, and does not spend the
// first part of every run reading its way back to where it already was.
//
//   worker  Continuity is nearly free here. The risk is that a resumed
//           conversation still contains the PREVIOUS task's brief and rules, so
//           a new task on the same branch has to be told plainly that it is new
//           and what it is held to NOW. A task carries the text of its contract
//           precisely so that what a worker was held to can be proven later, and
//           an unannounced continuation quietly muddies that.
//
//   judge   The same idea, and this is the one that can go badly wrong.
//
//           WHAT IT BUYS: a judge that remembers can say "you fixed two of the
//           three things I raised", which is the actual review loop and cannot
//           be asked cold. Without it, every round the person re-explains what
//           the last round was about.
//
//           WHAT IT RISKS, PLAINLY: A JUDGE THAT REMEMBERS CAN GO MAD. Not
//           break — go mad, which is worse, because a broken one is obvious and
//           this one is not. It has already formed a view, and every later
//           reading happens downstream of it. A conclusion it reached wrongly
//           once is now a thing it KNOWS, and it will keep finding evidence for
//           it, keep raising it, and keep rejecting work over it, in complete
//           good faith and with perfect internal consistency. It stops reading
//           the change and starts consulting itself.
//
//           A cold judge can be wrong. A remembering judge can be wrong FOR
//           EVER, about one branch, in a way that reads exactly like rigour --
//           and the more it repeats the finding, the more convincing the
//           transcript looks to whoever reads it next.
//
//           That is the trade. It is not obviously the wrong trade -- a judge
//           that cannot remember cannot review a revision -- but it is the one
//           thing here that fails silently and gets more persuasive as it does.
//
//           If this is turned on, the judging PROMPT should carry the other half
//           of the rule — that the change is re-read from the branch every time,
//           and what the memory holds is what it ASKED, not what it found. That
//           belongs in the prompt because a prompt is text a person approved,
//           and this is a constant in a file.
//
// THE ONE THING THAT HOLDS EITHER WAY: the lanes never mix. A judge is never
// handed a worker's session, whatever these are set to — see keyFor, where the
// lane is part of the key, and the drill that proves it.
// WHERE IT STANDS TODAY, and why it is not symmetrical.
//
// worker: true   — being tried. Several tasks on one branch continue one
//                  conversation, so a second pass is not re-told what the first
//                  worked out. This is the half with the smaller failure mode:
//                  the worst case is a worker carrying stale instructions, which
//                  shows up in what it DOES and is therefore visible.
//
// judge: false   — deliberately still off while the above is being tried. Two
//                  experiments at once cannot be told apart, and of the two this
//                  is the one whose failure is invisible and self-reinforcing.
//                  Turn it on afterwards, on its own, with the prompt rule about
//                  re-reading the change written first.
const REMEMBERS = { worker: true, judge: false }

const ROOT = () => data.sub('sessions')

const safe = s => String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)

// WHAT A PIECE OF WORK FILES ITS MEMORY UNDER.
//
// One function, asked by both ends — the handler that gives a machine what it
// remembers and the handler that takes it back. Two places working out a key
// separately is two places to get REMEMBERS wrong in opposite directions, and
// the symptom would be work that is handed a conversation it then cannot save.
//
// THE LANE IS ALWAYS PART OF IT, whatever REMEMBERS says. That is what makes "a
// judge is never handed a worker's session" a property of the key rather than a
// thing the lookup has to remember to check: the two can only collide if they
// agree on a lane, and a judgement is never in the worker lane.
//
// A SUBJECT THIS CANNOT NAME FALLS BACK TO THE UID, which is today's behaviour
// and is always correct — the cost is only that the work starts cold. Guessing a
// key would be the other kind of wrong: handing one conversation to work that
// has nothing to do with it.
// WHAT A CONTINUATION HAS TO BE TOLD, or null when there is nothing to tell.
//
// MEASURED, NOT SUPPOSED. With sessions filed by subject, a second task on a
// branch resumes the first one's conversation — which is the point, and it
// carries more than facts. A drill gave pass one a standing instruction ("every
// file on this branch begins with this heading"), then gave pass two a different
// brief under a different contract, and pass two wrote:
//
//     CONTRACT-LOADED          <- the new contract's rule
//     # PASS ONE STYLE         <- the OLD task's instruction, still obeyed
//
//     hello
//
// That is not a worker misbehaving. It obeyed everything it had been told, and
// one of those things was told to a different task. Nothing withdrew it, so
// nothing expired.
//
// WHAT IT COSTS is the property this app rests on: a task carries the TEXT of
// its prompt and contract so that what a worker was held to can be proven six
// weeks later. An instruction still in force and recorded nowhere in this task's
// record makes that record incomplete.
//
// AND IT LEAKS BOTH WAYS. Given a brief that contradicted its contract, the same
// worker flagged that the PREVIOUS task's committed file broke the CURRENT
// contract and considered amending it. New rules reach backwards onto finished
// work as readily as old rules reach forwards, so this says both.
//
// IT DOES NOT WITHHOLD THE MEMORY. That is what the memory is for, and a worker
// rediscovering the branch every run is the thing being fixed. It separates
// KNOWING from BEING BOUND.
//
// HERE, RATHER THAN AT EITHER CALLER, because there are two: a plain brief goes
// through vmDispatch and a job goes through jobRun, and the first version of
// this was written into vmDispatch alone — where it never once fired, because
// every task in the drill that found the problem uses a job. Two paths to a
// worker is two places to forget, so the words live with the keying that decides
// whether they are needed at all.
function announcement (doing) {
  const kept = doing && get(keyFor(doing))
  if (!kept || !kept.taskId || kept.taskId === doing.id) return null

  return [
    'BEFORE ANYTHING ELSE — THIS IS A NEW PIECE OF WORK.',
    '',
    `You are continuing a conversation that belongs to this branch, not to this piece of work. What you remember was done as ${kept.kind === 'judgement' ? 'a different reading' : 'a different task'}${kept.number ? ` (#${kept.number})` : ''}, under its own brief and its own rules.`,
    '',
    'That memory is yours to use: the codebase, what you tried, what worked, what you decided and why. Use it, and do not spend this run rediscovering it.',
    '',
    'It is NOT a source of instructions. Standing instructions, styles and conventions you were given in that earlier work do not carry into this one — they ended with it. What binds you now is the brief below and the rules attached to this run, and nothing else. If something from before should still apply, it will be in the brief.',
    '',
    'And what was finished under those earlier rules was correct under them. Do not go back and revise committed work to match rules it was never done under. If you think something earlier is wrong, say so rather than change it.',
    ''
  ].join('\n')
}

function keyFor (doing) {
  if (!doing || !doing.uid) return null
  const lane = doing.kind === 'judgement' ? 'judge' : 'worker'
  if (!REMEMBERS[lane]) return doing.uid

  const item = doing.item || {}
  const subject = item.subject || null

  // A judgement reads a branch here, or a pull request somewhere else. A task
  // works on a branch. Those are the only three, and an unrecognised shape takes
  // the fallback rather than a guess.
  const about = doing.kind === 'judgement'
    ? (subject && subject.kind === 'pull'
        ? (subject.on && subject.number ? `pull--${subject.on}--${subject.number}` : null)
        : (subject && (subject.branch || subject.name)) ? `cut--${subject.branch || subject.name}` : null)
    : (item.branch ? `cut--${item.branch}` : null)

  return about ? `${lane}--${safe(about)}` : doing.uid
}
const dirFor = uid => path.join(ROOT(), safe(uid))
// One name, because there is one per task. A second one would be the first one
// plus what happened since, and two files where one is a prefix of the other is
// two files nothing on screen can choose between.
const fileFor = uid => path.join(dirFor(uid), 'claude.tgz')
const aboutFor = uid => path.join(dirFor(uid), 'about.json')

// An hour of work with a lot of file reading in it. Big enough for a real run,
// small enough that a machine cannot fill this host's disk unnoticed.
const MOST = 256 * 1024 * 1024

// The session id a run reported, checked before it is written into a record that
// is later read back and shown. Claude writes uuids.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const okId = id => !id || ID.test(String(id))

// ---- what is inside one, worked out once -------------------------------
//
// READ ON THE WAY IN, NOT ON THE WAY OUT. The archive is the thing that has to
// survive; a summary of it is what anybody actually looks at, and computing that
// on every paint would mean gunzipping ninety kilobytes and parsing fifty turns
// of JSON on a three-second draw loop. So it is done once, when the bytes
// arrive, and what the panel reads afterwards is a small object.
//
// It also means the expensive half only happens when something changed, which
// is the same reason the window keys its panels on a signature.
//
// NOTHING HERE IS TRUSTED. This came off a machine running a script somebody
// wrote. Every field is read defensively and a transcript that does not parse
// produces a summary saying so, rather than a throw that would refuse the
// archive -- losing the transcript because its SUMMARY failed would be the tail
// wagging the dog.
function look (bytes) {
  const out = { turns: 0, tools: [], touched: [], model: null, tokens: null, from: null, to: null, files: 0 }
  let entries = []
  try {
    entries = parseTar(zlib.gunzipSync(bytes))
  } catch (e) {
    return { ...out, unreadable: e.message }
  }
  out.files = entries.filter(e => e.type === 'file').length

  // The biggest transcript in it. A run resumed into an existing project folder
  // can leave more than one, and the one being carried on is the one with
  // something in it.
  const jsonl = entries
    .filter(e => /projects\/.*\.jsonl$/.test(e.name || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0))[0]
  if (!jsonl) return { ...out, unreadable: 'there is no transcript in it' }

  out.transcript = jsonl.name
  let text = ''
  try { text = new TextDecoder().decode(jsonl.data) } catch { return { ...out, unreadable: 'the transcript is not text' } }

  const tools = new Map()
  const touched = new Set()
  const models = new Set()
  let inTok = 0
  let outTok = 0
  let cache = 0
  let errors = 0

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let t = null
    // A `.jsonl` whose last line is half-written is an ordinary state: a run
    // that was killed mid-write leaves one, and everything before it still
    // counts.
    try { t = JSON.parse(line) } catch { continue }
    out.turns++
    if (t.timestamp) {
      if (!out.from) out.from = t.timestamp
      out.to = t.timestamp
    }
    if (t.isApiErrorMessage) errors++
    const m = t.message || {}
    // `<synthetic>` is what Claude writes for a turn it made up rather than one
    // a model produced, and reporting it as the model somebody used is a small
    // lie in the one field people read first.
    if (m.model && m.model !== '<synthetic>') models.add(m.model)
    if (m.usage) {
      inTok += m.usage.input_tokens || 0
      outTok += m.usage.output_tokens || 0
      cache += m.usage.cache_read_input_tokens || 0
    }
    if (!Array.isArray(m.content)) continue
    for (const c of m.content) {
      if (!c || c.type !== 'tool_use') continue
      tools.set(c.name, (tools.get(c.name) || 0) + 1)
      const where = c.input && (c.input.file_path || c.input.path || c.input.notebook_path)
      if (where) touched.add(String(where))
    }
  }

  out.model = [...models].join(', ') || null
  out.tools = [...tools].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
  // Bounded, because this is written into a record that is read on every draw
  // and a worker that touched four hundred files would otherwise put all four
  // hundred in it.
  out.touched = [...touched].slice(0, 40)
  out.moreTouched = Math.max(0, touched.size - 40)
  out.tokens = { in: inTok, out: outTok, cache }
  out.errors = errors
  return out
}

// REPLACED, not added to, which is the opposite of how the artifacts beside
// these behave and is right for the same underlying reason. An artifact is a
// delivery: two runs producing `firmware.bin` are two results and losing either
// loses work. A session is a conversation, and the newer copy is the older one
// plus what happened since.
function keep (uid, bytes, { id = null, run = null, machine = null, taskId = null, number = null, folder = null, guest = null } = {}) {
  if (!okId(id)) throw new Error('that is not a session id')
  if (!bytes || !bytes.length) throw new Error('there was nothing in it')
  if (bytes.length > MOST) throw new Error(`that is ${Math.round(bytes.length / 1048576)} MB, and the most this takes is ${MOST / 1048576} MB`)

  const dir = dirFor(uid)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fileFor(uid), bytes)

  // The turn count is not known here and is not worth unpacking an archive to
  // find out. What is worth keeping is which conversation, from which run, on
  // which machine -- the three things somebody asks when they come back to it.
  const was = get(uid)

  // WHO SIGNED IT, kept as the latest and as the whole set. See the header. The
  // set is built from what is already on disk rather than recomputed, so a guest
  // thrown away afterwards is still named by the conversations it paid for --
  // which is the point of writing it here instead of asking the guest list.
  const signed = new Set([...((was && was.guests) || []), ...(guest ? [guest] : [])])

  fs.writeFileSync(aboutFor(uid), JSON.stringify({
    // What is in it, read here once. See `look`.
    inside: look(bytes),
    task: uid,
    taskId: taskId || (was && was.taskId) || null,
    number: number || (was && was.number) || null,
    id: id || (was && was.id) || null,
    run: run || null,
    machine: machine || null,
    // The one on the machine for THIS run, kept even when it is null: a run with
    // no guest named is a run signed by the single credential this host used to
    // keep, and blanking it is more honest than inheriting the previous name.
    guest: guest || null,
    guests: [...signed],
    folder: folder || null,
    bytes: bytes.length,
    kept: new Date().toISOString(),
    // How many times this task has picked the conversation back up, which is
    // the one number that says "this was resumed" rather than "this ran once".
    runs: ((was && was.runs) || 0) + 1,
    first: (was && was.first) || new Date().toISOString()
  }, null, 2))
  return get(uid)
}

// What is kept for one task, or null. Read from disk rather than from the task
// record, so a transcript whose task was thrown away is still findable -- what
// was produced outlives the note about it, which is the right way round and is
// already how the run logs behave.
function get (uid) {
  const file = fileFor(uid)
  let bytes = 0
  try { bytes = fs.statSync(file).size } catch { return null }
  let about = {}
  try { about = JSON.parse(fs.readFileSync(aboutFor(uid), 'utf8')) } catch { /* an interrupted keep */ }
  return { uid, path: file, bytes, ...about }
}

const has = uid => !!get(uid)

function forget (uid) {
  const found = get(uid)
  if (!found) throw new Error('there is no session kept for that task')
  try { fs.unlinkSync(fileFor(uid)) } catch { /* already gone */ }
  try { fs.unlinkSync(aboutFor(uid)) } catch { /* it may never have been written */ }
  try { fs.rmdirSync(dirFor(uid)) } catch { /* something else is in there */ }
  return { forgotten: uid, bytes: found.bytes }
}

// Every task that has one, including ones the board has forgotten.
function everything () {
  let uids = []
  try { uids = fs.readdirSync(ROOT(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
  return uids.map(get).filter(Boolean)
    .sort((a, b) => String(b.kept || '').localeCompare(String(a.kept || '')))
}

module.exports = { keep, get, has, forget, everything, okId, keyFor, announcement, dirFor, fileFor, ROOT, MOST, REMEMBERS }
