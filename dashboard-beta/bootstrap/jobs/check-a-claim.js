'use strict'

// IS THIS CLAIM TRUE OF THE CODE? The judge that turns an issue into a fact.
//
// Nothing downstream can read the code -- a supervisor deciding what to do next
// has only what a judge hands back -- so "somebody says X is broken" stays a
// rumour until this has run. Acting on the rumour is a machine spending twenty
// minutes fixing something that was never wrong.
//
// IT READS AND DOES NOT WRITE, like every judge: the contract says so and the
// host refuses a push from this machine anyway.
module.exports = async ({ prompt, claude, log, report, sh, artifact, verdict, workspace, machine, run }) => {
  const fs = require('node:fs')
  const path = require('node:path')

  const FILE = path.join(workspace, 'CLAIM.md')
  const HEADING = '# The claim'
  const WANTED = ['What was claimed', 'Where the code is', 'What the code actually does', 'How bad', 'Not read']

  log(`checking a claim on ${machine}, in ${workspace}`)

  // THE CLAIM ITSELF HAS TO BE THERE. This job is pointless without one, and the
  // cheap moment to find that out is here rather than after a worker has spent
  // ten minutes reading a codebase with no question in front of it.
  if (!/What you are being asked about/i.test(prompt.text || '')) {
    throw new Error('this judge was given no claim to check -- pass the issue as the question when asking for the judgement, or it has nothing to look for')
  }

  try { fs.unlinkSync(FILE); log('removed a CLAIM.md left by an earlier run') } catch { /* there was none */ }

  await report('a worker is checking the claim')
  const t0 = Date.now()
  const said = claude()
  log(`it finished in ${Math.round((Date.now() - t0) / 1000)}s -- ${said.turns} turn(s)` +
    (said.cost == null ? '' : `, ${said.cost.toFixed(4)} USD`))

  await report('checking the answer settles the question')

  if (!fs.existsSync(FILE)) {
    throw new Error('it checked the claim and wrote no CLAIM.md, whatever it said about it -- there is nothing to hand back')
  }
  const text = fs.readFileSync(FILE, 'utf8')
  const lines = text.trim().split('\n')

  // HANDED BACK BEFORE IT IS CHECKED, and the order is the whole point.
  //
  // Everything below this line can throw: the heading is wrong, a section is
  // missing, the last line is not one of the three words. Those are worth
  // failing on -- a conclusion nothing can read is not a conclusion. But the
  // checks used to come FIRST, so a judge that read three repositories for two
  // and a half minutes and wrote a full answer with a slightly wrong last line
  // handed back NOTHING. The file existed on the machine, and the machine was
  // rolled back a few seconds later.
  //
  // That happened: J41, 154 seconds of reading, 0.77 USD, exit 1, "nothing
  // handed back" -- and the supervisor then had no way to find out why, because
  // taskLog does not take a judgement.
  //
  // So the artifact goes first. A malformed answer now costs its CONCLUSION,
  // which is right, and not the reading, which is the expensive part and is
  // still perfectly readable by a person.
  await artifact(FILE, 'CLAIM.md')
  log('handed CLAIM.md back before checking it — whatever else happens, the reading is not lost')

  if (lines[0].trim() !== HEADING) {
    throw new Error(`CLAIM.md starts "${lines[0].trim()}" and this answer starts "${HEADING}"`)
  }

  const missing = WANTED.filter(h => !new RegExp('^##\\s+' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'mi').test(text))
  if (missing.length) {
    throw new Error(`the answer has no section for: ${missing.join(', ')}`)
  }

  const last = lines[lines.length - 1].trim()
  // NOT `verdict`. That name is already taken by the job API's own function --
  // the one that SENDS this judge's conclusion, destructured at the top of this
  // file -- and declaring a const over it in the same scope is a redeclaration,
  // which means the file does not load at all. It was written that way, was
  // approved, was listed as runnable, and died at `require` on a machine that
  // had just booted, taken a credential and cloned the workspace.
  const claimLine = /^CLAIM:\s*(true|false|unclear)$/i.exec(last)
  if (!claimLine) {
    throw new Error(`the last line is "${last}" and it has to be exactly "CLAIM: true", "CLAIM: false" or "CLAIM: unclear"`)
  }
  const answer = claimLine[1].toLowerCase()
  log(`the claim is: ${answer}`)

  await report('the answer settles the question')

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
  // A CLAIM IS NOT A CHANGE, so the mapping is worth being explicit about.
  // "true" means there IS something wrong -- the claim holds -- which is a
  // rejection of the code as it stands, not an acceptance of the report. "false"
  // means nothing to do. "unclear" is pending: read, and not settled.
  const said_verdict = answer === 'true' ? 'reject' : answer === 'false' ? 'accept' : 'pending'
  await verdict(said_verdict, answer === 'true' ? text.split(/^##\s+What the code actually does/m)[1] ? text.split(/^##\s+What the code actually does/m)[1].split(/^##\s/m)[0].trim().slice(0, 1500) : 'the claim holds -- see CLAIM.md' : 'the claim does not hold against this code')
  log(`verdict sent: ${said_verdict}`)


  let dirty = ''
  try { dirty = sh('for d in */; do if [ -d "$d/.git" ]; then git -C "$d" status --porcelain; fi; done').trim() } catch { /* not a workspace */ }
  if (dirty) {
    log('WARNING -- checking the claim left changes in the workspace:')
    for (const line of dirty.split('\n')) log('  ' + line)
  } else {
    log('the workspace is as it was found')
  }

  return {
    machine,
    run,
    prompt: prompt.id,
    claim: answer,
    wrote: 'CLAIM.md',
    turns: said.turns,
    cost: said.cost == null ? null : Number(said.cost.toFixed(4)),
    session: said.session,
    workspaceTouched: !!dirty
  }
}
