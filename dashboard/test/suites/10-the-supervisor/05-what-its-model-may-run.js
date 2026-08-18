'use strict'

// what its model may run — the tool surface, and the desk beside it
//
// The supervisor's Claude has no general-purpose tools. Not "is asked not to use
// them" — does not have them. Its whole surface is this dashboard's supervisor
// API, offered as MCP tools by a server on the machine.
//
// WITHOUT SPENDING A TURN. Asking the model what it has costs a minute and a
// model's time, and answers with prose that has to be believed — it once
// answered that list correctly and then added "plus ordinary file and shell
// access on this machine", which was false. So this asks the MACHINERY instead:
// the tool server is a program that can be asked for its list, and the gate is a
// program that can be handed a tool call and asked for its verdict.
//
// THREE FENCES, AND THIS CHECKS THE TWO THAT LIVE ON THE MACHINE:
//
//   the host refuses anything off its list      — the two-APIs drill, next door
//   the tool server offers only what the host says it may   — here
//   the gate denies every tool that is not one of those     — here
//
// AND THE DESK, which is the other thing on that machine that must be empty: it
// exists to hold a sign-in conversation, and a credential left there is a token
// on a disk that nothing on this host is recording.

const { it, requires } = require('../../../tasks/harness')

requires('the machines are built')

const run = async (okc, machine, line, what) => {
  const said = await okc('vmRun', { name: machine, command: line, what })
  return String(said.output || '').split('\n').slice(1).join('\n').trim()
}

it('a supervisor machine is up, with its tool server and its gate', async ({ okc, assert, state, log }) => {
  const machines = (await okc('vmList')).vms || []
  const boss = machines.find(m => m.supervisor && m.connected)
  assert.needs(boss, 'no supervisor machine is dialled in — everything here is asked of the machine')
  state.boss = boss.name

  const there = await run(okc, boss.name,
    'ls -1 ~/.okc/okc-mcp.js ~/.okc/okc-only-hook.js ~/.okc/mcp.json ~/.okc/settings.json ~/.claude/skills/supervising/SKILL.md 2>&1',
    'looking for what its model is given')
  for (const wanted of ['okc-mcp.js', 'okc-only-hook.js', 'mcp.json', 'settings.json', 'SKILL.md']) {
    assert.ok(there.includes(wanted), `${wanted} is not on ${boss.name}: ${there.slice(0, 300)}`)
  }
  log('the tool server, the gate, the two configs and the skill are all there')
}, { gate: true })

it('and the tool server offers exactly what this host allows', async ({ okc, assert, state, log }) => {
  // ASKED OF THE SERVER ITSELF, over the protocol it speaks. It fetches the list
  // from the host at startup rather than carrying its own copy — so this is
  // really checking that the two agree, which is the thing that would drift.
  const listing = await run(okc, state.boss,
    `printf '%s\\n%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | timeout 60 node ~/.okc/okc-mcp.js`,
    'asking its tool server what it offers')

  // BY THE ID IT WAS ASKED WITH, not by looking for the word "tools". The first
  // version searched for that string and matched the INITIALIZE reply, whose
  // capabilities are `{"tools":{}}` — so it read an empty object as an empty list
  // and reported that the server offered nothing at all. A wrong reading looks
  // exactly like a real finding, which is why this is run rather than reasoned
  // about.
  let offered = null
  for (const line of listing.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let msg = null
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id !== 2) continue
    assert.ok(msg.result && Array.isArray(msg.result.tools), `its answer to tools/list is not a list: ${line.slice(0, 200)}`)
    offered = msg.result.tools.map(t => t.name)
  }
  assert.ok(offered, `the tool server did not answer the tools/list it was asked: ${listing.slice(0, 300)}`)

  const may = Object.keys(require('../../../core/supervisor').MAY)
  const extra = offered.filter(n => !may.includes(n))
  const missing = may.filter(n => !offered.includes(n))
  assert.ok(!extra.length, `its tool server offers ${extra.join(', ')}, which this host does not allow a supervisor`)
  assert.ok(!missing.length, `its tool server is missing ${missing.join(', ')}, which this host does allow — it is working from a stale list`)
  log(`${offered.length} tools offered, and they are exactly the ${may.length} on this host's list`)
})

it('and the gate denies everything that is not one of them', async ({ okc, assert, state, log }) => {
  // THE RULE IS AN ALLOWLIST, WHICH IS WHY THIS IS WORTH CHECKING BY HAND. A deny
  // list has to be kept complete, and the first version of this was not: that
  // Claude Code ships Monitor, which runs an arbitrary shell command, and
  // Workflow, which spawns subagents with tools of their own. Both were reachable
  // and the supervisor said so itself.
  //
  // So the gate is handed a tool call and asked for a verdict, which is exactly
  // what Claude Code does with it before every call.
  const ask = async name => run(okc, state.boss,
    `printf '%s' '{"tool_name":"${name}"}' | timeout 30 node ~/.okc/okc-only-hook.js; echo "[exit $?]"`,
    `asking the gate about ${name}`)

  for (const denied of ['Bash', 'Read', 'Write', 'Monitor', 'Workflow', 'ToolSearch', 'Task', 'WebFetch', 'SomethingInventedNextYear']) {
    const said = await ask(denied)
    assert.ok(/"permissionDecision":\s*"deny"/.test(said),
      `the gate did not deny "${denied}": ${said.slice(0, 300)}`)
  }

  // AND IT LETS THE DASHBOARD THROUGH, which is the half that stops this being a
  // machine that can do nothing at all.
  const ours = await ask('mcp__okc__tasks')
  assert.ok(!/"permissionDecision":\s*"deny"/.test(ours), `the gate denied its own tool: ${ours.slice(0, 300)}`)
  assert.ok(/\[exit 0\]/.test(ours), `the gate did not exit cleanly on an allowed tool: ${ours.slice(0, 200)}`)

  log('Bash, Read, Write, Monitor, Workflow, ToolSearch, Task, WebFetch and a name invented for this check are all denied; mcp__okc__ is not')
})

it('and the sign-in desk holds nothing', async ({ okc, assert, state, log }) => {
  // THE DESK EXISTS TO HOLD A CONVERSATION, NOT A CREDENTIAL. One left there is a
  // token on a machine's disk that nothing on this host is recording, which is
  // the state this whole app is arranged to avoid.
  //
  // BOTH FILES. `.claude/.credentials.json` is the credential; `.claude.json` is
  // Claude Code's config, and after a sign-in it holds the account — the email
  // address, the uuid, the billing type. The first version cleared the first and
  // reported the desk empty with 1,973 bytes of account still in it.
  const left = await run(okc, state.boss,
    'sudo -n -u okc-signin -H bash -c \'ls -a ~ | tr "\\n" " "\'',
    'looking at what the sign-in desk is holding')
  assert.ok(!/\.claude\b/.test(left), `the desk is holding a .claude folder: ${left}`)
  assert.ok(!/\.claude\.json/.test(left), `the desk is holding Claude's config, which names the account that signed in: ${left}`)
  assert.ok(!/\.okc-auth/.test(left), `the desk still has a sign-in conversation open: ${left}`)
  log(`the desk holds ${left.trim()} — no credential, no account, no conversation`)
})

it('and only a supervisor machine has a desk at all', async ({ okc, assert, log }) => {
  // EVERY SIGN-IN HAPPENS ON ONE MACHINE. A runner is handed a credential when it
  // works and never asks for one — so asking a runner for a login URL is refused
  // for what it is, rather than failing later for want of a user that is not
  // there.
  const machines = (await okc('vmList')).vms || []
  const runner = machines.find(m => !m.supervisor)
  assert.needs(runner, 'this host has no runner to ask')

  await assert.refuses(
    () => okc('claudeSignIn', { name: runner.name }),
    'only a supervisor machine has a sign-in desk',
    `${runner.name} is a runner and was asked for a login URL without being refused`)
  log(`${runner.name} is a runner, and asking it for a login URL is refused`)
})

it('and it holds no repositories, and got none of the project setup', async ({ okc, assert, state, log }) => {
  // A DRAFT UNTIL NOW, and provable without an install: the machine is here, and
  // what it was built with is still on it.
  //
  // A supervisor takes no tasks, so the project's half of provisioning — its
  // repositories, its build inputs, its devices — is setup for work that will
  // never happen there. Worse than waste: a supervisor holding a copy of the work
  // it is handing out is the difference between deciding and doing.
  const clones = await run(okc, state.boss,
    'find ~ -maxdepth 3 -name .git -type d 2>/dev/null | grep -v "\.nvm" | head -5; echo "[end]"',
    'looking for repositories on the supervisor')
  assert.ok(!clones.replace('[end]', '').trim(),
    `the supervisor is holding repositories: ${clones.slice(0, 200)}`)

  // AND ITS OWN LOG SAYS THE PROJECT'S HALF WAS SKIPPED, which is the difference
  // between "nothing was cloned" and "the skip actually happened". A machine that
  // ran the project setup and happened to clone nothing would pass the check
  // above and be wrong.
  const boot = await run(okc, state.boss,
    "grep -c 'this machine is a supervisor, so the project setup is skipped' /var/log/okc-provision.log || echo 0",
    'reading what its first boot decided')
  assert.ok(Number(boot.trim().split('\n').pop()) > 0,
    'its first-boot log does not say the project setup was skipped, so it may have run and simply had nothing to clone')

  // AND IT HAS THE ONE THING IT DOES NEED.
  const claude = await run(okc, state.boss, "bash -lc 'claude --version' 2>&1 | tail -1", 'asking what it runs on')
  assert.ok(/\d+\.\d+/.test(claude), `it has no Claude Code, which is the only thing it was given: ${claude.slice(0, 120)}`)
  log(`no repositories, project setup skipped, and claude ${claude.trim()}`)
})

// ---- WHAT IT SAW ----------------------------------------------------------
//
// 17 August 2026, against supervisor-1. Five checks, ten seconds, no model and
// no turn — everything here asks the machinery rather than the model.
//
//     the tool server, the gate, the two configs and the skill are all there
//     PASS a supervisor machine is up, with its tool server and its gate
//
//     41 tools offered, and they are exactly the 41 on this host's list
//     PASS and the tool server offers exactly what this host allows
//
//     Bash, Read, Write, Monitor, Workflow, ToolSearch, Task, WebFetch and a
//     name invented for this check are all denied; mcp__okc__ is not
//     PASS and the gate denies everything that is not one of them
//
//     the desk holds . .. .bash_logout .bashrc .profile — no credential, no
//     account, no conversation
//     PASS and the sign-in desk holds nothing
//
//     runner4 is a runner, and asking it for a login URL is refused
//     PASS and only a supervisor machine has a desk at all
//
// TWO THINGS IT FOUND ON ITS FIRST RUN, both worth keeping:
//
// The tool-list check searched the server's output for the word "tools" and
// matched the INITIALIZE reply, whose capabilities are `{"tools":{}}` — reading
// an empty object as an empty list and reporting that the server offered nothing
// at all. It matches by the id it asked with now.
//
// And the refusal for asking a runner for a login URL had lost its explanation:
// "is a runner, not a supervisor machine" says what and not why. It was
// shortened when that check was made shared between the desk and the wake, and
// the full sentence is back.
