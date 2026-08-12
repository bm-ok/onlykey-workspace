'use strict'

// Test 2 from CONTRACT.md: the whole loop, against repos that have no remotes,
// no second machine and nothing project-specific in them.
//
// It builds its own throwaway repos rather than using `workspace/`, for two
// reasons: a test must not merge into anything you care about, and pointing the
// tool at a set of repos it has never seen is exactly the claim being tested.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-loop-'))
process.env.OKC_STATE = path.join(root, 'state')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()

function repo (name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'master')
  git(dir, 'config', 'user.email', 'test@example.invalid')
  git(dir, 'config', 'user.name', 'loop test')
  fs.writeFileSync(path.join(dir, 'readme.md'), '')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

repo('one')
repo('two')

const ecoFile = path.join(root, 'throwaway.json')
fs.writeFileSync(ecoFile, JSON.stringify({
  name: 'Throwaway',
  repos: [{ name: 'one', path: './one' }, { name: 'two', path: './two' }],
  sandbox: { kind: 'local' },
  tasks: [{
    id: 'describe',
    title: 'Say what these are for',
    checks: [{ name: 'readme is not empty', run: 'node -e "process.exit(require(\'fs\').statSync(\'readme.md\').size?0:1)"' }]
  }]
}))

const work = require('../core/work')

let step = 0
const ok = msg => console.log(`  ${++step}. ${msg}`)
const fail = msg => { console.error(`\nFAIL — ${msg}`); process.exit(1) }

;(async () => {
  console.log(`Loop test in ${root}\n`)

  // pick ---------------------------------------------------------------
  const tasks = work.tasks(ecoFile)
  if (tasks.length !== 1 || tasks[0].repos.length !== 2) fail('a task with no repos listed should span all of them')
  ok('the task list spans both repos without saying so')

  const item = await work.start(ecoFile, 'describe')
  for (const r of ['one', 'two']) {
    if (git(path.join(root, r), 'rev-parse', '--abbrev-ref', 'HEAD') !== item.branch) fail(`${r} is not on the work branch`)
  }
  ok(`both repos handed over on ${item.branch}, nobody typed a branch name`)

  // offering nothing --------------------------------------------------
  await work.offer(item.id).then(
    () => fail('offering with nothing committed should refuse'),
    e => ok(`offering empty work refuses, in plain words: "${e.message.slice(0, 48)}..."`))

  // work ---------------------------------------------------------------
  for (const r of ['one', 'two']) {
    const dir = path.join(root, r)
    fs.writeFileSync(path.join(dir, 'readme.md'), `${r} holds the ${r} half.\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'describe it')
  }
  ok('work committed in both repos')

  // offer --------------------------------------------------------------
  const offered = await work.offer(item.id)
  if (offered.status !== 'offered') fail('status should be offered')
  if (offered.checks.some(c => !c.ok)) fail(`a declared check failed: ${JSON.stringify(offered.checks)}`)
  ok(`offered, and the ecosystem's own check ran: "${offered.checks[0].name}" passed`)

  // review -------------------------------------------------------------
  const r = await work.review(item.id)
  if (!r.canAccept) fail('a set with both repos ready should be acceptable')
  if (r.parts.length !== 2 || !r.parts.every(p => p.files.includes('readme.md'))) fail('review should show what changed, per repo')
  ok('review shows the change itself, not a pointer to a record')

  // accept -------------------------------------------------------------
  await work.accept(item.id, 'ok').then(
    () => fail('accepting without a real note should refuse'),
    () => ok('accepting without saying what you checked refuses'))

  const done = await work.accept(item.id, 'read both diffs, wording is accurate')
  if (done.landed.length !== 2) fail('both repos should have landed')
  for (const name of ['one', 'two']) {
    const dir = path.join(root, name)
    if (git(dir, 'rev-parse', '--abbrev-ref', 'HEAD') !== 'master') fail(`${name} should be back on master`)
    const log = git(dir, 'log', '--format=%s', 'master')
    if (log.split('\n').length !== 2) fail(`${name}: master should have one new commit, got ${log.split('\n').length - 1}`)
    if (!git(dir, 'log', '-1', '--format=%B', 'master').includes('Reviewed: read both diffs')) fail(`${name}: reviewer note missing from history`)
    if (fs.readFileSync(path.join(dir, 'readme.md'), 'utf8').trim() === '') fail(`${name}: the change did not land`)
  }
  ok('landed on master as one squashed commit per repo, reviewer note in the history')

  // a set does not half-land -------------------------------------------
  const partial = await work.start(ecoFile, 'describe')
  const dir = path.join(root, 'one')
  fs.appendFileSync(path.join(dir, 'readme.md'), 'more\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'only one side')
  const pr = await work.review(partial.id)
  if (pr.canAccept) fail('a set where only one repo has work must not be acceptable')
  ok('a task spanning two repos will not land when only one has work')

  await work.discard(partial.id)
  if (git(dir, 'rev-parse', '--abbrev-ref', 'HEAD') !== 'master') fail('throwing away should put you back on your own branch')
  ok('thrown away, both repos back on master')

  fs.rmSync(root, { recursive: true, force: true })
  console.log('\nPASS — pick, work, offer, review, accept, against repos it had never seen.')
})().catch(e => { console.error(`\nERROR — ${e.stack}`); process.exit(1) })
