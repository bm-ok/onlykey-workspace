'use strict'

// The same five actions from a terminal. Not a debugging back door -- the page
// and this are two clients over one core, so neither can grow a capability the
// other cannot reach.
//
//   node cli.js tasks [ecosystem]
//   node cli.js start <task> [ecosystem]
//   node cli.js offer <work>
//   node cli.js review <work>
//   node cli.js accept <work> "what you checked"
//   node cli.js throwaway <work>

const work = require('./core/work')
const eco = require('./core/ecosystem')

const [action, a, b] = process.argv.slice(2)
const where = () => a && (a.endsWith('.json') || eco.list().includes(a)) ? a : (b || 'local')

const actions = {
  async tasks () {
    const e = where()
    for (const r of await eco.health(eco.load(e))) {
      if (!r.present) console.log(`  ! ${r.name} is not at ${r.dir}`)
    }
    for (const t of work.tasks(e)) {
      console.log(`${t.id}\n  ${t.title}`)
      console.log(`  ${t.repos.length === 1 ? 'repository' : 'repositories'}: ${t.repos.join(', ')}`)
      t.open.forEach(o => console.log(`  already ${o.status} as ${o.id}`))
    }
  },

  async start () {
    const item = await work.start(where(), a)
    console.log(`Started "${item.title}" as ${item.id}`)
    item.where.forEach(p => console.log(`  ${p.repo}: ${p.at}`))
    console.log('\nWork there, commit when you like, then: node cli.js offer ' + item.id)
  },

  async offer () {
    const item = await work.offer(a)
    item.checks.forEach(c => console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`))
    console.log(`Offered ${item.id}. Review it: node cli.js review ${item.id}`)
  },

  async review () {
    const r = await work.review(a)
    for (const p of r.parts) {
      console.log(`\n--- ${p.repo} ${p.ready ? '' : '(nothing yet)'}`)
      p.commits.forEach(c => console.log(`  ${c}`))
      if (p.stat) console.log(p.stat)
    }
    r.checksFailed.forEach(c => console.log(`\n  CHECK FAILED: ${c.name}\n  ${c.output.split('\n')[0]}`))
    console.log(r.canAccept
      ? `\nReady. To accept: node cli.js accept ${a} "what you checked"`
      : `\nNot ready — no work in ${r.missing.join(' or ')}.`)
  },

  async accept () {
    const item = await work.accept(a, b)
    console.log(`Accepted. Landed on ${item.landed.join(' and ')}.`)
  },

  async throwaway () {
    await work.discard(a)
    console.log('Thrown away. Your repositories are back where they were.')
  }
}

const run = actions[action]
if (!run) {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(3, 13).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(1)
}
run().catch(e => { console.error(e.message); process.exit(1) })
