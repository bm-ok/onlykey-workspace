<!-- generated: node dashboard/test/claims.js --write -->

# What the code refuses, and what nothing checks

Every `throw` in the app is a claim it makes about what it will not do. Every
`assert.refuses(fn, pattern)` in a drill is one of those claims being watched —
and it matches the MESSAGE, not merely the throwing, so the two can be crossed.

**63 of 331 refusals are matched by a check. 268 are not.**

The list below is drafts: rules this app enforces that no drill has ever asked
for. Each is a check waiting to be written, in the app's own words, at a known
line. Not all of them should be — some are impossible states rather than rules,
and some are one rule expressed three times — which is why this is a list to
read rather than a number to drive to zero.

## Watched already

- actions/app.js:343 — matched by test/suites/02-the-refusals/04-the-ways-round-a-refusal.js
  > "…" is not a setting. It is one of: ….
- actions/app.js:367 — matched by test/suites/02-the-refusals/04-the-ways-round-a-refusal.js
  > The drills are switched on in the window, by somebody who knows what folder is open. They write a task and take a credential off a machine — that is a decision about somebody\'s repository, not a flag to be set down a pipe.
- actions/app.js:426 — matched by test/suites/02-the-refusals/04-the-ways-round-a-refusal.js
  > A request to run the drills is answered in the window, by somebody who can see which folder is open. Something that could answer its own request has not asked for anything.
- actions/branches.js:485 — matched by test/suites/02-the-refusals/01-a-branch-is-not-named-by-accident.js
  > There is no branch called "…". Make it first, with a reason.
- actions/branches.js:492 — matched by test/suites/05-the-machines/01-a-machine-comes-up-and-goes-away.js
  > "…" is already set up on …. Two machines on one branch race for the same ref.
- actions/branches.js:957 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" has no branch called "…".
- actions/credentials.js:197 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/credentials.js:223 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/credentials.js:253 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/credentials.js:264 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/credentials.js:342 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/credentials.js:489 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/credentials.js:651 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/guests.js:106 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in. Start it and wait for it to connect.
- actions/guests.js:112 — matched by test/suites/04-a-worker-credential/01-more-than-one-sign-in.js
  > "…" is on …. Take it back first — two machines holding one sign-in refresh the same token underneath each other, which is how a credential dies.
- actions/machines.js:351 — matched by test/suites/05-the-machines/02-what-a-machine-is-made-with.js, test/suites/10-the-supervisor/00-a-supervisor-is-not-a-runner.js
  > "…" is not a tag you can add. It is what keeps a machine out of the task pool and it decides what gets installed at first boot, so it is chosen when the machine is made — tick "supervisor machine" then, or make another one.
- actions/machines.js:404 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so it cannot be asked whether it is holding anything — and a claim released on a guess is how work stops existing anywhere. Start it first.
- actions/machines.js:507 — matched by test/suites/10-the-supervisor/04-the-conversation.js
  > "…" is already running, and one supervisor runs at a time. Two of them decide what work there is with no idea of each other — the same issue picked up twice, two branches cut for one piece of work. Stop "…" first.
- actions/machines.js:730 — matched by test/suites/05-the-machines/02-what-a-machine-is-made-with.js
  > Every machine keeps its console now, so this cannot be turned off for "…". It is attached when a machine is built and given to older ones at startup — a machine with no console is one that cannot be debugged when it will not boot, which is the only time anybody wants it. The file is truncated on every start, so it does not grow.
- actions/machines.js:1495 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" was not … after …s. A machine that is powered on and not dialled in is either still booting or stuck — vmScreenshot is the only thing that tells those apart.
- actions/machines.js:1515 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in. Start it and wait for it to connect.
- actions/machines.js:1619 — matched by test/suites/02-the-refusals/01-a-branch-is-not-named-by-accident.js
  > There is no branch called "…". Make it first, with a reason — branchCreate --branch … --reason "..." --group "..." — so what it is for and what it starts from are both recorded before anything is built on it. If that name is a typo, this is the refusal that catches it.
- actions/machines.js:1636 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in. Start it and wait for it to connect.
- actions/machines.js:1652 — matched by test/suites/05-the-machines/01-a-machine-comes-up-and-goes-away.js, test/suites/07-the-guards/03-one-machine-per-branch.js
  > "…" is set up on … and stays there until it is clean. To work on something else, go back to a snapshot taken before that branch — "Go back to it" says what it discards — or use another machine.
- actions/machines.js:1674 — matched by test/suites/05-the-machines/01-a-machine-comes-up-and-goes-away.js, test/suites/07-the-guards/03-one-machine-per-branch.js
  > "…" is already being worked on by "…". Two machines on one branch race for the same ref and the loser's commits strand. Pick another branch, or roll "…" back to a point before it.
- actions/machines.js:1787 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so a new token could not be delivered to it — and recording one here would lock it out for good. Start it, wait for it to connect, then try again.
- actions/runs.js:45 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so it cannot be given work.
- actions/runs.js:65 — matched by test/suites/07-the-guards/02-a-machine-is-not-asked-to-lose-work.js
  > "…"'s worker is signed out, so the work would fail the moment it started. Hand it the credential first: vmCredentialsPut --name …
- actions/runs.js:89 — matched by test/suites/07-the-guards/00-a-task-cannot-be-written-wrong.js
  > There is no contract at …. It is read from this host, not from the machine.
- actions/runs.js:139 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so its runs cannot be read.
- actions/runs.js:156 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/runs.js:169 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in.
- actions/runs.js:204 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so its sessions cannot be read.
- actions/runs.js:225 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so its session cannot be read.
- actions/runs.js:504 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so there is no address to open. Start it and wait for it to connect.
- actions/shared.js:133 — matched by test/suites/04-a-worker-credential/01-more-than-one-sign-in.js, test/suites/07-the-guards/02-a-machine-is-not-asked-to-lose-work.js
  > "…" is holding a worker credential, and a snapshot would keep a copy of it for as long as the snapshot exists. Take it back first: vmCredentialsForget --name …
- actions/shared.js:339 — matched by test/suites/10-the-supervisor/05-what-its-model-may-run.js
  > "…" is a runner, and only a supervisor machine has a sign-in desk. Every Claude sign-in happens on one machine, as a user that exists for nothing else — a runner is handed a credential when it works and never asks for one.
- actions/tasks.js:46 — matched by test/suites/02-the-refusals/01-a-branch-is-not-named-by-accident.js
  > There is no branch called "…" in this workspace. Cut it first, on the Branches tab — a task delivers on a branch, and one nobody has cut is work with nowhere to land.
- actions/tasks.js:142 — matched by test/suites/10-the-supervisor/00-a-supervisor-is-not-a-runner.js
  > A task cannot ask for a machine tagged "supervisor". Those are out of the pool for good — a supervisor decides what work to give and is never given any — so this task would sit queued for ever waiting for one.
- actions/tasks.js:173 — matched by test/suites/07-the-guards/00-a-task-cannot-be-written-wrong.js
  > There is no contract at …. It is read from this host when the task is given out.
- actions/tasks.js:182 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…". Ask for "jobs" to see what there is.
- actions/tasks.js:219 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > "…" has already been given to …. What it was asked and where it delivers cannot change now — that would rewrite the question its work answers. Write a new task, or take the verdict on this one first.
- actions/tasks.js:272 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…". Ask for "jobs" to see what there is.
- actions/tasks.js:413 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in. If it is off, the work is already over — the queue puts a machine away as soon as its run ends.
- actions/tasks.js:889 — matched by test/suites/07-the-guards/01-a-verdict-is-about-something.js, test/suites/08-a-task-on-a-machine/00-a-task-goes-out-and-comes-back.js
  > Nothing has arrived on "…", so there is nothing to judge. A worker that finished without pushing has delivered nothing.
- actions/tasks.js:924 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js, test/suites/05-the-machines/01-a-machine-comes-up-and-goes-away.js
  > "…" has no branch, and a machine is set up on one.
- actions/tasks.js:1056 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…".
- actions/tasks.js:1116 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…".
- actions/tasks.js:1128 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so it cannot be given anything.
- actions/tests.js:445 — matched by test/suites/02-the-refusals/01-a-branch-is-not-named-by-accident.js
  > There is no branch called "…" here. Cut it first.
- tasks/jobrun.js:34 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…".
- tasks/jobrun.js:78 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > The prompt "…" is not approved. What a worker is told is read before it is sent, the same as the script that sends it.
- tasks/jobs.js:190 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…".
- tasks/jobs.js:199 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…".
- tasks/jobs.js:208 — matched by test/suites/02-the-refusals/02-a-task-carries-what-it-was-given.js
  > There is no job called "…".
- tasks/store.js:308 — matched by test/suites/10-the-supervisor/00-a-supervisor-is-not-a-runner.js
  > A task cannot ask for a machine tagged "supervisor". Those are out of the pool for good — a supervisor decides what work to give and is never given any — so this task would sit queued for ever waiting for one.
- machines/channel.js:289 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" is not dialled in, so there is nothing to run a command on. Start it and wait for it to connect.
- repos/branches.js:575 — matched by test/suites/02-the-refusals/03-a-machine-is-not-asked-the-impossible.js
  > "…" has no branch called "…". Every branch in a group has to exist — it is what work will be cut from.
- repos/branches.js:643 — matched by test/suites/02-the-refusals/01-a-branch-is-not-named-by-accident.js
  > There is no branch called "…".
- repos/branches.js:1228 — matched by test/suites/02-the-refusals/01-a-branch-is-not-named-by-accident.js
  > There is no branch called "…" in any repository here, so there is nowhere to cut "…" from.
- repos/branches.js:1342 — matched by test/suites/02-the-refusals/01-a-branch-is-not-named-by-accident.js
  > There is no branch to delete.
- core/guests.js:137 — matched by test/suites/04-a-worker-credential/01-more-than-one-sign-in.js
  > "…" is on … right now. Take it back first — removing it here would leave a credential on a machine with nothing on this host knowing it is there.
- core/settings.js:94 — matched by test/suites/02-the-refusals/04-the-ways-round-a-refusal.js
  > "…" is not a setting. See DEFAULTS in core/settings.js — a setting that is not declared cannot be listed or explained.

## Drafts — refused by the code, checked by nothing

### actions/app.js

- **38** — No window is open, so there is nothing to press. This drives the real buttons in the real window; start the dashboard and try again.
- **52** — The window is only driven while testing mode is on for this workspace. … Until then this cannot … — a driven press reaches the same handlers a person's does, so it would be a way around every refusal this app makes about the command line. Ask with testsAsk, and answer it at the window.
- **276** — The window could not photograph itself: …
- **400** — No workspace is open, so there is nothing to ask about.
- **405** — Say what they are wanted for. A request with no reason is one somebody has to interrupt you to understand, which is the thing this exists to avoid.
- **443** — That was asked about …, and the folder open now is …. The request is cleared rather than answered — ask again here if that is what is wanted.
- **445** — No workspace is open, so there is nothing to allow.

### actions/branches.js

- **365** — Which branch, in which repository?
- **415** — No repository here has a branch called "…".
- **477** — Which branch do you want to work on?
- **479** — "…" is not a way to open work. It is "editor", "terminal", or "none".
- **488** — "…" is not in …, and a machine checks it out in every repository. Extend it first with branchCreate, saying which baseline group the missing repositories cut it from.
- **701** — Say which repository.
- **703** — There is no repository called "…" here.
- **790** — There are no repositories in … to sync.
- **900** — There is no line called "…".
- **951** — Say which repository.
- **953** — There is no repository called "…" here.
- **963** — Nothing in "…" has a matching branch on origin to catch up to.
- **1055** — "…" is not in both lines. … and … share ….
- **1078** — "…" is not in both lines.

### actions/credentials.js

- **90** — Say what to call it. A credential is kept under a name, and a list of "claude-code-2" is a list nobody can read six weeks later.
- **91** — There is already a sign-in called "…". Pick another name, or throw that one away first.
- **106** — The code was accepted and the desk on … has no credential to take. The sign-in did not finish — start it again.
- **214** — "…" did not offer a sign-in URL…)` : ''}. it said: … ……`}
- **224** — Say what the code is.
- **230** — "…" is not waiting for a code. Start it again with vmAuthBegin.
- **244** — "…" did not finish signing in…)` : ' (it is still waiting)'}. It said: …
- **355** — "…" is out on …. Take it back from there first — writing over it here would leave that machine signed in as an identity this host no longer has.
- **371** — "…" is a … sign-in and … is a …. One of the two is wrong, and guessing which would put the deciding identity in the pool the workers draw from — or the other way round.
- **383** — "…" has no worker credential to take. Sign in on that machine first: open it and run "claude auth login".
- **457** — This host holds no worker credential, so there is nothing to test. Add a Claude guest on the Virtual machines tab, or sign a machine in and take it with vmCredentialsGrab.
- **527** — This host's worker credential is dead — …. Nothing can revive it; get a new one on the Keys tab.
- **580** — "…" did not take the credential.

### actions/guests.js

- **82** — There is no guest called "…".
- **105** — "…" has no token file any more. It was removed by hand, or sealed by another account.
- **127** — "…" did not take the credential: …
- **142** — There is no guest called "…".
- **144** — "…" is not out on any machine.

### actions/host.js

- **94** — There is already a key. Making another one locks this app out of every machine built with the old one — say force to mean it.

### actions/machines.js

- **354** — "…" is a supervisor machine, so it keeps the "…" tag. Taking it off would put it in the queue's pool, and the first queued task would roll it back to its base snapshot while it was working.
- **408** — "…" could not be asked what it is holding: …
- **410** — "…" is still holding …. Push it, or throw the machine away deliberately — this only releases a branch there is nothing left to lose on.
- **734** — "…" is running. VirtualBox will not add or remove a serial port on a running machine — stop it first, which is worth knowing before a boot you wanted to watch.
- **773** — There is no earlier console for "…" at …. One is kept aside each time a machine starts, so there is none until it has been started twice with its console being captured.
- **775** — Nothing has been written to …. Either the console is not being captured — vmSerial --name … turns it on, with the machine off — or the guest has not been told to use ttyS0, which is a kernel command line and needs provisioning.
- **818** — "…" is not running, so its cable is not plugged into anything.
- **866** — Give the snapshot a title, so it means something when you come back to it.
- **874** — Shut the machine down first — a snapshot taken while it is running stores its memory too, which makes it enormous. "Make a clean starting point" does the shutting down for you.
- **924** — "…" is having its provisioning updated. One at a time — two machines booting and snapshotting at once is how one ends up half-set-up with no base to come back to. Wait for it, or watch it on the Runners tab.
- **926** — "…" is already having its provisioning updated.
- **929** — "…" claims …. This ends by putting the machine back to a clean state, which would discard whatever it is working on — let it off its branch first.
- **930** — "…" is borrowed — …. Give it back first.
- **1000** — The setup scripts did not report finishing within twenty minutes. Nothing has been snapshotted, so the machine is unchanged from its old base. Its own log is /var/log/okc-provision.log.
- **1068** — "…" was not re-provisioned: … It is left as it is, out of the pool — look at it on the Runners tab before giving it back.
- **1167** — Shut the machine down first — VirtualBox will not restore a snapshot while it is running.
- **1271** — There is no machine called "…".
- **1329** — "…" is not borrowed, so there is nothing to give back.
- **1340** — "…" is still holding …. Putting it away rolls it back to its base snapshot, which discards that. Push it, or give it back with keep=true to release the claim and leave the machine exactly as it is.
- **1451** — "…" did not say anything matching /…/ on its console within …s. vmLog --name … --which serial is what it did say.
- **1467** — "…" said nothing on its console within …s (…).
- **1484** — "…" was not … after …s.
- **1616** — Say which branch "…" is to work on.
- **1633** — "…" is not in …, and a machine checks it out in every repository. Extend it first — branchCreate --branch … --reason "..." --group "..." cuts it wherever it is missing and keeps the reason it already has.
- **1678** — There are no repositories in … to set up.
- **1712** — "…" is about …, and none of those are in ….
- **1742** — The workspace was not fully set up on … — see the live log.
- **1808** — "…" did not confirm it had taken the new token, so nothing here was changed. It is still using the old one.

### actions/repos.js

- **40** — Say which repository: "repo" for one in this workspace, or "on" as owner/name for any other.
- **42** — There is no repository called "…" in this workspace.
- **44** — "…" has no GitHub remote this host can read from.
- **392** — "…" carries nothing that "…" does not already have.
- **505** — Landing a cut from outside the window is only done while testing mode is on for this workspace. … A person pressing the button in the window is that person landing their own change; this is a model merging into somebody's repository, and that needs to have been said out loud first.
- **509** — Nothing has been cut from "…" into "…" from here.
- **569** — Deleting a branch on the fork from outside the window is only done while testing mode is on for this workspace. …
- **576** — There is no repository called "…" here. There is: ….
- **620** — There is no repository called "…" here. There is: ….
- **762** — Nothing has been cut from "…" into "…".
- **769** — A pull request is "open" or "closed".
- **772** — Nothing to change. Give a title, a description, or a state.
- **827** — There is no block called "…". There is: ….
- **845** — Those two lines are not both named here.
- **903** — A draft is about a pair of lines. Say which two.

### actions/runs.js

- **46** — Say what the task is.
- **84** — Give it either a contract file or the rules themselves, not both.
- **91** — The contract at … is empty, and an empty contract is worse than none: it reads as though rules were applied.
- **93** — The rules are empty, and empty rules are worse than none: everything downstream reports that a contract was applied.
- **111** — "…" did not start the work: …
- **180** — … …. Look at the machine — something there is ignoring both TERM and KILL.
- **372** — Nothing knows where "…" is. It has to have dialled in at least once for its address to be recorded — start it and wait, or look in VirtualBox.
- **433** — There is no command to run.
- **515** — "…" has not said enough about itself yet to open it.

### actions/shared.js

- **126** — "…" already has a snapshot called "…". VirtualBox would allow a second one, and then restoring by that name is a coin toss between them — pick another name, or throw the old one away first with vmSnapshotDelete.
- **152** — "…" is a path on this host, not on the machine. If you are in Git Bash it rewrote … on the way here; run it as MSYS_NO_PATHCONV=1 okc.js ... or write the path with two leading slashes.
- **260** — There is no line called "…". There is: ….
- **261** — There is no line called "…". There is: ….
- **262** — "…" cannot be landed into itself.
- **263** — "…" cannot be read: ….
- **264** — "…" cannot be read: ….
- **328** — There is no supervisor machine on this host. Make one with the "Supervisor machine" box ticked.
- **346** — There is more than one supervisor machine (…). Say which one.

### actions/tasks.js

- **69** — There is nothing kept under "…" — no task by that name, and no session either. Ask for "sessions" to see what is there.
- **126** — Pass the task as an object.
- **161** — Give it either a contract from the library or a file on this host, not both — otherwise which rules a run was under depends on which line of code read it first.
- **163** — There is no contract called "…".
- **245** — Give it either a contract from the library or a file on this host, not both — otherwise which rules a run was under depends on which line of code read it first.
- **248** — There is no contract called "…".
- **283** — There is no prompt called "…".
- **311** — #… has already been judged. Write a new task rather than reopening a decided one.
- **317** — #… is written for a person — the queue would roll a machine back and run Claude over the top of it. Take it yourself with taskWorkOn, or write it for a worker instead.
- **363** — #… is "…". Only a rejected task is sent back — an accepted one is finished, and anything else has not been judged yet.
- **366** — There is nothing to send back with. Say what is wrong.
- **411** — #… has never been given out, so there is nothing to stop.
- **425** — #… is "…", not queued. A task already given out is not called back by this — the worker is running and would have to be stopped on its machine.
- **467** — Say which machine is to do it.
- **468** — "…" has already been judged. Write a new task rather than reopening a decided one.
- **776** — There is nothing kept under "…", and no task by that name either.
- **864** — Say which repository.
- **883** — The verdict is "accept" or "reject".
- **891** — Say why it was rejected. A rejection with no reason is sent back to a worker that cannot ask what was wrong.
- **923** — "…" has already been judged. Write a new task rather than reopening a decided one.
- **961** — "…" is not on a machine.
- **1081** — Approving is done in the window, by a person who has read the script. A model may write one and may not approve its own.
- **1168** — There is no task called "…".
- **1169** — Give it either a prompt from the library or a task, not both — a task already carries the words it was written with.
- **1254** — There is no contract called "…". Write it first — the rules a prompt runs under are not a name typed into a box.
- **1268** — Approving is done in the window, by a person who has read it. A model may write a prompt and may not approve its own.
- **1322** — There is no contract called "…".
- **1345** — Approving is done in the window, by a person who has read it. A model may write a contract and may not approve its own.

### actions/tests.js

- **309** — … Reading what the drills left is always allowed — it is removing that is not.
- **428** — "…" is not a drill branch. This only ever commits on drill/ branches — a drill that could commit anywhere is a drill that can write into somebody's work.
- **432** — "…" is not a drill file. The name has to start with "drill-" so it cannot land on top of something somebody wrote.
- **438** — There is no repository called "…" here. There is: ….
- **457** — No repository here has a branch called "…". Cut it first.
- **571** — A run is already going. Wait for it, stop it with suiteStop, or it will report two answers about the same moment.
- **656** — No action called "…"
- **673** — "…" is not a repository in the open workspace. The drills reach … and nothing else — a drill that names another repository is writing to somebody's work on a live account.

### actions/workspaces.js

- **213** — Not while …. Finish or put that away first — switching now would leave it describing a workspace nobody is serving.
- **241** — Not while …. Finish or put that away first — closing now would leave it describing a workspace nobody is serving.

### core/chat.js

- **76** — "…" is not somebody who talks here. It is a person or a supervisor.
- **77** — "…" is not a way in. It is ….
- **79** — There is nothing to say.
- **83** — that is … characters, and the most a message takes is 20000. Put anything longer where it belongs — a task brief, or a file on a branch.

### core/github.js

- **141** — Paste a GitHub token.
- **142** — That has whitespace in it, so it is not a token — check what was copied.
- **160** — That token was not kept: …
- **199** — This host holds no GitHub token, so nothing can be pushed onward. Add one on the Keys tab.

### core/guests.js

- **105** — "…" is not a name for a guest. Letters, digits, dash, dot and underscore, up to 64 — it is a filename and a label in a list, so it is refused rather than changed into something you would not recognise.
- **108** — A guest needs a Claude token. It is sealed to this account and never shown again.
- **109** — There is already a guest called "…". Remove it first, or pick another name — replacing one silently would take a credential away from whatever is using it.
- **135** — There is no guest called "…".
- **185** — There is no guest called "…".
- **196** — There is no guest called "…".
- **220** — There is no guest called "…".

### core/keys.js

- **72** — openssl was not found, so a certificate cannot be made. Git ships one; check that git is installed.

### core/secret.js

- **61** — This credential was sealed on Windows and can only be opened there, by the account that sealed it.

### core/settings.js

- **100** — could not keep that setting: …

### core/workspaces.js

- **149** — There is no folder at ….
- **171** — There is no folder at ….
- **204** — That is the workspace in use. Close it, or switch to another one, before forgetting it.

### machines/busy.js

- **30** — "…" is already …. Wait for that to finish — one of these at a time, because they leave the machine half-way in between and VirtualBox will refuse the second with an error about a session lock.

### machines/dispatch.js

- **47** — That text contains a line reading exactly "…", which is the marker used to send it to the machine. Change that line.

### machines/editor.js

- **46** — The editor is set to …, and there is nothing there.
- **105** — There is no folder to open.
- **179** — There is no folder to open for "…". Set one in its settings.

### machines/job-api.js

- **78** — the dashboard answered ' + (headers.split('
- **249** — a job does not choose which conversation to continue — the task does, and it is restored automatically. Remove `resume`.
- **254** — there is no brief to give a worker — pass one, or run this job with a prompt
- **272** — claude is not installed on this machine, so it cannot be given work
- **352** — the worker was still going after … minutes, so it was stopped
- **383** — the worker stopped: ' + (said.result || 'it did not say why
- **389** — the worker exited … having said: …
- **407** — this run was not told where the dashboard is

### machines/provisioner.js

- **33** — Give it a name using letters, numbers, dots or dashes — no spaces.
- **157** — Choose an installer image. VirtualBox knows about: …
- **162** — No installer image matching "…". VirtualBox knows about: …
- **182** — There is no network adapter called "…".
- **186** — No network adapter is up to bridge onto. Use NAT instead, or say which adapter.
- **318** — VirtualBox is not installed, or not where this expected to find it.
- **326** — VirtualBox already has a machine called "…". Pick another name — this app will not touch a machine it did not make.
- **400** — "…" has no installer image, so there is nothing to install.
- **402** — "…" is running. Shut it down before installing.

### machines/scripts.js

- **124** — "…" is not a provisioning file.
- **129** — There is no provisioning script called "…".

### machines/store.js

- **41** — No machine called "…"
- **46** — Give the machine a name.
- **48** — That name has no letters or numbers in it.
- **49** — There is already a machine called "…".
- **50** — An ssh machine needs a host, like user@address.
- **70** — No machine called "…"
- **71** — This machine cannot be turned into something else.
- **80** — This machine cannot be removed.

### machines/vbox.js

- **298** — VirtualBox did not say which host-only adapter it made: …
- **334** — Could not work out this machine\'s address on the network, so a guest would have no way to reach it.
- **432** — "…" is not running, so it has nothing on screen.
- **707** — "…" is not a VirtualBox log. Ask for VBox.log, VBox.log.1 and so on, or "service" for VBoxSVC.log.

### machines/vms.js

- **66** — "…" is not a virtual machine this app made, so it will not touch it.
- **72** — This app already has a virtual machine called "…".

### repos/branches.js

- **565** — Give the group a name — it is what a task will be based on.
- **573** — There is no repository called "…" here.
- **608** — There is no group called "…".
- **612** — "…" cannot be proposed: …. A line with a branch missing from it is not a thing anybody can read.
- **623** — There is no group called "…".
- **644** — "…" is not in any repository here, so there is no line to make from it.
- **654** — "…" already names exactly these branches. Two lines naming the same branches carry nothing between them, so a change from one into the other would always be empty — use that one, or forget it first.
- **670** — There is no group called "…".
- **1056** — There is no repository called "…" here.
- **1057** — A file to commit needs a plain relative path.
- **1170** — Say what "…" is for. A branch with no reason is one nobody can account for later — which is how a workspace ends up with names that cannot be told apart from mistakes.
- **1218** — Say either which line "…" is cut from or which branch, not both — they are two different starting points and only one of them can be true.
- **1223** — "…" cannot be cut from itself.
- **1259** — There is no baseline group called "…".….` : ' None have been named yet — name one on the Baselines tab.'}
- **1262** — "…" cannot be cut from: …. A group is only a place to start from while every branch in it still exists.
- **1296** — "…" names no repository that is in this workspace, so there is nowhere to cut "…". It names ….
- **1362** — No repository here has a branch called "…".

### repos/remotes.js

- **360** — "…" has no GitHub remote to open a pull request on.
- **477** — "…" has no GitHub remote.
- **496** — Could not delete "…" on …/…: …`}
- **513** — "…" has no GitHub remote to sync.
- **515** — "…" is not a fork of anything this app knows about, so there is nothing upstream to pull from.
- **518** — Nothing says which branch of "…" to sync.
- **538** — Could not sync "…" from …: …
- **694** — "…" is not a repository — it is written owner/name.
- **729** — GitHub has no repository called "…", or this host's token cannot see it.
- **731** — GitHub answered … for the … on "…"…` : ''}

### tasks/artifact.js

- **212** — There is no repository called "…" here.
- **229** — There is no repository called "…" here.

### tasks/contracts.js

- **78** — Give it a name. A contract with no name is one nobody finds again.
- **83** — Write the rules. An empty contract is worse than none — it reads as though rules were applied.
- **87** — That name has no letters or numbers in it.
- **118** — There is no contract called "…".
- **126** — There is no contract called "…".
- **135** — There is no contract called "…".

### tasks/files.js

- **74** — there was nothing in it
- **75** — that is … MB, and the most this takes is … MB
- **135** — There is no file called "…" for that task.
- **137** — That is … MB. Open it from the folder rather than in a panel.
- **144** — "…" is not text — it has bytes no editor would show. Open it from the folder.
- **156** — There is no file called "…" for that task.

### tasks/harness.js

- **56** — requires() must be called inside a suite
- **130** — it() must be called inside describe()
- **159** — draft() must be called inside describe()
- **172** — cleanup() must be called inside describe()
- **197** — keep() must be called inside describe()
- **235** — … — expected something matching /…/, got: …

### tasks/jobrun.js

- **35** — "…" has no script. Its file is missing from the jobs folder.
- **68** — #… has no brief, so there is nothing to give the job.
- **76** — There is no prompt called "…".
- **87** — The prompt "…" runs under the contract "…", and there is no such contract. It will not be sent without the rules it was approved with.
- **121** — "…" did not start it: …

### tasks/jobs.js

- **140** — Give it a name. A job with no name is one nobody finds again.
- **144** — That name has no letters or numbers in it.

### tasks/prompts.js

- **84** — Give it a name. A prompt with no name is one nobody finds again.
- **86** — Write the prompt. An empty one would be handed to a worker as an empty instruction.
- **90** — That name has no letters or numbers in it.
- **143** — There is no prompt called "…".
- **151** — There is no prompt called "…".
- **160** — There is no prompt called "…".

### tasks/queue.js

- **637** — Waited … for … and it did not happen…` : ''}

### tasks/sessions.js

- **179** — that is not a session id
- **180** — there was nothing in it
- **181** — that is … MB, and the most this takes is … MB
- **240** — there is no session kept for that task

### tasks/store.js

- **168** — There is no task "…". Ask for the board to see what there is — a number, a uid or a name all work.
- **183** — Give the task a title, so the board is readable at a glance.
- **185** — Say what the work is. The brief is what the worker is actually told.
- **187** — Name the branch this task delivers on. That branch is the artifact, and a task with nowhere to deliver cannot be judged.
- **343** — "…" is not a state a task is put into. Working and delivered are read from the run and the branch, not set.

