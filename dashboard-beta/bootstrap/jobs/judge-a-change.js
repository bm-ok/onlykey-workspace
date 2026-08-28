'use strict'

// JUDGE A CHANGE: give the brief to a worker, then check it answered in the
// shape a judgement has to be in.
//
// A JUDGE READS AND DOES NOT WRITE. The host refuses a push from a machine that
// is running a judgement -- see the git route in server.js -- so this job never
// needs to police that. What it polices is the ANSWER: a judgement that does not
// say what it found, or does not end in a recommendation, is not a judgement,
// and it is better to fail here than to file an empty opinion against a change.
//
// WHAT COMES BACK IS THE POINT. A supervisor learns nothing about the codebase
// except through what a judge hands over, so a run that reads everything and
// hands back nothing has told the rest of this app precisely nothing.
module.exports = async ({ prompt, claude, log, report, sh, artifact, verdict, workspace, machine, run }) => {
  const fs = require('node:fs')
  const path = require('node:path')

  const FILE = path.join(workspace, 'JUDGEMENT.md')
  const HEADING = '# Judgement'

  log(`judging on ${machine}, in ${workspace}`)

  // Cleared first, so what is checked below is what THIS run produced. A file
  // left by an earlier run would pass every check without a worker having read
  // anything -- the quietest possible false pass.
  try { fs.unlinkSync(FILE); log('removed a JUDGEMENT.md left by an earlier run') } catch { /* there was none */ }

  // WHAT IS ACTUALLY ON THIS BRANCH, recorded before the worker starts, so the
  // run itself says what was in front of it rather than relying on the worker's
  // account. Per repository, because a change is across them.
  await report('looking at what the branch carries')
  let seen = ''
  try {
    seen = sh('for d in */; do if [ -d "$d/.git" ]; then echo "== $d"; git -C "$d" log --oneline -n 20 2>/dev/null | head -20; fi; done')
    for (const line of String(seen).trim().split('\n')) log('  ' + line)
  } catch (e) {
    log(`could not survey the repositories: ${e.message}`)
  }

  // ---- the judge ----------------------------------------------------------
  await report('a worker is reading the change')
  const t0 = Date.now()
  const said = claude()
  log(`it finished in ${Math.round((Date.now() - t0) / 1000)}s -- ${said.turns} turn(s)` +
    (said.cost == null ? '' : `, ${said.cost.toFixed(4)} USD`))

  // ---- did it answer in the shape a judgement has to be in? ---------------
  await report('checking the judgement is a judgement')

  if (!fs.existsSync(FILE)) {
    throw new Error('it read the change and wrote no JUDGEMENT.md, whatever it said about it -- there is nothing to file')
  }
  const text = fs.readFileSync(FILE, 'utf8')
  const lines = text.trim().split('\n')

  if (lines[0].trim() !== HEADING) {
    throw new Error(`JUDGEMENT.md starts "${lines[0].trim()}" and a judgement starts "${HEADING}"`)
  }
  if (!/^##\s+Findings/m.test(text)) {
    throw new Error('JUDGEMENT.md has no "## Findings" section, so there is no way to tell what it found from what it thought')
  }

  const last = lines[lines.length - 1].trim()
  const said_it = /^RECOMMENDATION:\s*(accept|reject)$/i.exec(last)
  if (!said_it) {
    throw new Error(`the last line is "${last}" and it has to be exactly "RECOMMENDATION: accept" or "RECOMMENDATION: reject" -- a judgement that will not say which is one that has not been made`)
  }
  const recommendation = said_it[1].toLowerCase()

  // NOT A VERDICT, AND THE WORDING MATTERS. A person records the verdict, having
  // read the findings. This is what the judge would do.
  log(`it recommends: ${recommendation}`)
  const findings = (text.split(/^##\s+Findings/m)[1] || '').split(/^##\s/m)[0].trim()
  log(`findings: ${/^none$/i.test(findings) ? 'none' : findings.split('\n').filter(Boolean).length + ' line(s)'}`)

  // ---- hand it back -------------------------------------------------------
  //
  // The machine goes back to its snapshot when this ends, and a judge may not
  // push, so a file that was not handed over did not survive and nothing on the
  // host will ever know what this read.
  await report('handing the judgement back')
  await artifact(FILE, 'JUDGEMENT.md')
  log('handed back JUDGEMENT.md')

  // ---- and the verdict, which is this judge's own -------------------------
  //
  // AFTER THE HANDOFF, DELIBERATELY. The findings are the evidence and this is
  // the conclusion; concluding without handing anything over would publish a
  // verdict nobody can check.
  //
  // THE ONE WHO READ IT SAYS. Not the supervisor, which commissioned the reading
  // and cannot see the code; not a person, unless the person is the judge. This
  // host looks up which judgement this machine is reading -- there is no
  // argument here that could point at somebody else's change.
  //
  // IT THROWS IF IT DOES NOT ARRIVE, like the handoff above: a reading whose
  // verdict never landed is one nothing will act on.
  // accept and reject are what the brief asks for, and they are the verdict.
  const said_verdict = recommendation === 'accept' ? 'accept' : 'reject'
  await verdict(said_verdict, /^none$/i.test(findings) ? 'nothing found that should stop this landing' : findings.slice(0, 1500))
  log(`verdict sent: ${said_verdict}`)


  // AND THE WORKSPACE IS UNTOUCHED, which is the contract's first rule. Said out
  // loud rather than assumed: a judge that edited something has broken the one
  // promise that makes its reading worth anything.
  let dirty = ''
  try { dirty = sh('for d in */; do if [ -d "$d/.git" ]; then git -C "$d" status --porcelain; fi; done').trim() } catch { /* not a workspace */ }
  if (dirty) {
    log('WARNING -- the judge left changes in the workspace:')
    for (const line of dirty.split('\n')) log('  ' + line)
  } else {
    log('the workspace is as it was found')
  }

  return {
    machine,
    run,
    prompt: prompt.id,
    recommendation,
    findings: /^none$/i.test(findings) ? 'none' : 'some',
    turns: said.turns,
    cost: said.cost == null ? null : Number(said.cost.toFixed(4)),
    session: said.session,
    wrote: 'JUDGEMENT.md',
    workspaceTouched: !!dirty
  }
}
