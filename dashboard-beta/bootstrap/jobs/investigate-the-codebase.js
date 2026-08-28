'use strict'

// WHAT IS THIS CODEBASE. The first judge anything should run, because a
// supervisor knows about the code only through what a judge hands back -- so
// until this has run, nothing in this app knows what it is looking at.
//
// A SURVEY, NOT A REVIEW. It changes nothing, and the contract it runs under
// says so in more detail. This job's own work is to check the answer is the
// shape a survey has to be in, and to hand it back -- a run that reads
// everything and hands back nothing has told the rest of this app precisely
// nothing.
module.exports = async ({ prompt, claude, log, report, sh, artifact, verdict, workspace, machine, run }) => {
  const fs = require('node:fs')
  const path = require('node:path')

  const FILE = path.join(workspace, 'CODEBASE.md')
  const HEADING = '# What this codebase is'

  // Every heading the brief asks for. Checked rather than trusted, because a
  // survey missing a section is a survey with a hole in exactly the place
  // somebody will later assume was covered.
  const WANTED = [
    'What it is',
    'How they relate',
    'How it is built, tested and run',
    'The shape of it',
    'The conventions it keeps',
    'Where the risk is',
    'What would be worth doing',
    'Not read'
  ]

  log(`surveying on ${machine}, in ${workspace}`)

  try { fs.unlinkSync(FILE); log('removed a CODEBASE.md left by an earlier run') } catch { /* there was none */ }

  // WHAT IS ACTUALLY HERE, recorded before the worker starts, so the run says
  // what was in front of it rather than relying on the worker's account.
  await report('looking at what is in the folder')
  try {
    const seen = sh('ls -1; echo; for d in */; do if [ -d "$d/.git" ]; then echo "== $d $(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)"; fi; done')
    for (const line of String(seen).trim().split('\n')) log('  ' + line)
  } catch (e) {
    log(`could not list the folder: ${e.message}`)
  }

  await report('a worker is reading the codebase')
  const t0 = Date.now()
  const said = claude()
  log(`it finished in ${Math.round((Date.now() - t0) / 1000)}s -- ${said.turns} turn(s)` +
    (said.cost == null ? '' : `, ${said.cost.toFixed(4)} USD`))

  await report('checking the survey is a survey')

  if (!fs.existsSync(FILE)) {
    throw new Error('it read the codebase and wrote no CODEBASE.md, whatever it said about it -- there is nothing to hand back, and nothing here would know anything')
  }
  const text = fs.readFileSync(FILE, 'utf8')
  const lines = text.trim().split('\n')

  if (lines[0].trim() !== HEADING) {
    throw new Error(`CODEBASE.md starts "${lines[0].trim()}" and a survey starts "${HEADING}"`)
  }

  const missing = WANTED.filter(h => !new RegExp('^##\\s+' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'mi').test(text))
  if (missing.length) {
    throw new Error(`the survey has no section for: ${missing.join(', ')}. A missing section is a hole where somebody will later assume there was an answer`)
  }

  // SHORT IS A FINDING, NOT A FAILURE. A survey of an empty folder is legitimately
  // brief; one of four repositories is not. Said rather than refused, because
  // this job cannot tell which it is looking at and should not pretend to.
  log(`CODEBASE.md is there -- ${lines.length} lines, ${text.length} characters`)
  if (text.length < 800) log('NOTE -- that is very short for a codebase survey; read it before trusting it')

  await report('handing the survey back')
  await artifact(FILE, 'CODEBASE.md')
  log('handed back CODEBASE.md')

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
  // A SURVEY SETTLES NOTHING, and says so. It was not asked whether anything
  // should land -- it was asked what this codebase IS -- so anything other than
  // "pending" here would be this judge answering a question nobody put to it.
  const said_verdict = 'pending'
  await verdict(said_verdict, 'a survey, not a judgement of a change -- read CODEBASE.md')
  log(`verdict sent: ${said_verdict}`)


  let dirty = ''
  try { dirty = sh('for d in */; do if [ -d "$d/.git" ]; then git -C "$d" status --porcelain; fi; done').trim() } catch { /* not a workspace */ }
  if (dirty) {
    log('WARNING -- the survey left changes in the workspace:')
    for (const line of dirty.split('\n')) log('  ' + line)
  } else {
    log('the workspace is as it was found')
  }

  return {
    machine,
    run,
    prompt: prompt.id,
    wrote: 'CODEBASE.md',
    lines: lines.length,
    characters: text.length,
    sections: WANTED.length - missing.length,
    turns: said.turns,
    cost: said.cost == null ? null : Number(said.cost.toFixed(4)),
    session: said.session,
    workspaceTouched: !!dirty
  }
}
