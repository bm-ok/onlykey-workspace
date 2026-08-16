<!-- generated: node dashboard/test/outline.js --write -->
<!-- 11 suites, 21 tests, 97 checks, 14 of them drafts -->

## 14 drafts, not written yet

- **a worker credential / a worker can sign in** — and no two machines hold the same credential at once
  THE LOCK, and it can be written today. There is one credentials/claude.json, lent to whoever is working. vmCredentialsPut checks the machine is dialled in and that the credential is not dead, and says nothing about who else is holding it — so two machines working at once would run as the same worker against the same session. The check is "at most one machine reports holdsCredential", asked while work is in flight. It would fail right now if two tasks were dispatched at once, which is the honest way to start: a guard that would catch the thing nobody has hit yet. The queue serialises most work, which is why it has not bitten.
- **a worker credential / a worker can sign in** — and two machines can work at once, each with a credential of its own
  THE FEATURE, and it needs building before this can pass. Multi-credential logic: a SET of worker credentials kept here rather than one file, one handed to each machine while it works and taken back after, and a machine that cannot be given one waiting rather than borrowing somebody else's. Until that exists the check above is the whole story and two machines cannot both work — which is the point of kit-1 and kit-2 and is not reachable today. THE CHECK: dispatch two tasks at once, both run, and the two machines report different credentials. WHAT TO SETTLE FIRST, because these change the shape rather than the code. (1) Where does a second sign-in come from — credentialsBegin on another machine, a different account, or the same account signed in twice? (2) Is a credential PINNED to a machine or drawn from a pool per job? Pinned is simpler to reason about and wastes one per idle machine; pooled is the same shape as the machines themselves, which the queue already knows how to do. (3) What does the Keys tab show — one row per credential, with who holds it now? A count and a holder, never a value: the rule that a model may know something was done in there and not what still holds.
- **a worker credential / a worker can sign in** — and the credential never travels as cleartext in a shell command
  IT DOES TODAY. vmCredentialsPut opens the sealed file, base64s it, and sends `printf '%s' '<the whole credential>' | base64 -d > ~/.claude/.credentials.json` down the channel. Base64 is not encryption. TLS covers the wire and core/secret.js covers the file at rest; what neither covers is the middle — a plain string in this host's memory, a shell argument visible in `ps` on the guest, and a line in its history. WHAT IT NEEDS: a key exchange between host and guest, so the credential is sealed to that machine and the dashboard hands over a blob it cannot read. That carries the authorize URL up as well as the credential down. THE CHECK: what is sent to the machine contains no part of the credential, and the machine still authenticates afterwards. The second half is what makes it a check rather than a rule about strings.
- **a worker credential / a worker can sign in** — and signing a worker in is a job, not a sequence written into this app
  credentialsBegin and credentialsFinish are guest commands hard-coded in actions/credentials.js and machines/auth.js — written before there was any other way to run a sequence of commands on a machine. There is one now: a job is a script that runs ON a machine, read and approved before it does. WHAT IT WOULD BUY: the flow becomes editable without a release, and the sign-in URL stays on the machine rather than being logged here. THE STICKING POINT, which is why this is a draft and not a task: a credential is NOT an artifact and must not be handed back like one. A job hands files back; this one would have to hand back something the host stores sealed and never shows, which is a hole in the job API rather than a thing to write around. THE CHECK: the sign-in runs as an approved job, the credential arrives sealed on this host, and no URL or token appears in the log.
- **a task on a machine / a task goes out and comes back** — and a task that pushed something can be accepted
  THE ACCEPT PATH, and no job here can reach it. api-tour hands back a FILE and never commits, so the branch is exactly as it was cut and taskJudge refuses — correctly. ask-a-worker would push, and needs a Claude credential, which makes it a different and slower drill. WHAT IT NEEDS: a job that makes a small change and pushes it, written and approved at the window, because approving a job over the wire is refused on purpose. THE CHECK: queue a task under that job, let the queue run it, and accept the delivery — the verdict is recorded, the task reads accepted, and the artifact it was judged on is named in the verdict. AND ACCEPTING MUST NOT MERGE. Landing work is a separate act with its own rules; a verdict that quietly merged would make reading the work and publishing it the same button.
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

# 10 — cooling the host

The last suite, and the only one that takes things away.

*stands on the machines are built*

## 00 — the host is left as it was found

  1. this was asked for
  2. nothing of the kit's is still holding anything
  3. and the kit's machines are removed, disks and all
  4. and nothing the drills made is left on this host
