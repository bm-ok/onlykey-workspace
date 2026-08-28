'use strict'

// DO WHAT THE TASK SAYS, AND LET THE BRANCH BE THE ANSWER.
//
// The plainest job there is, and the one this host was missing. Every other job
// here does something specific -- survey a codebase, check a claim, tour the API
// -- and an ordinary "make this change" task had nothing to run: a task with no
// job is handed over to a person rather than worked on, which is right, and left
// no way to simply give a brief to a worker.
//
// IT CHECKS ALMOST NOTHING, deliberately. What the work IS varies by task, so
// there is nothing here to assert about it -- the branch is the deliverable and a
// judge reads it afterwards. What this job is for is the three things that are
// true whatever the task says: give the brief to a worker, notice whether
// anything was actually committed, and say so.
//
// NOTHING IS PUSHED FROM HERE. The worker pushes its own branch, which is what
// the machine was set up to allow and what its skill tells it to do. A job that
// pushed on the worker's behalf would be a job taking credit for work it cannot
// see.
module.exports = async ({ prompt, claude, log, report, sh, workspace, machine, run }) => {
  log(`working on ${machine}, in ${workspace}`)

  // WHERE EACH REPOSITORY STARTS, so "what changed" is measured rather than
  // guessed at from what the worker says it did.
  const before = {}
  for (const repo of sh('ls -1').trim().split('\n').filter(Boolean)) {
    try { before[repo] = sh(`git -C ${repo} rev-parse HEAD 2>/dev/null || true`).trim() } catch { /* not a repository */ }
  }

  await report('a worker is doing the work')
  const t0 = Date.now()
  const said = claude()
  log(`it finished in ${Math.round((Date.now() - t0) / 1000)}s -- ${said.turns} turn(s)` +
    (said.cost == null ? '' : `, ${said.cost.toFixed(4)} USD`))

  await report('looking at what changed')

  // WHAT IT ACTUALLY DID, per repository: committed, and whether anything is
  // still sitting uncommitted. Both are worth saying -- work left uncommitted
  // dies with the machine, and that is the most expensive way to fail here.
  const moved = []
  const dirty = []
  for (const repo of Object.keys(before)) {
    let now = ''
    try { now = sh(`git -C ${repo} rev-parse HEAD 2>/dev/null || true`).trim() } catch { /* as above */ }
    if (now && now !== before[repo]) moved.push(repo)
    let untidy = ''
    try { untidy = sh(`git -C ${repo} status --porcelain`).trim() } catch { /* as above */ }
    if (untidy) dirty.push(`${repo} (${untidy.split('\n').length} file(s))`)
  }

  if (moved.length) log(`committed in: ${moved.join(', ')}`)
  else log('NOTHING WAS COMMITTED -- whatever was done did not leave this machine')

  if (dirty.length) {
    log(`WARNING -- uncommitted changes left behind in ${dirty.join(', ')}`)
    log('those die with the machine when this run ends')
  }

  await report('done')

  return {
    machine,
    run,
    prompt: prompt ? prompt.id : null,
    committedIn: moved,
    leftUncommitted: dirty,
    turns: said.turns,
    cost: said.cost == null ? null : Number(said.cost.toFixed(4)),
    session: said.session
  }
}
