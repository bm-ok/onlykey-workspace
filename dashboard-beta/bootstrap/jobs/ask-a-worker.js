'use strict'

// GIVE THE PROMPT TO A WORKER, ON THIS MACHINE, AND CHECK WHAT IT DID.
//
// The shape this whole arrangement is for, in one file: a prompt is the brief, a
// job is the orchestration around it, and the work happens on a machine that
// gets rolled back afterwards. Everything before this could survey a machine and
// hand files back; the work itself had to be dispatched as a task, which is the
// dashboard's job and not a job's. `claude()` is the piece that was missing.
//
// It does not trust the worker's own account of itself. A worker that ran and
// declined exits zero and says so in prose, so what is checked here is the FILE
// it was asked to write — which is the same rule the task board is built to:
// where the account and the work disagree, the work is right.
module.exports = async ({ prompt, claude, log, report, sh, artifact, workspace, machine, run }) => {
  const fs = require('node:fs')
  const path = require('node:path')

  log(`on ${machine}, in ${workspace}`)
  log(`the brief is "${prompt.name}" (${prompt.text.trim().split('\n').length} lines)`)

  const NOTES = path.join(workspace, 'NOTES.md')
  const HEADING = '# What is on this machine'

  // Cleared first, so what is checked afterwards is what THIS run produced. A
  // file left by an earlier run would pass every check below without a worker
  // having done anything at all — the quietest possible false pass.
  try { fs.unlinkSync(NOTES) ; log('removed a NOTES.md left by an earlier run') } catch { /* there was none */ }

  // ---- the worker ---------------------------------------------------------
  //
  // Nothing else in this job runs while this does — it is synchronous, and a
  // worker takes minutes — so the progress it can report is on either side of
  // it rather than during.
  await report('a worker is reading the brief')
  const t0 = Date.now()
  // No argument: the brief IS the prompt this job was run with, which is the
  // ordinary case and the reason the helper defaults to it.
  const said = claude()
  log(`the worker finished in ${Math.round((Date.now() - t0) / 1000)}s — ${said.turns} turn(s)` +
    (said.cost == null ? '' : `, ${said.cost.toFixed(4)} USD`))
  await report('checking what it actually did')

  // What it says it did, kept in the run's own output so the two accounts sit
  // beside each other and can be compared later.
  log('--- the worker said ---')
  for (const line of String(said.text).trim().split('\n')) log('  ' + line)
  log('--- end ---')

  // ---- what it actually did ------------------------------------------------
  if (!fs.existsSync(NOTES)) {
    throw new Error(`the worker did not write ${NOTES}, whatever it said about it`)
  }
  const notes = fs.readFileSync(NOTES, 'utf8')
  const firstLine = notes.split('\n')[0].trim()
  if (firstLine !== HEADING) {
    throw new Error(`the file starts "${firstLine}" and the brief asked for "${HEADING}"`)
  }
  log(`NOTES.md is there — ${notes.split('\n').length} lines, ${notes.length} characters`)

  // ---- a second turn, on the same conversation ---------------------------
  //
  // No session id is passed and none could be: the API restores what this TASK
  // remembers before every worker it starts, and hands it back afterwards. So
  // the second call is already the same conversation, and a job asking to
  // resume some other one is refused rather than quietly obeyed.
  await report('asking the same worker a follow-up')
  const second = claude(
    'Append one final line to the NOTES.md you just wrote, exactly: ' +
    `"Written on ${machine} during run ${run}." Change nothing else.`
  )
  const after = fs.readFileSync(NOTES, 'utf8').trim()
  const last = after.split('\n').pop().trim()
  log(`the last line is now: ${last}`)
  if (!last.includes(run)) log('NOTE — the follow-up did not land; the worker may not have carried on from the first turn')

  // ---- hand it back --------------------------------------------------------
  //
  // The machine goes back to its snapshot when this ends, so a file that was not
  // handed over did not survive.
  await report('handing the notes back')
  await artifact(NOTES, 'NOTES.md')
  log('handed back NOTES.md')

  // Where the folder stands afterwards, so a job that left the workspace dirty
  // says so rather than leaving it to be discovered.
  let dirty = ''
  try { dirty = sh('git status --porcelain 2>/dev/null || true').trim() } catch { /* not a repository */ }
  if (dirty) log(`the folder has ${dirty.split('\n').length} uncommitted change(s)`)

  await report('done')

  return {
    machine,
    workspace,
    prompt: prompt.id,
    turns: said.turns + (second ? second.turns : 0),
    cost: said.cost == null ? null : Number((said.cost + (second && second.cost ? second.cost : 0)).toFixed(4)),
    session: said.session,
    resumed: true,
    wrote: 'NOTES.md',
    lines: notes.split('\n').length
  }
}
