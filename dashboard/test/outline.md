<!-- generated: node dashboard/test/outline.js --write -->
<!-- 12 suites, 25 tests, 124 checks, 25 of them drafts -->

## 25 drafts, not written yet

- **a worker credential / a worker can sign in** — and no two machines hold the same credential at once
  THE LOCK, and it can be written today. There is one credentials/claude.json, lent to whoever is working. vmCredentialsPut checks the machine is dialled in and that the credential is not dead, and says nothing about who else is holding it — so two machines working at once would run as the same worker against the same session. The check is "at most one machine reports holdsCredential", asked while work is in flight. It would fail right now if two tasks were dispatched at once, which is the honest way to start: a guard that would catch the thing nobody has hit yet. The queue serialises most work, which is why it has not bitten.
- **a worker credential / a worker can sign in** — and two machines can work at once, each with a credential of its own
  THE FEATURE, and it needs building before this can pass. Multi-credential logic: a SET of worker credentials kept here rather than one file, one handed to each machine while it works and taken back after, and a machine that cannot be given one waiting rather than borrowing somebody else's. Until that exists the check above is the whole story and two machines cannot both work — which is the point of kit-1 and kit-2 and is not reachable today. THE CHECK: dispatch two tasks at once, both run, and the two machines report different credentials. WHAT TO SETTLE FIRST, because these change the shape rather than the code. (1) Where does a second sign-in come from — credentialsBegin on another machine, a different account, or the same account signed in twice? (2) Is a credential PINNED to a machine or drawn from a pool per job? Pinned is simpler to reason about and wastes one per idle machine; pooled is the same shape as the machines themselves, which the queue already knows how to do. (3) What does the Keys tab show — one row per credential, with who holds it now? A count and a holder, never a value: the rule that a model may know something was done in there and not what still holds.
- **a worker credential / a worker can sign in** — and the credential never travels as cleartext in a shell command
  IT DOES TODAY. vmCredentialsPut opens the sealed file, base64s it, and sends `printf '%s' '<the whole credential>' | base64 -d > ~/.claude/.credentials.json` down the channel. Base64 is not encryption. TLS covers the wire and core/secret.js covers the file at rest; what neither covers is the middle — a plain string in this host's memory, a shell argument visible in `ps` on the guest, and a line in its history. WHAT IT NEEDS: a key exchange between host and guest, so the credential is sealed to that machine and the dashboard hands over a blob it cannot read. That carries the authorize URL up as well as the credential down. THE CHECK: what is sent to the machine contains no part of the credential, and the machine still authenticates afterwards. The second half is what makes it a check rather than a rule about strings.
- **a worker credential / a worker can sign in** — and signing a worker in is a job, not a sequence written into this app
  credentialsBegin and credentialsFinish are guest commands hard-coded in actions/credentials.js and machines/auth.js — written before there was any other way to run a sequence of commands on a machine. There is one now: a job is a script that runs ON a machine, read and approved before it does. WHAT IT WOULD BUY: the flow becomes editable without a release, and the sign-in URL stays on the machine rather than being logged here. THE STICKING POINT, which is why this is a draft and not a task: a credential is NOT an artifact and must not be handed back like one. A job hands files back; this one would have to hand back something the host stores sealed and never shows, which is a hole in the job API rather than a thing to write around. THE CHECK: the sign-in runs as an approved job, the credential arrives sealed on this host, and no URL or token appears in the log.
- **a worker credential / a worker can sign in** — and what is taken back is what the worker refreshed
  IT IS DELETED TODAY. vmCredentialsForget removes ~/.claude/.credentials.json from the machine and this host keeps its original copy — so every refresh the CLI does during a run is thrown away at the end of it, and the next machine is handed a token that is one or more rotations behind. vmCredentialsGrab already does the taking-back half; nothing calls it when work ends. THE CHECK: run a task, and afterwards the credential this host holds is the one the machine finished with. Compared by a FINGERPRINT of it rather than by reading it — the rule is that this app may know something changed in the Keys tab without knowing what. AND IT SETTLES A QUESTION ON ITS OWN: if the fingerprint moves, the refresh token rotates, and one credential shared between machines is not a tidiness problem but a broken design. If it never moves, sharing is survivable and multi-credential is about throughput instead.
- **a worker credential / a worker can sign in** — and each machine keeps its own credential across a rollback
  A MACHINE IS ROLLED BACK TO BASE WHEN ITS WORK ENDS, which wipes the disk — so a credential on a machine cannot survive by staying there, and the base snapshot must never contain one (a snapshot of a machine holding one keeps a copy for as long as the snapshot exists, which is why vmBaseSnapshot refuses it). So per-machine means kept HERE, sealed, one per machine: handed over when it starts work, taken back — refreshed — when the work ends, and handed to the same machine next time. THE CHECK: give a machine work twice with a stop in between, and both runs use that machine's own credential, with no machine ever holding another's. TO SETTLE: what happens when there are more machines than credentials — a machine waits, or work waits. Waiting for a credential is the same shape as waiting for a machine, which the queue already knows how to do.
- **a worker credential / a worker can sign in** — and the .claude folder can be thrown away without losing the token
  THE GAP TO BRIDGE, and half of it is already built. `machines/job-api.js` archives ~/.claude per task and excludes .credentials.json on purpose — that folder is the worker's MEMORY and is kept for a long time, so an unsealed token riding along would be filed for ever. The consequence is that memory and credential are two different things with two different lifetimes, and only one of them has somewhere to live. WHAT IT WOULD MEAN: the token is set up and kept through the same path the memory uses — captured when the run ends, sealed here, per machine — so ~/.claude on the guest becomes disposable. Trash it, restore the memory, hand back the token, and the machine is where it was. THE CHECK: delete ~/.claude on a machine entirely, start its next task, and it both remembers what it was doing and authenticates.
- **a worker credential / a worker can sign in** — and the Keys tab lists every Claude credential, by machine
  ONE TODAY, AND THE TAB IS BUILT FOR ONE. credentialsHeld answers about a single file: held, from where, taken when, and the two clocks. With one per machine that becomes a list — a row per credential, which machine holds it now, when it was last refreshed, and whether the last attempt to USE it worked. NEVER A VALUE. The rule for this tab is that a model may know something was done in there and not what: a count, a holder, a date, a fingerprint. THE CHECK: with two credentials held, the tab lists two rows naming their machines, and nothing in the answer contains a token. AND THE COLUMN NOTHING HAS TODAY: whether the last USE failed. credentialsHeld reported a refresh token good until September while a worker was being refused with it — the sentence came back from claude() and was thrown away.
- **a worker credential / more than one sign in** — and what comes back off a machine is what the worker refreshed
  HALF BUILT, AND THE HALF THAT IS MISSING IS THE PROOF. vmCredentialsForget and guestBack now READ the credential off the machine before clearing it, and core/guests.js keeps it when the fingerprint differs — so a rotation during a run is no longer deleted. What has not happened is a run that demonstrates it. THE CHECK: lend a guest to a machine, give that machine real work that uses Claude, take the guest back, and the fingerprint this host holds is the one the machine finished with. Compared by fingerprint and never by value. AND IT SETTLES A QUESTION ON ITS OWN: if the fingerprint moves, the refresh rotates and one sign-in shared between machines is a broken design rather than an untidy one. If it never moves, sharing is survivable and one-per-machine is about throughput instead. IT COSTS A WORKER RUN, which is why it is here rather than in the checks above — those need no machine at all.
- **a worker credential / more than one sign in** — and two machines work at once, each as its own identity
  THE FEATURE THE LIST WAS FOR, and it is now reachable: guests are named, one is chosen per machine, a machine records which it holds, and a second machine asking while every guest is out is REFUSED rather than handed somebody else's. What is untested is the whole of it running at once. THE CHECK: with two guests held, dispatch two tasks at the same time, both run, and the two machines report different sign-ins — then both come back and neither guest is left marked as out. WHAT IT WILL PROBABLY FIND FIRST: the queue serialises most work, so getting two runs genuinely overlapping is the harder half of writing this.
- **a worker credential / more than one sign in** — and a machine that can be given no identity waits rather than borrowing one
  THE REFUSAL EXISTS AND NOTHING ACTS ON IT. vmCredentialsPut throws when every guest is out, naming who holds what — which is right, and turns into a failed dispatch rather than a task that waits. Waiting for a credential is the same shape as waiting for a machine, and tasks/queue.js already knows how to do that: a task asking for a tag waits for a machine with that tag rather than taking any machine. THE CHECK: with one guest and two machines, dispatch two tasks — the second waits, and runs when the first gives its guest back, rather than failing. TO SETTLE FIRST: whether a guest is PINNED to a machine or drawn from a pool per job. Pinned wastes one per idle machine; pooled is the shape the machines themselves already have.
- **a task on a machine / a task goes out and comes back** — and a task that pushed something can be accepted
  THE ACCEPT PATH, and no job here can reach it. api-tour hands back a FILE and never commits, so the branch is exactly as it was cut and taskJudge refuses — correctly. ask-a-worker would push, and needs a Claude credential, which makes it a different and slower drill. WHAT IT NEEDS: a job that makes a small change and pushes it, written and approved at the window, because approving a job over the wire is refused on purpose. THE CHECK: queue a task under that job, let the queue run it, and accept the delivery — the verdict is recorded, the task reads accepted, and the artifact it was judged on is named in the verdict. AND ACCEPTING MUST NOT MERGE. Landing work is a separate act with its own rules; a verdict that quietly merged would make reading the work and publishing it the same button.
- **a task on a machine / a task goes out and comes back** — and every call the jobs API offers is proven, one at a time
  EXERCISED, NOT PROVEN. A job running on a machine is handed a set of calls — read its task, post an artifact, hand back and fetch its session, report what happened — and this suite uses whichever of them api-tour happens to need. The ones nothing uses are the ones that break quietly, and the failure arrives disguised as a task that did not work. THE CHECK: from a machine, ask every endpoint machines/job-api.js exposes, one at a time, and state both halves — what it answers, and what it REFUSES. The refusals are the half worth the drill: a machine asking for another machine's task, for a session that is not its own, or posting an artifact while running nothing at all. THE PATTERN IS ALREADY WRITTEN. "what survives the machine" posts to /artifact and /session from a machine exactly as job-api.js does, without spending a worker run — this is that, made complete rather than made of the two calls a drill needed. AND IT IS THE MODEL FOR THE OTHER DIRECTION: a supervisor asking this host for work needs the same drill pointed the opposite way. See the supervisor suite.
- **judging / a judgement is work of its own** — a judgement is a task whose subject is a PR cut
  THE SHAPE, and none of it exists. Today taskJudge writes a verdict onto the task that produced the work — a field, set by a person at a command line. What is wanted is the same chain with one end changed: branch <- task <- job <- prompt <- contract is the work; PR CUT <- task <- job <- prompt <- contract is judging it. Work delivers onto a branch; a judgement delivers onto the cut — one pull request per repository that carries something, taken as one act — because that is what is actually being judged: the change as it is proposed for landing, not a commit and not a branch. IT TAKES NO BRANCH OF ITS OWN, which follows from that: it reads rather than writes, and a task claiming a branch it never pushes to would hold a machine on that branch for no reason. WHY IT MATTERS BEYOND TIDINESS: a task gets a machine, a run, a log and a record of what it saw. A field gets none of those, so "why was this accepted" is answerable only by asking whoever typed it. AND job <- prompt <- contract IS ALREADY BUILT, with a tab of its own and an approval per substance — so a judging job is a job, its prompt is a prompt, its contract is a contract, and nothing new appears in the library. The only new thing is the left-hand end. THE CHECK: judge an open cut, and a task exists whose subject is that cut, with its own job and its own run, holding no branch.
- **judging / a judgement is work of its own** — and an open cut is what asks for one
  THE TRIGGER, and it is not somebody deciding to judge a task. A cut is opened when work is proposed for landing — that is the moment the change stops being one machine's business and becomes something to be read — so an open cut is a thing WAITING to be judged, and the app should say so without being asked. WHICH IS WHY IT IS THE CUT AND NOT THE TASK: a cut may carry work from more than one task, and a task may deliver nothing worth landing. Judging follows the change, not the occasion that produced it. THE CHECK: open a cut, and it appears as awaiting a judgement — before anybody has typed anything. Land or close it, and it stops asking. NOT AUTOMATIC, AND THAT IS DECIDED. An open cut ASKS; it does not start anything. The judgement is begun by a button on the cut's own card, so the cut reads as unjudged until a person presses it. Automatic would make a queue of judgements running unattended against somebody's repository, reporting to GitHub, with nobody having chosen this cut or this chain — which is the same thing this app already refuses about approving a job down a pipe. Asking is free; acting is a decision. THE OTHER HALF OF THE CHECK: an open cut with nobody pressing anything stays unjudged for ever, and nothing runs.
- **judging / a judgement is work of its own** — and the Judge tab, Judgements, lists what is waiting and what was decided
  A TAB OF ITS OWN, CALLED JUDGE, and the first of its two sub-tabs is Judgements — two columns. THE HOME IT NEEDS. "Judge it" used to be a button on the task's own card, so the screen that asked for a decision showed the QUESTION and not the answer. It was removed rather than moved, and there is nowhere to do this today. WHAT IT LISTS: every open cut — which are waiting, which have a judgement in flight, which were decided and what the verdict was. That is the same shape as the task board one level up, and it is what makes judging something you can be BEHIND ON rather than something you remember to do. WHAT THE OTHER COLUMN IS FOR: the delivery. A verdict is somebody reading what came back, so the screen is built around it — the cut's commits, the diff, the files handed back, the run's log, and the buttons under all of it, including the one that starts a judgement. THE CHECK: with one cut open and one judged, both are listed under the right heading, and the judged one names its verdict and the run behind it.
- **judging / a judgement is work of its own** — and the Judge tab, judges, lists the chains that can do the judging
  THE SECOND SUB-TAB, CALLED JUDGES — three columns, one per rung: job <- prompt <- contract. A JUDGE IS A COMBINATION, and that is the word this needed. The library lists the three substances one at a time, because that is how each is written and approved; a judge is the whole chain — this job, giving these words, under these rules — and picking one from three separate lists asks somebody to recombine in their head what the app already knows. WHAT IT LISTS: every job whose prompt and contract are approved, as the chain it is, with the ones that cannot run naming the rung that is missing. THE DATA IS ALREADY THERE: `jobs` reports `runnable` and `whyNot`, and whyNot names the one rung rather than saying "not approved" about the thing that plainly is. Nothing shows it combined. THE CHECK: with one judge approved end to end and one whose contract is not, both are listed, the first as runnable and the second naming the contract. TO SETTLE: whether a judge is chosen per cut, or a cut has a default one — a repository where every cut is judged the same way should not be asked the same question every time.
- **judging / a judgement is work of its own** — and it is done by either kind of supervisor
  A person reading a diff and a worker running checks are the same act with a different body — which is what the spine already says about who supervises, and the reason judging should not be a special case bolted to a task. A judging job might run the tests, read the diff against the contract, or do nothing but wait for a person. THE CHECK: the same judgement, given to a worker and given to a person, produces the same kind of record — a verdict, a note, and what it was judged on. TO SETTLE: whether a person's judgement is a run at all, or a task that is completed without one. Every other kind of work here has a run behind it.
- **judging / a judgement is work of its own** — and the verdict reaches the PR cut it is landing through
  A verdict lives on a task and stops there. The work it is about is landing through a PR cut — one pull request per repository that carries something — and somebody reading that cut cannot see whether anything was judged. THE CHECK: judge the work on a branch that has a cut open, and the cut reports it — which repositories were judged, by what, and whether the verdict still describes what is there. The last part is the hard part: a judgement made before another push is a judgement of something else. `judgements` in actions/repos.js already reasons about exactly that and nothing calls it — see test/unused.md.
- **judging / a judgement is work of its own** — and GitHub is told, beside the pull request
  THE OUTWARD HALF. Anybody looking at the change on GitHub — which is where a reviewer looks — has no way to know this app checked it. A verdict belongs there: a status or a check beside the pull request, saying what was run and what it found. THE CHECK: after a judgement, the pull request on the parent carries a status naming this app and the verdict. TO SETTLE: whether that is a commit status, a check run, or a comment — a comment is the easiest and the least useful, since it cannot gate a merge. And whether a rejection blocks the merge button, which is a decision about somebody else's repository rather than about this app.
- **judging / a judgement is work of its own** — and a rejection says what happens to the work
  NOT A CHECK YET, BECAUSE THE BEHAVIOUR IS NOT DECIDED — and this is the sharpest example of why an undecided thing must not be written as one. taskJudge refuses a rejection with no reason, because "a rejection with no reason is sent back to a worker that cannot ask what was wrong". Nothing is sent anywhere. TO SETTLE: does a rejection re-queue the same task so a worker sees the note and tries again, write a NEW task carrying it, or is it only a record about work that is finished? The first keeps one identity and needs the attempts kept — they are, in `attempts`. The second makes "what happened to this piece of work" span two numbers. The third is what the code does today, and the wording says otherwise. One of those is true by accident. Deciding which is meant is the work, and a check written now would enshrine the accident.
- **judging / a judgement is work of its own** — and taskJudge is replaced rather than removed
  It is the placeholder this design grew around: a verdict recorded on a task, from before there was a shape for judging. It refuses a verdict on a branch nothing arrived on, and that refusal is proven in 08 and in the guards — so it is doing real work today. THE CHECK, when the rest of this suite is built: nothing calls taskJudge except the thing that replaces it, and the board shows a judgement where it used to show a field. Kept until then, because the alternative is a period with no way to record a verdict at all.
- **the supervisor / a supervisor is not a runner** — and the jobs API a runner uses is proven end to end
  IT IS EXERCISED AND NOT PROVEN, which are different. A job on a machine is handed a set of calls — fetch its task, post an artifact, hand back its session, report a run — and suite 08 uses several of them by running a real task through the queue with the api-tour job. What is missing is a check of the API ITSELF: every call it offers, asked directly, with the answers and the refusals stated. Today a call that quietly stopped working would show up as a task that failed for some other-looking reason, twenty minutes into a drill that needs a machine. THE CHECK: from a machine, exercise every endpoint the jobs API exposes — the ones that should answer, and the ones that should be REFUSED when asked by a machine that is not running that task. Suite 08 already posts to /artifact and /session exactly as machines/job-api.js does, so the pattern is written; what is missing is the list being complete rather than the two calls a drill happened to need. AND IT IS THE MODEL FOR THE SUPERVISOR API BELOW, which is the other reason to write it first: the same drill shape, pointed at the other direction.
- **the supervisor / a supervisor is not a runner** — and a supervisor holds no repositories and gets no project setup
  HALF BUILT AND UNPROVEN. first-boot.sh skips the project's extra.sh and extra-user.sh when OKC_SUPERVISOR is yes, and runs supervisor-user.sh instead — node, Claude Code, and a folder to think in. That is the intent; nothing has watched it happen. THE CHECK: build a machine with the supervisor box ticked, and afterwards it has claude, has no clone of anything, and its first-boot log says the project setup was skipped. It is the same shape as the provisioning suite's checks and costs the same: one install. WHY IT MATTERS BEYOND TIDINESS: the project's half is what knows about repositories and devices, and a supervisor that ran it would hold a copy of the work it is supposed to be handing out — which is the difference between deciding and doing.
- **the supervisor / a supervisor is not a runner** — and a supervisor is signed in as a supervisor, not as a worker
  THE LIST KNOWS THE DIFFERENCE AND NOTHING ACTS ON IT YET. core/guests.js keeps two roles: a guest is lent to a machine for a task, a supervisor is spent by this host, and lending a supervisor to a machine is refused outright — see the credential suite. A supervisor MACHINE is the case that sits between those two: it is a machine, it needs a Claude sign-in, and the sign-in it needs is the supervising one. Today the refusal would stop it, correctly, because the refusal was written when the only machines were runners. THE CHECK: a supervisor machine is handed a supervisor sign-in and no runner ever is; a runner asking for one is refused, and a supervisor asking for a guest is refused too. TO SETTLE: whether it is lent at all or whether a supervisor machine holds one for as long as it exists. A runner is rolled back between tasks so its credential must leave; a supervisor is not rolled back, which is exactly why leaving one on it needs deciding rather than assuming.

# 00 — what this host has

The first thing, and the only suite whose job is to **stop**.

## 00 — before anything else

  1. a folder of repositories is open
  2. and drills are allowed to run here
  3. and a GitHub token that still works

# 01 — the order

The order every piece of work goes through here, stated as a series and checked in that order.

## 00 — a cut comes first

  1. a task cannot be written on a branch that does not exist yet
  2. a cut is made, on a line
  3. and now the task can be written on it

## 01 — a draft can change

  1. a cut to work on, and a contract to be held to
  2. a task written on it is a draft, and a draft can be rewritten
  3. and it carries a COPY of the rules, not a pointer to them

## 02 — a cut becomes a line

  1. a cut is made
  2. while it is a cut, it is not protected
  3. promoting it to a line protects it
  4. and a line is not deleted like an ordinary branch

## 03 — a change goes out and comes back

  1. a cut is made, and a change is committed on it
  2. what the cut carries can be read, on the cut
  3. a cut becomes a line before it leaves
  4. and now it can be compared with the line it was cut from
  5. and it leaves as one pull request, from the repository that carries something
  6. the pull requests are merged as one act
  7. the fork is behind its parent, and syncing pulls it up
  8. and this host follows, with the change on its default branch
  9. and the branch it came from is taken off the fork
  10. and nothing is left behind here

# 02 — the refusals

What this app will not do, proved by asking it to do each thing and reading what it says back.

## 00 — approving is refused over the wire

  1. a job cannot be approved down the pipe
  2. a prompt cannot be approved down the pipe
  3. a contract cannot be approved down the pipe

## 01 — a branch is not named by accident

  1. setting a machine up on a branch that does not exist is refused
  2. a cut must start from a line or a cut, and not both
  3. a cut must say what it is for

## 02 — a task carries what it was given

  1. a task under a contract that is not approved is refused
  2. a task cannot name a job that does not exist
  3. what a task was asked cannot change once it is out

## 03 — a machine is not asked the impossible

  1. a machine that is not dialled in cannot be given a workspace
  2. a branch nobody has is not a branch to sync

# 03 — the machines are built

The warming stage, and the beginning of everything else: two machines defined,

## 00 — two machines built from nothing

  1. there are two machines to work with, or an ISO and permission to build them
  2. they are defined, with their consoles captured before anything boots
  3. and both installers run at the same time
  4. and both write a system to disk and boot it
  5. and provisioning runs on both, from the scripts this host serves
  6. and both dial in, if they were just built
  7. and both answer, with somewhere to be put back to
  8. and the install of each is on the record

# 04 — a worker credential

The second door a person has to open, and it is deliberately not beside the

*stands on the machines are built*

## 00 — a worker can sign in

  1. this host holds a worker credential
  2. and it has not expired past refreshing
  3. and a machine can really sign in with it
  4. **DRAFT** — and no two machines hold the same credential at once
  5. **DRAFT** — and two machines can work at once, each with a credential of its own
  6. **DRAFT** — and the credential never travels as cleartext in a shell command
  7. **DRAFT** — and signing a worker in is a job, not a sequence written into this app
  8. **DRAFT** — and what is taken back is what the worker refreshed
  9. **DRAFT** — and each machine keeps its own credential across a rollback
  10. **DRAFT** — and the .claude folder can be thrown away without losing the token
  11. **DRAFT** — and the Keys tab lists every Claude credential, by machine

## 01 — more than one sign in

  1. the sign-ins are a list, and every one of them has a name
  2. and nothing that reports one hands back its token
  3. and a supervisor is refused when a machine asks for it
  4. and one that is out on a machine cannot be thrown away
  5. **DRAFT** — and what comes back off a machine is what the worker refreshed
  6. **DRAFT** — and two machines work at once, each as its own identity
  7. **DRAFT** — and a machine that can be given no identity waits rather than borrowing one

# 05 — the machines

The half of this app the other suites can only describe. Everything before this

*stands on the machines are built*

## 00 — a machine at rest

  1. every machine this app made is known to it
  2. a machine that is not running claims no branch
  3. and holds no credential it was lent
  4. and at least one is free for the queue to use

## 01 — a machine comes up and goes away

  1. two branches to work on, and a machine to work on one
  2. it is borrowed, and it dials in
  3. and it answers
  4. it is set up on the branch, and claims it
  5. and it is not moved off the branch it is on
  6. and a second machine, dialled in, is not handed the same branch
  7. and it goes away clean

# 06 — provisioning

What a machine is handed, and how a change to it reaches one.

*stands on the machines*

## 00 — a change reaches a machine

  1. the app serves the script that is on disk
  2. and the header it promises is on the front of it
  3. and the change made to it is in there
  4. and a live machine fetching it gets the same thing

# 07 — the guards

The rules that stop work being lost — a task written wrong, a verdict about nothing, a machine asked to give up what it is holding.

*stands on the order and the machines and the machines are built and a worker credential*

## 00 — a task cannot be written wrong

  1. a task with nowhere to deliver is refused
  2. a cut to write the rest of these against
  3. a contract that is not there is refused

## 01 — a verdict is about something

  1. an empty cut, and a task delivering on it
  2. a verdict on a branch with nothing on it is refused
  3. a rejection with no reason is refused

## 02 — a machine is not asked to lose work

  1. a machine of our own, up and holding a credential
  2. a machine holding a credential cannot be snapshotted
  3. and once it is signed out, it is not given work

## 03 — one machine per branch

  1. a machine is not moved off the branch it is on
  2. a branch already claimed is not handed to a second machine

# 08 — a task on a machine

The point of the whole tool, and the last part of it that nothing checked.

*stands on the machines and the order*

## 00 — a task goes out and comes back

  1. there is a machine free, a job to run, and this was asked for
  2. a cut is made, and a task is written on it
  3. and queued — after which nothing here touches it
  4. the queue gives it to a machine, on its own
  5. the work runs there and the task ends
  6. and what it did came back here
  7. and the machine was put away clean
  8. and judging it is refused, because this worker pushed nothing
  9. **DRAFT** — and a task that pushed something can be accepted
  10. **DRAFT** — and every call the jobs API offers is proven, one at a time

## 01 — what survives the machine

  1. a machine, a cut, and a task in flight on it
  2. a file the machine hands over is kept here
  3. and the memory a worker keeps goes back and comes forward again
  4. and the token that went up comes back the same

# 09 — judging

Reading what came back and saying yes or no — and it is **work**, not a field.

*stands on a task on a machine and the order*

## 00 — a judgement is work of its own

  1. **DRAFT** — a judgement is a task whose subject is a PR cut
  2. **DRAFT** — and an open cut is what asks for one
  3. **DRAFT** — and the Judge tab, Judgements, lists what is waiting and what was decided
  4. **DRAFT** — and the Judge tab, judges, lists the chains that can do the judging
  5. **DRAFT** — and it is done by either kind of supervisor
  6. **DRAFT** — and the verdict reaches the PR cut it is landing through
  7. **DRAFT** — and GitHub is told, beside the pull request
  8. **DRAFT** — and a rejection says what happens to the work
  9. **DRAFT** — and taskJudge is replaced rather than removed

# 10 — the supervisor

The machine that decides what work there is, rather than one doing it.

*stands on the machines are built*

## 00 — a supervisor is not a runner

  1. a supervisor machine is one the queue never offers
  2. and the tag that makes it one cannot be typed on
  3. and it cannot be typed off one that has it
  4. and a task cannot ask to be run on one
  5. **DRAFT** — and the jobs API a runner uses is proven end to end
  6. **DRAFT** — and a supervisor holds no repositories and gets no project setup
  7. **DRAFT** — and a supervisor is signed in as a supervisor, not as a worker

## 01 — driving the app

  1. a supervisor machine is up, and it can ask what it may do
  2. and everything else does not exist for it
  3. and it can cut a branch, write a task on it, and queue it
  4. and the machine it runs on is never given work itself

# 11 — cooling the host

The last suite, and the only one that takes things away.

*stands on the machines are built*

## 00 — the host is left as it was found

  1. this was asked for
  2. nothing of the kit's is still holding anything
  3. and the kit's machines are removed, disks and all
  4. and nothing the drills made is left on this host
