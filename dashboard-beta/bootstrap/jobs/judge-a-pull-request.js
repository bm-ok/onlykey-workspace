'use strict'

// JUDGE A PULL REQUEST THAT ARRIVED.
//
// The change is already in this workspace as a branch -- the host fetched it
// from the parent's refs/pull/<n>/head before this ran, and a person allowed
// that commit. This job gives it to a worker under the reading contract,
// collects the report, and sends the verdict.
//
// IT RUNS NOTHING FROM THE CHANGE. There is no build step here and no test run,
// deliberately: the contract forbids the worker from running it, and a job that
// ran it on the worker's behalf would be the same code executing with the same
// credential present. What the worker cannot answer without running it is
// reported as a gap instead.
module.exports = async ({ prompt, claude, log, report, sh, artifact, verdict, workspace, machine, run }) => {
  log(`reading a pull request on ${machine}, in ${workspace}`)

  await report('reading the change')
  const t0 = Date.now()
  const said = claude()
  log(`it finished in ${Math.round((Date.now() - t0) / 1000)}s -- ${said.turns} turn(s)` +
    (said.cost == null ? '' : `, ${said.cost.toFixed(4)} USD`))

  // WHAT IT WROTE, AND NOTHING ELSE. A judge that read a change and wrote
  // nothing has no finding, and a finding that is not handed back is one nobody
  // can read once the machine has been rolled back.
  const NAME = 'PULL.md'
  const there = sh(`test -f ${NAME} && echo yes || echo no`).trim()
  if (there !== 'yes') {
    throw new Error('it read the change and wrote no PULL.md, so there is nothing to hand back')
  }

  const text = sh(`cat ${NAME}`)
  const lines = String(text).trim().split('\n')
  const last = lines[lines.length - 1].trim()

  // ONE OF TWO ANSWERS, ON THE LAST LINE. The prompt asks for it in those words
  // and this refuses anything else -- a review that trails off without a
  // recommendation is the thing a person would have to read the whole report to
  // replace, which is what they asked a judge for.
  const call = /^RECOMMEND:\s*(YES|NO)$/i.exec(last)
  if (!call) {
    throw new Error(`the last line is "${last}" and it has to be exactly "RECOMMEND: YES" or "RECOMMEND: NO"`)
  }
  const answer = call[1].toUpperCase()
  log(`it recommends: ${answer}`)

  await artifact(NAME)
  await report('handing back what it found')

  // THE JUDGE'S OWN VERDICT, sent by the thing that read the change. Accept
  // means "fit to pull", which is what RECOMMEND: YES says. There is no
  // "pending" here: the worker was asked for one of two answers, and a run that
  // gave neither has already failed above.
  await verdict(answer === 'YES' ? 'accept' : 'reject',
    answer === 'YES'
      ? 'it is safe, does what it intends, and is what the pull request says it is'
      : String(text).split(/^##\s+/m)[0].trim().slice(0, 1500) || 'see PULL.md')

  return {
    machine,
    run,
    prompt: prompt ? prompt.id : null,
    recommends: answer,
    turns: said.turns,
    cost: said.cost == null ? null : Number(said.cost.toFixed(4)),
    session: said.session
  }
}
