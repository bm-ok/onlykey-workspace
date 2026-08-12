'use strict'

// The loop, plus the two properties that replaced the branch:
//
//   * throwing away moves HEAD in no repo, and is recoverable
//   * an accept that cannot complete moves HEAD in no repo at all
//
// It builds its own throwaway repos: a test must not commit to anything you care
// about, and pointing the tool at repos it has never seen is part of the claim.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-loop-'))
process.env.OKC_STATE = path.join(root, 'state')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
const dirOf = name => path.join(root, name)
const headOf = name => git(dirOf(name), 'rev-parse', 'HEAD')
const readme = name => path.join(dirOf(name), 'readme.md')

function repo (name) {
  const dir = dirOf(name)
  fs.mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'master')
  git(dir, 'config', 'user.email', 'test@example.invalid')
  git(dir, 'config', 'user.name', 'loop test')
  // This machine has autocrlf on globally, which would hand back "start\r\n"
  // from a restore and make the assertions below about line endings, not about
  // the tool.
  git(dir, 'config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(dir, 'readme.md'), 'start\n')
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
const edit = (name, text) => fs.writeFileSync(readme(name), text)
const refuses = (p, what) => p.then(() => fail(`${what} should refuse`), e => e)

;(async () => {
  console.log(`Loop test in ${root}\n`)

  // pick ---------------------------------------------------------------
  const tasks = work.tasks(ecoFile)
  if (tasks[0].repos.length !== 2) fail('a task with no repos listed should span all of them')
  ok('the task list spans both repos without saying so')

  const before = { one: headOf('one'), two: headOf('two') }
  const item = await work.start(ecoFile, 'describe')
  if (headOf('one') !== before.one) fail('starting must not create a commit')
  if (git(dirOf('one'), 'branch', '--show-current') !== 'master') fail('starting must not create or switch branches')
  ok('started: no branch cut, no commit, HEAD unmoved in both repos')

  await refuses(work.offer(item.id), 'offering with nothing changed')
  ok('offering an untouched tree refuses')

  await refuses(work.start(ecoFile, 'describe'), 'a second attempt in the same repos')
  ok('a second attempt in the same repos refuses — one tree, one attempt')

  // work ---------------------------------------------------------------
  edit('one', 'one holds the first half.\n')
  edit('two', 'two holds the second half.\n')
  fs.writeFileSync(path.join(dirOf('one'), 'new-file.txt'), 'brand new\n')

  const offered = await work.offer(item.id)
  if (offered.checks.length !== 2) fail(`the check should run in both repos, got ${offered.checks.length}`)
  if (offered.checks.some(c => !c.ok)) fail('the declared check should pass')
  ok('offered; the ecosystem check ran in both repos')

  const r = await work.review(item.id)
  if (!r.canAccept) fail('both repos have changes, so this should be acceptable')
  if (!r.parts.find(p => p.repo === 'one').files.some(f => f.path === 'new-file.txt')) {
    fail('review must include files that did not exist before')
  }
  ok('review shows the change itself, new files included')

  // property: throwing away moves no HEAD, and is recoverable ----------
  const thrown = await work.discard(item.id)
  if (headOf('one') !== before.one || headOf('two') !== before.two) fail('throwing away must not move HEAD')
  if (fs.readFileSync(readme('one'), 'utf8') !== 'start\n') fail('throwing away should restore the tree')
  if (fs.existsSync(path.join(dirOf('one'), 'new-file.txt'))) fail('throwing away should remove new files')
  if (!thrown.saved.length || !fs.existsSync(thrown.saved[0].file)) fail('the attempt should have been saved first')
  ok('thrown away: HEAD unmoved in both, tree restored, attempt saved to a patch')

  await work.putBack(item.id)
  if (fs.readFileSync(readme('one'), 'utf8') !== 'one holds the first half.\n') fail('put back should restore the edit')
  if (!fs.existsSync(path.join(dirOf('one'), 'new-file.txt'))) fail('put back should restore new files')
  if (headOf('one') !== before.one) fail('put back must not move HEAD')
  ok('put back: every file returned, including the new one, HEAD still unmoved')

  // accept -------------------------------------------------------------
  await refuses(work.accept(item.id, 'ok'), 'accepting without a real note')
  ok('accepting without saying what you checked refuses')

  const done = await work.accept(item.id, 'read both diffs, wording is accurate')
  if (done.landed.length !== 2) fail('both repos should have committed')
  for (const name of ['one', 'two']) {
    const log = git(dirOf(name), 'log', '--format=%s', 'master').split('\n')
    if (log.length !== 2) fail(`${name}: expected one new commit, got ${log.length - 1}`)
    if (!git(dirOf(name), 'log', '-1', '--format=%B').includes('Reviewed: read both diffs')) {
      fail(`${name}: the reviewer note is not in the history`)
    }
    if (git(dirOf(name), 'status', '--porcelain') !== '') fail(`${name}: tree should be clean after accepting`)
  }
  ok('accepted: one commit per repo on the one branch, reviewer note in the history')

  // property: an accept that cannot complete moves no HEAD -------------
  // Both repos genuinely ready, then one is made impossible to commit. The
  // assertion is not "it fails cleanly" -- it is that HEAD moved in neither.
  const two = await work.start(ecoFile, 'describe')
  edit('one', 'a real change in one\n')
  edit('two', 'a real change in two\n')

  const ready = await work.review(two.id)
  if (!ready.canAccept) fail('both repos are ready, so canAccept should be true')

  const at = { one: headOf('one'), two: headOf('two') }
  // A pre-commit hook that refuses. Nothing about the change is wrong; the commit
  // simply cannot happen, which is the case canAccept can never see.
  const hooks = path.join(dirOf('two'), '.git', 'hooks')
  fs.mkdirSync(hooks, { recursive: true })
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

  const err = await refuses(work.accept(two.id, 'checked both, committing now'), 'an accept that cannot complete')
  if (headOf('one') !== at.one) fail(`repo one moved to ${headOf('one')} — this is the half-land the set rule exists to prevent`)
  if (headOf('two') !== at.two) fail('repo two moved despite its commit failing')
  if (work.find(two.id).status === 'accepted') fail('state says accepted while nothing was committed')
  ok('an accept that cannot complete: HEAD moved in neither repo, state not marked accepted')
  ok(`and it says why: "${err.message.slice(0, 60)}..."`)

  if (git(dirOf('one'), 'status', '--porcelain') === '') fail('the rolled-back work should still be in the tree')
  ok('the rolled-back work is still there, not lost')

  fs.rmSync(path.join(hooks, 'pre-commit'))
  const finally_ = await work.accept(two.id, 'hook fixed, checked both again')
  if (finally_.landed.length !== 2) fail('after the obstacle is gone, accepting should work')
  ok('with the obstacle removed, the same attempt accepts and lands in both')

  fs.rmSync(root, { recursive: true, force: true })
  console.log('\nPASS — one branch, no history rewritten, nothing half-landed.')
})().catch(e => { console.error(`\nERROR — ${e.stack}`); process.exit(1) })
