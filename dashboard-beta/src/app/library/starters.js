//---------------------------------------------------------------------------
//WHAT A NEW ONE STARTS AS.
//
//ONE COPY, READ BY BOTH HALVES. In the app being ported from there are two of
//each — one beside the store, one in the window's editor — and they had already
//drifted: the job template the store used was 1569 characters and the one a
//person actually saw when writing a new job was 886. So where a job was created
//decided what it started from, and nothing said so.
//
//THIS IS A PLAIN MODULE rather than part of either half, so ./window.js and
//./server.js read the same string and there is nowhere for a second to appear.
//---------------------------------------------------------------------------

//A JOB IS CODE, and this is the shape of one — the object it is handed, and what
//everything on that object does.
var JOB = "'use strict'\n\n// A job. It runs ON A MACHINE, not on the dashboard's computer, and it is given\n// one object -- everything it can do is on that object.\n//\n//   prompt      the prompt it was run with, or null: { id, name, text }\n//   claude(t)   give a worker a brief HERE and wait for it. No argument means\n//               the prompt above -- which is the ordinary case\n//   log(line)   a line of output, kept with the run and readable afterwards\n//   report(s)   how far along it is, while it is still going\n//   sh(cmd)     a command in the guest, returning what it printed\n//   artifact(f) hand a file back to the dashboard, kept against this run\n//   gitUrl(r)   where this machine clones and pushes, credential included\n//   assert      ok, equal, refuses -- for a job that checks rather than does\n//   workspace   the folder it is actually in\n//   configured  the folder it was set up to use, which is not always the same\n//   machine     the name of the machine it is running on\n//   run         the id of this run\n//\n// There is no \\`okc\\` and that is deliberate: a machine cannot reach the\n// dashboard's actions, which is what makes it safe to run a script on one.\n//\n// It is async, and whatever it returns is written to the log when it finishes.\nmodule.exports = async ({ prompt, log, sh, workspace }) => {\n  log('running in ' + workspace)\n\n  const repos = sh('ls -1').trim().split('\\\\n').filter(Boolean)\n  log(\\`\\${repos.length} thing(s) here: \\${repos.join(', ')}\\`)\n\n  if (prompt) log('the prompt was: ' + prompt.name)\n\n  return { saw: repos.length }\n}\n";

//A CONTRACT IS THE RULES, and this is what a person starts writing them from.
var CONTRACT = "# What this worker may and may not do\n\n- Work only on the branch you were given. Never commit to the default branch.\n- Do not force-push, and do not rewrite history that is already pushed.\n- Do not install anything. If something is missing, say so and stop.\n- Do not edit anything outside the repositories in this folder.\n\n# When you are unsure\n\nSay what you were unsure about and what you did instead. A note in the\ntranscript is worth more than a guess that looks like a decision.\n\n# When you finish\n\nLeave the work on the branch. Say in one paragraph what you changed and what you\ndid not get to.\n";

module.exports = { JOB: JOB, CONTRACT: CONTRACT };
