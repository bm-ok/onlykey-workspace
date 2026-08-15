'use strict'

// guards — a task cannot be written wrong
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')
const { scratch } = require('../../helpers')

it('a task with nowhere to deliver is refused', async ({ okc, assert }) => {
  await assert.refuses(
    () => okc('taskCreate', { task: { title: 'no branch', brief: 'anything' } }),
    'branch',
    'A task with no branch has no artifact and could never be judged')
})

it('a contract that is not there is refused', async ({ okc, assert }) => {
  await assert.refuses(
    () => okc('taskCreate', { task: { title: 'bad contract', brief: 'anything', branch: scratch('contract'), contract: 'C:/nothing/here.md' } }),
    'no contract at',
    'A contract that silently fails to load leaves a worker with no rules while everything reports success')
})
