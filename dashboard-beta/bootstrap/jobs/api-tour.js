'use strict'

// EVERY HELPER A JOB IS HANDED, USED ONCE, ON A REAL MACHINE.
//
// This exists to be run rather than read: the job API is the one part of this
// app whose code lives here and executes somewhere else, so "it should work" is
// worth nothing about it. Each section below uses one helper for what it is
// actually for and records what came back, and the whole thing is handed back as
// a file — which is itself the last helper being used.
//
// It reads its brief from the prompt rather than carrying one, because that is
// the shape everything here is built to: a job is the how, a prompt is the what,
// and a job with the brief baked in is a job that can only ever do one thing.
module.exports = async ({
  prompt, workspace, configured, machine, run,
  log, report, artifact, sh, gitUrl, assert
}) => {
  const lines = []
  const note = (label, value) => {
    const text = `${String(label).padEnd(12)}${value}`
    lines.push(text)
    log(text)
  }

  // ---- 1. where it is, and what it was told -----------------------------
  await report('taking stock')

  note('machine', machine)
  note('run', run)
  note('workspace', workspace)
  // The folder as CONFIGURED, which is not always the folder it is in: a machine
  // that has never been given a task has no workspace, and the run script falls
  // back to the home directory. Saying both is the difference between "it ran
  // somewhere else" and a job quietly reporting the wrong footing.
  note('configured', configured || '(none)')
  if (configured && configured !== workspace) {
    note('', 'NOTE — it is not running where it was configured to')
  }

  assert.ok(machine, 'a job should know the name of the machine it is on')
  assert.ok(workspace, 'a job should know the folder it is in')

  // The prompt is the input, so a run without one is a run with nothing to do.
  assert.ok(prompt, 'this job is the how; the prompt is the what — run it with one')
  note('prompt', `${prompt.name} (${prompt.id})`)
  note('brief', `${prompt.text.trim().split('\n').length} line(s), ${prompt.text.length} characters`)

  // ---- 2. the shell it has ----------------------------------------------
  await report('looking around')

  const here = sh('ls -1').trim().split('\n').filter(Boolean)
  note('here', here.length ? here.join(', ') : '(empty)')

  const whoami = sh('whoami').trim()
  const host = sh('hostname').trim()
  note('as', `${whoami}@${host}`)
  assert.equal(host, machine, 'the machine it runs on should be the machine it was sent to')

  // Somewhere else, on purpose — the second argument is the one thing `sh` takes
  // beyond the command, and a helper's options are worth exercising too.
  const kernel = sh('uname -sr', { cwd: '/' }).trim()
  note('kernel', kernel)

  // Every repository it can see, and where each one stands. `git -C` rather than
  // a cd, so one unreadable directory cannot move the rest of the job.
  const repos = []
  for (const dir of here) {
    let branch, head
    try {
      branch = sh(`git -C ${dir} rev-parse --abbrev-ref HEAD`).trim()
      head = sh(`git -C ${dir} log -1 --format=%h\\ %s`).trim()
    } catch {
      continue
    }
    repos.push({ dir, branch, head })
    note('repo', `${dir} — on ${branch} at ${head}`)
  }
  note('repos', `${repos.length} of ${here.length} entries are git repositories`)

  // ---- 3. where it pushes ------------------------------------------------
  //
  // REDACTED WHEN IT IS SAID OUT LOUD. gitUrl embeds the machine's own
  // credential, which is the point — it is what makes a clone work without
  // anything being typed — and a run's output is captured back to the host and
  // kept. Printing it raw would put a live token in a log file for the sake of a
  // line nobody needed.
  await report('checking its remote')
  try {
    const url = gitUrl(repos.length ? repos[0].dir : 'anything')
    assert.ok(url.startsWith('https://'), 'the git address should be https')
    assert.ok(url.includes('/git/'), 'the git address should point at the app\'s git server')
    note('git url', url.replace(/\/\/[^@]*@/, '//<machine>:<token>@'))
  } catch (e) {
    note('git url', `unavailable — ${e.message}`)
  }

  // ---- 4. failing on purpose ---------------------------------------------
  //
  // A job that only ever takes the happy path proves the happy path. These are
  // the two failures worth knowing are real: a command that exits non-zero must
  // throw rather than return empty, and handing back a file that is not there
  // must fail rather than report success.
  await report('checking what refuses')

  await assert.refuses(
    () => sh('exit 3'),
    null,
    'a command that exits non-zero should throw'
  )
  note('sh', 'a non-zero exit throws, as it should')

  await assert.refuses(
    () => artifact('/tmp/there-is-no-such-file'),
    'ENOENT',
    'handing back a file that does not exist should fail'
  )
  note('artifact', 'a missing file fails rather than reporting success')

  // ---- 5. handing something back ------------------------------------------
  await report('writing the report')

  const fs = require('node:fs')
  const file = `/tmp/${run || 'api-tour'}.md`
  fs.writeFileSync(file, [
    `# ${prompt.name}`,
    '',
    `Run \`${run}\` on **${machine}**, in \`${workspace}\`.`,
    '',
    '## The brief it was given',
    '',
    prompt.text.trim().split('\n').map(l => `> ${l}`).join('\n'),
    '',
    '## What it found',
    '',
    '```',
    ...lines,
    '```',
    '',
    repos.length
      ? ['| repository | branch | head |', '| --- | --- | --- |',
          ...repos.map(r => `| ${r.dir} | ${r.branch} | ${r.head} |`)].join('\n')
      : '_No git repositories in this folder._',
    ''
  ].join('\n'))

  await report('handing it back')
  // This one is awaited, and that is not a detail. An un-awaited artifact() lets
  // the job finish and report success while the upload is still in flight or
  // already failed — a false "handed over" that has happened here before.
  await artifact(file, 'api-tour.md')
  note('handed back', 'api-tour.md')

  await report('done')

  // Whatever comes back is written to the log when it finishes, so it is the
  // one-line version of everything above.
  return {
    machine,
    workspace,
    ranAs: whoami,
    prompt: prompt.id,
    repos: repos.map(r => `${r.dir}@${r.branch}`),
    helpers: ['prompt', 'workspace', 'configured', 'machine', 'run',
      'log', 'report', 'sh', 'gitUrl', 'assert', 'artifact']
  }
}
