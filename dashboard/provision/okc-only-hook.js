#!/usr/bin/env node
'use strict'

// DENY EVERYTHING THAT IS NOT THE DASHBOARD.
//
// A PreToolUse hook: Claude Code hands it every tool call before it happens, on
// stdin, and this answers allow or deny. It allows exactly one shape of name —
// `mcp__okc__*`, the supervisor API — and denies everything else that exists now
// or is added later.
//
// WHY A HOOK AND NOT A LIST OF DENIED TOOLS. That was the first attempt and the
// supervisor's own model found the hole in it within a minute of being asked:
//
//   --allowedTools is an AUTO-APPROVE list, not an exclusive one. Naming
//   `mcp__okc` there says "these need no permission prompt". It does not say
//   "and nothing else exists".
//
//   --disallowedTools is a list somebody has to keep COMPLETE. Mine named the
//   eleven tools I could think of, and that version of Claude Code shipped
//   twenty-three: `Monitor` takes an arbitrary shell command and streams its
//   output back, and `Workflow` spawns subagents with toolsets of their own.
//   Both were reachable. It said so, unprompted, and declined to use them —
//   which is a good model being careful, and is not a security boundary.
//
// So the rule is inverted. This does not enumerate what is forbidden; it
// enumerates what is permitted, which is one prefix, and everything a future
// release adds is denied on the day it ships rather than on the day somebody
// notices.
//
// IT IS NOT THE ONLY FENCE, and it is the weakest of the three: it runs on the
// machine, as a user that could in principle edit it. The host refuses anything
// off its own list whatever asks — see core/supervisor.js — and the tool server
// only offers what the host says it may. This one exists so that a wrong call is
// stopped where it is made, with a sentence the model can act on.

const OURS = /^mcp__okc__/

let raw = ''
process.stdin.on('data', d => { raw += d })
process.stdin.on('end', () => {
  let name = ''
  try { name = String(JSON.parse(raw).tool_name || '') } catch { /* unreadable: denied below */ }

  if (OURS.test(name)) {
    // Nothing said, and exit 0: no opinion is "carry on", which leaves the
    // ordinary permission handling in place for our own tools rather than
    // rubber-stamping them from here.
    process.exit(0)
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `"${name || 'that'}" is not available to a supervisor. You have the dashboard's supervisor API and nothing else — no shell, no files, no network, no subagents. ` +
        'Everything you can do is an mcp__okc__ tool; ask for what you may do and use one of those.'
    }
  }))
  process.exit(0)
})
