'use strict'

// Where the work happens, and how it gets back.
//
// Two kinds. `local` works in your own copies on a branch. `ssh` works on
// another machine reached over ssh -- which is all a "guest" is here. How you
// got that machine is not this file's business: a VM, a spare box, a laptop on
// the desk are the same thing to it. Keeping VirtualBox out of the core is
// deliberate; the last version welded a VM lifecycle into everything and the
// tool could not be used without one.

const { execFile } = require('node:child_process')
const path = require('node:path')
const git = require('./git')

function sh (cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.join(' ')}\n${(stderr || err.message).trim()}`))
      resolve(stdout.trim())
    })
  })
}

// ---------------------------------------------------------------- local

const local = (cfg, dirOf) => ({
  kind: 'local',

  // Plain words, for a person about to press a button. Nothing here is jargon
  // and nothing is a promise the code does not keep.
  plain: [
    'Work happens in your own copies, on a new branch.',
    'Your main branch is not touched.',
    'Nothing goes to the internet.'
  ],

  async prepare (branch, repos) {
    for (const r of repos) await git.cut(r.dir, branch, r.base)
    return repos.map(r => ({ repo: r.name, at: r.dir }))
  },

  // The branch already is where the host can see it, so offering is a decision
  // rather than a transfer.
  async offer () { return [] },

  // A check runs where the work is: inside the repo it is about.
  run (script, repoName) {
    const win = process.platform === 'win32'
    return sh(win ? 'cmd' : 'sh', win ? ['/c', script] : ['-c', script], dirOf(repoName))
  }
})

// ---------------------------------------------------------------- ssh

// One ssh direction only: host reaches guest. Nothing listens on the host, so
// this works on a workstation with no server on it. The guest still performs the
// publish -- it pushes to a bare repo in its own home, a local path with no
// credentials anywhere -- and the host fetches from that when work is offered.
const ssh = cfg => {
  const target = cfg.host                       // user@host
  const inbox = (cfg.dir || 'okc') + '/inbox'   // bare repos the guest pushes to
  const work = (cfg.dir || 'okc') + '/work'     // where someone actually works
  const remote = name => `${target}:${inbox}/${name}.git`
  const at = (script, cwd) => sh('ssh', [target, cwd ? `cd ${cwd} && ${script}` : script])

  return {
    kind: 'ssh',
    plain: [
      `Work happens on ${target}, not on this machine.`,
      'Your copies here are only read, never written, until you accept the work.',
      'That machine has no way to reach the internet with your changes.'
    ],

    async prepare (branch, repos) {
      const out = []
      for (const r of repos) {
        await git.cut(r.dir, branch, r.base)
        await at(`mkdir -p ${inbox} ${work} && git init --bare -q ${inbox}/${r.name}.git`)
        await git.git(r.dir, ['push', '--force', remote(r.name), `${branch}:${branch}`])
        await at(`rm -rf ${work}/${r.name} && git clone -q -b ${branch} ${inbox}/${r.name}.git ${work}/${r.name}`)
        out.push({ repo: r.name, at: `${target}:${work}/${r.name}` })
      }
      return out
    },

    // The guest pushed; we take what it offered and nothing else.
    async offer (branch, repos) {
      const brought = []
      for (const r of repos) {
        await git.fetchBranch(r.dir, remote(r.name), branch)
        brought.push(r.name)
      }
      return brought
    },

    run (script, repoName) { return at(script, repoName ? `${work}/${repoName}` : work) }
  }
}

// ---------------------------------------------------------------- checks

// The ecosystem says what to run and what it means. The core learns only pass
// or fail. This is the seam that used to be a hardcoded `role` and a list of
// USB identities: an ecosystem with nothing to check declares nothing and the
// whole idea disappears instead of needing an answer.
async function check (box, checks, repoName) {
  const out = []
  for (const c of checks || []) {
    try {
      const output = await box.run(c.run, repoName)
      out.push({ name: c.name, ok: true, output: output.slice(0, 4000) })
    } catch (e) {
      out.push({ name: c.name, ok: false, output: String(e.message).slice(0, 4000), why: c.why || '' })
    }
  }
  return out
}

const open = (cfg, dirOf) => cfg.kind === 'ssh' ? ssh(cfg) : local(cfg, dirOf)

module.exports = { open, check }
