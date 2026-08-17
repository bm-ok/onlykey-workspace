<!-- generated: node dashboard/test/outline.js --write -->
<!-- 12 suites, 45 tests, 210 checks, 18 of them drafts -->
<!-- What this app can do, in the order a person does it. Generated; do not edit. -->
<!--
  TWO USES, AND THE SECOND IS THE ONE THAT GETS FORGOTTEN:

    a net       these run against this app for real, and half of them pass by
                being REFUSED.
    a catalogue every capability there is, named, in one place. Read it before
                building a mechanism. The last thing nearly built twice was a
                setting for "where may a supervisor's work go" — the app
                already had "keep it back from tasks", and a second lever for
                one more kind of asker is how two of them come to disagree.

  A capability with no check here is one somebody will build again.
-->

## 18 drafts, not written yet

- **the refusals / the ways round a refusal** — and the window cannot be driven while the drills are off
  THE REFUSAL: "The window is only driven while testing mode is on for this workspace." — actions/app.js. It matters more than it looks: windowClick and windowFill reach the SAME handlers a person's press reaches, so an unguarded one is a way around every refusal this app makes about the command line — approving a job, landing a change, switching the drills on. WHY IT IS NOT A CHECK HERE: a drill runs only while testing mode is on, which is exactly when this is allowed. Proving the refusal means turning testing mode OFF, which stops the drills. HOW TO WRITE IT: from outside the kit — a script that turns testing mode off at the window, calls windowClick over the wire, sees the refusal, and turns it back on. That is a person-driven drill rather than one the harness can run, and it belongs in the same family as the sign-in that needs somebody to visit a page. WHAT CAN BE CHECKED FROM HERE AND IS NOT YET: that a press driven from outside carries the mark — press an APPROVE button through windowClick and watch it refused for being over the wire. That proves the anti-bypass property without turning anything off. See drivenFromTheWire in ui/base.js.
- **the refusals / the ways round a refusal** — and a change cannot be landed from outside the window while the drills are off
  THE REFUSAL: "Landing a cut from outside the window is only done while testing mode is on for this workspace… this is a model merging into somebody's repository, and that needs to have been said out loud first." — actions/repos.js. It is the one act in this app with consequences outside this host: everything before a merge is reversible from GitHub and a merge is not. WHY IT IS NOT A CHECK HERE: same as above — the drills run with testing mode on, which is the state in which this is permitted. THE CHECK, WHEN THERE IS A WAY TO WRITE IT: with testing mode off, prCutLand over the wire is refused and names the window; with it on, the refusal is not what stops it — a cut that is not ready still is. AND THE RELATED ONE WORTH HAVING EITHER WAY: a supervisor is refused prCutLand whatever testing mode says, because it is not on its list at all. That one IS checked — see the supervisor suite.
- **a worker credential / a worker can sign in** — and signing a worker in is a job, not a sequence written into this app
  credentialsBegin and credentialsFinish are guest commands hard-coded in actions/credentials.js and machines/auth.js — written before there was any other way to run a sequence of commands on a machine. There is one now: a job is a script that runs ON a machine, read and approved before it does. WHAT IT WOULD BUY: the flow becomes editable without a release, and the sign-in URL stays on the machine rather than being logged here. THE STICKING POINT, which is why this is a draft and not a task: a credential is NOT an artifact and must not be handed back like one. A job hands files back; this one would have to hand back something the host stores sealed and never shows, which is a hole in the job API rather than a thing to write around. THE CHECK: the sign-in runs as an approved job, the credential arrives sealed on this host, and no URL or token appears in the log.
- **a worker credential / a worker can sign in** — and each machine keeps its own credential across a rollback
  A MACHINE IS ROLLED BACK TO BASE WHEN ITS WORK ENDS, which wipes the disk — so a credential on a machine cannot survive by staying there, and the base snapshot must never contain one (a snapshot of a machine holding one keeps a copy for as long as the snapshot exists, which is why vmBaseSnapshot refuses it). So per-machine means kept HERE, sealed, one per machine: handed over when it starts work, taken back — refreshed — when the work ends, and handed to the same machine next time. THE CHECK: give a machine work twice with a stop in between, and both runs use that machine's own credential, with no machine ever holding another's. TO SETTLE: what happens when there are more machines than credentials — a machine waits, or work waits. Waiting for a credential is the same shape as waiting for a machine, which the queue already knows how to do.
- **a worker credential / a worker can sign in** — and the .claude folder can be thrown away without losing the token
  THE GAP TO BRIDGE, and half of it is already built. `machines/job-api.js` archives ~/.claude per task and excludes .credentials.json on purpose — that folder is the worker's MEMORY and is kept for a long time, so an unsealed token riding along would be filed for ever. The consequence is that memory and credential are two different things with two different lifetimes, and only one of them has somewhere to live. WHAT IT WOULD MEAN: the token is set up and kept through the same path the memory uses — captured when the run ends, sealed here, per machine — so ~/.claude on the guest becomes disposable. Trash it, restore the memory, hand back the token, and the machine is where it was. THE CHECK: delete ~/.claude on a machine entirely, start its next task, and it both remembers what it was doing and authenticates.
- **a worker credential / more than one sign in** — and what comes back off a machine is what the worker refreshed
  HALF BUILT, AND THE HALF THAT IS MISSING IS THE PROOF. vmCredentialsForget and guestBack now READ the credential off the machine before clearing it, and core/guests.js keeps it when the fingerprint differs — so a rotation during a run is no longer deleted. What has not happened is a run that demonstrates it. THE CHECK: lend a guest to a machine, give that machine real work that uses Claude, take the guest back, and the fingerprint this host holds is the one the machine finished with. Compared by fingerprint and never by value. AND IT SETTLES A QUESTION ON ITS OWN: if the fingerprint moves, the refresh rotates and one sign-in shared between machines is a broken design rather than an untidy one. If it never moves, sharing is survivable and one-per-machine is about throughput instead. IT COSTS A WORKER RUN, which is why it is here rather than in the checks above — those need no machine at all.
- **a worker credential / more than one sign in** — and two machines work at once, each as its own identity
  THE FEATURE THE LIST WAS FOR, and it is now reachable: guests are named, one is chosen per machine, a machine records which it holds, and a second machine asking while every guest is out is REFUSED rather than handed somebody else's. What is untested is the whole of it running at once. THE CHECK: with two guests held, dispatch two tasks at the same time, both run, and the two machines report different sign-ins — then both come back and neither guest is left marked as out. WHAT IT WILL PROBABLY FIND FIRST: the queue serialises most work, so getting two runs genuinely overlapping is the harder half of writing this.
- **a worker credential / more than one sign in** — and a machine that can be given no identity waits rather than borrowing one
  THE REFUSAL EXISTS AND NOTHING ACTS ON IT. vmCredentialsPut throws when every guest is out, naming who holds what — which is right, and turns into a failed dispatch rather than a task that waits. Waiting for a credential is the same shape as waiting for a machine, and tasks/queue.js already knows how to do that: a task asking for a tag waits for a machine with that tag rather than taking any machine. THE CHECK: with one guest and two machines, dispatch two tasks — the second waits, and runs when the first gives its guest back, rather than failing. TO SETTLE FIRST: whether a guest is PINNED to a machine or drawn from a pool per job. Pinned wastes one per idle machine; pooled is the shape the machines themselves already have.
- **a task on a machine / a task goes out and comes back** — and a task that pushed something can be accepted
  THE ACCEPT PATH, and no job here can reach it. api-tour hands back a FILE and never commits, so the branch is exactly as it was cut and taskJudge refuses — correctly. ask-a-worker would push, and needs a Claude credential, which makes it a different and slower drill. WHAT IT NEEDS: a job that makes a small change and pushes it, written and approved at the window, because approving a job over the wire is refused on purpose. THE CHECK: queue a task under that job, let the queue run it, and accept the delivery — the verdict is recorded, the task reads accepted, and the artifact it was judged on is named in the verdict. AND ACCEPTING MUST NOT MERGE. Landing work is a separate act with its own rules; a verdict that quietly merged would make reading the work and publishing it the same button.
- **judging / a judgement is work of its own** — and GitHub is told, beside the pull request
  THE OUTWARD HALF, and the only part of the original nine that is still true as a draft. Anybody looking at the change on GitHub — which is where a reviewer looks — has no way to know this app read it. A verdict belongs there: a status or a check beside the pull request, saying what was run and what it found. THE CHECK: after a judgement of a PR cut, the pull request on the parent carries a status naming this app and the verdict. TO SETTLE, AND STILL UNSETTLED: whether that is a commit status, a check run, or a comment — a comment is the easiest and the least useful, since it cannot gate a merge. And whether a rejection blocks the merge button, which is a decision about somebody else's repository rather than about this app. WHAT HAS CHANGED SINCE THIS WAS FIRST WRITTEN: everything inward. The verdict exists, it is the judge's own, it is current or stale against the tips it was made on, and prCutMake already refuses to send out work a judgement has rejected. So this is now the last mile rather than the whole road.
- **the supervisor / an issue becomes a pull request** — a person opens an issue and the supervisor reads it
  THE TRIGGER, AND IT IS THE PART THAT IS NOT BUILT. `whatsNew` carries what was said, tasks, machines, cuts and what happened — and NOT issues or pull requests. So a supervisor waking on a quiet host is never told that an issue arrived; it can ASK (`issues` is on its list, and it did) but only because the wake reason named it. Without that it would wake, see nothing new, and go back to sleep with an open issue sitting there. WHAT HAS TO EXIST FIRST: `whatsNew` reporting open issues and incoming pull requests, and something that wakes the supervisor when one arrives. This app deliberately never asks GitHub on a timer, so that is a decision rather than a line of code — poll on a slow cadence, or check on every wake and rely on other things waking it. THE CHECK: with an issue open that the supervisor has not been told about, wake it for an unrelated reason, and it still finds the issue. Today it does not, and the run above only worked because the wake reason said "a new issue arrived on local-repo-c: #2".
- **the supervisor / an issue becomes a pull request** — and a judge decides whether the claim is real before any work is written
  THIS HALF IS BUILT AND WAS PROVEN. `taskCreate` over the wire refuses without `becauseOf` naming a FINISHED judgement, and in the real run the supervisor tried twice to get round it — once passing a prose sentence as the ref, once leaving it off — before reasoning its way to "the issue's claim has to be checked first". The refusal text is what taught it the path, which is the argument for refusals that say what to do next. THE CHECK, as a drill rather than the unit version in `judging`: from an issue, the supervisor produces a judgement of the claim BEFORE any task exists, and the task that follows names that judgement. The unit refusals are already checked — see "the judge is the gate" — so what this adds is that a supervisor actually walks it.
- **the supervisor / an issue becomes a pull request** — and the work is judged again before it goes out
  BUILT, AND THE SECOND JUDGEMENT IS THE ONE THAT MATTERS. J31 established the claim was real; J32 read what the task delivered. `prCutMake` refuses over the wire unless a judgement of that line has finished, is not stale against the tips it was made on, and did not reject. A judgement made before the last push does not count — which is exactly the case here, because J31 was made before the fix was pushed. THE CHECK: after the task delivers, sending the change out is refused until a judgement made AFTER that push has accepted it. Then it goes.
- **the supervisor / an issue becomes a pull request** — and the pull request carries the issue it came from
  THE ONE THAT BROKE, AND IT BROKE SILENTLY. The supervisor wrote "Closes #2 — <url>" into the draft with `prDraftSave`, then called `prCutMake`, which read only its `body` argument and ignored the draft entirely. The pull request went out as template blocks, titled after the LINE, with no closing keyword anywhere in it — so the issue stayed open through the merge and had to be closed by hand. Nothing failed, nothing warned, and the only way to find it was to ask GitHub what the body actually said. FIXED — the body and the title fall back to the saved draft — so this is now a check that can be written rather than a draft. It is here rather than done because it needs a real cut against GitHub, which is a drill with somebody's repository at the end of it. THE CHECK: save a draft naming an issue URL, cut without passing a body, and the pull request on GitHub carries the draft's title and its issue link. And the merge closes the issue, which is the whole point of the keyword and is the thing that was actually wanted.
- **the supervisor / an issue becomes a pull request** — and one cut, never one repository
  BUILT AND ENFORCED BY THE ARGUMENT TYPE. `prCutMake` takes two LINE names and `twoLines` refuses anything that is not a line, so a raw branch cannot be sent out — it has to be made a line first, and the line is what goes out as one act with one pull request per repository that carries something. There is no per-repository PR action anywhere, and none on the supervisor's list. THE CHECK: with a line carrying commits in one repository of three, one pull request is opened and the cut records it as one landing; and `prCutMake` given a branch name rather than a line name is refused.
- **the supervisor / somebody elses pull request** — a judge investigates an arrived pull request
  NOT BUILT: a judgement's subject is a branch in this workspace or a cut this host made, and a stranger's pull request is neither — `judgementCreate` refuses it outright. So there is nothing to allow yet, which is why the gate above landed first. WHAT HAS TO EXIST: a subject of kind "pull" — repository, number and head sha — refused unless `allowed.check` says yes at THAT sha, so an allowance and a judgement cannot drift apart. WHAT THE OPERATOR ASKED IT TO DO, in their words: why, what and where the changes were made; whether other repositories need changes that are not there (a pull request that is half a change is the case this app exists to catch — one repository cannot half-land); whether the code is proper to check at all; then a rundown of how the project says it should work, and a re-check of exactly what the change touched. GREEN MEANS THREE THINGS AT ONCE: it is safe, it does what it intends, and it is exactly what the pull request says it is. Any one of those failing is not green. TO SETTLE: whether "check it" ever means RUNNING the contributor's code. Reading a diff is much cheaper to make safe; running its tests is what makes "it does what it says" a verdict rather than an opinion — and it is arbitrary execution by a stranger on a machine holding a credential. The proposal on the table is to split them: the read is a Claude judge under a contract that forbids running the change, and the test is a credential-free shell job whose output the judge then reads.
- **the supervisor / somebody elses pull request** — and what it found is reported back on the pull request
  NOT BUILT: nothing in this app can write to a pull request or an issue. `prCutUpdate` changes a title, a description or a state, and there is no comment anywhere. So a judge can read somebody's change and reach a verdict that only this host can see, which is half a review. WHAT HAS TO EXIST: an action that posts a comment to a pull request in THIS workspace — taking a repository this host holds rather than an owner/name, or the restriction the operator set ("these three forks and no others") leaks straight through the new door. THE CHECK: after a judgement of an arrived pull request, the pull request carries a comment naming this app, the verdict, and what was checked. And a comment cannot be posted to a repository the workspace does not hold. TO SETTLE: whether a rejection comments at all. A green light is useful to a contributor; a red one written by a model on somebody's work is a different act, and it may want a person to press it.
- **the supervisor / somebody elses pull request** — and a merge somewhere else does not leave what is out unmergeable
  NOT BUILT, and it is the first thing here that is maintenance rather than work somebody asked for. When anything lands, every open PR cut is measured against a base that has moved — so a change that was mergeable an hour ago now conflicts, and nobody finds out until somebody presses Merge. WHAT THE OPERATOR ASKED FOR: on a merge, the supervisor checks its open cuts for conflicts and fixes them properly, so what is out stays mergeable. WHAT HAS TO EXIST: something that notices a merge (the same trigger gap as everywhere else here), a way to ask "would this still merge" per cut, and a task shape for "bring this line up to the base it is landing into". THE CHECK: land something into a line that two open cuts are based on, and both cuts are reported as needing attention; after the supervisor has dealt with them, both merge cleanly. TO SETTLE, AND IT IS THE INTERESTING PART: a rebase or a merge changes what a judge already accepted. If J32 accepted a line and the line then moves to a new base, the verdict is stale by the same rule everything else here uses — so "keep it mergeable" implies "and judge it again", and the cost of keeping ten cuts current is ten more judgements. Whether that is worth it, or whether cuts should simply be told they are stale and left, is a decision nobody has made.

# 00 — what this host has

The first thing, and the only suite whose job is to **stop**.

## 00 — before anything else

  1. a folder of repositories is open
  2. and drills are allowed to run here
  3. and a GitHub token that still works
  4. and every machine that is not the kit's is kept back while it runs

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

*stands on what this host has*

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

## 04 — the ways round a refusal

  1. the drills cannot be switched on by anything but a person at the window
  2. and a request to run them cannot answer itself
  3. and the settings that can be changed are named, not assumed
  4. a press driven from the command line is still the command line
  5. **DRAFT** — and the window cannot be driven while the drills are off
  6. **DRAFT** — and a change cannot be landed from outside the window while the drills are off

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
  4. **DRAFT** — and signing a worker in is a job, not a sequence written into this app
  5. **DRAFT** — and each machine keeps its own credential across a rollback
  6. **DRAFT** — and the .claude folder can be thrown away without losing the token

## 01 — more than one sign in

  1. the sign-ins are a list, and every one of them has a name
  2. and nothing that reports one hands back its token
  3. and a supervisor is refused when a machine asks for it
  4. and one that is out on a machine cannot be thrown away
  5. **DRAFT** — and what comes back off a machine is what the worker refreshed
  6. **DRAFT** — and two machines work at once, each as its own identity
  7. **DRAFT** — and a machine that can be given no identity waits rather than borrowing one

## 02 — what comes back

  1. a throwaway identity can be lent to a machine
  2. and a change made on the machine is what comes back
  3. and nothing is left on the machine

## 03 — one list and who may hold what

  1. every credential this host holds is in one list, with a holder
  2. and nothing in the answer is a token
  3. and a supervisor sign-in belongs on a supervisor machine
  4. and a worker sign-in never goes to the supervisor

## 04 — two machines two identities

  1. two machines are up, and this host holds two identities
  2. and each machine can hold its own at the same time
  3. and one identity cannot be on two machines
  4. and a machine with nothing free to hand it is refused, not given somebody else's

## 05 — nothing travels as cleartext

  1. a machine is dialled in, and this host has something to hand it
  2. and nothing sent to the machine carries any part of it
  3. and the machine ends up holding exactly it
  4. and the key that could open it does not outlive the handover

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

## 02 — what a machine is made with

  1. every machine writes its console somewhere
  2. and it cannot be turned off
  3. and every machine is in a pool
  4. and clearing a machine's tags puts it back in the default one
  5. and a machine keeps the tags it was made with
  6. and a supervisor keeps the one tag that is not a label
  7. and a borrow can ask for a kind rather than whatever is idle

## 03 — a machine lets this app in

  1. this app has a key of its own, and knows which machines take it
  2. and a machine that is dialled in can be given it
  3. and giving it twice does not write it twice
  4. and a machine that is not dialled in is refused, rather than half-done

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

## 03 — a machine kept back is left alone

  1. a machine can be kept back from the queue
  2. and a borrow will not take it either
  3. and it is not offered as a pool a supervisor could use
  4. and giving it back puts it where it was

## 03 — one machine per branch

  1. a machine is not moved off the branch it is on
  2. a branch already claimed is not handed to a second machine

# 08 — a task on a machine

The point of the whole tool, and the last part of it that nothing checked.

*stands on the machines and the order and the machines are built*

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

## 01 — what survives the machine

  1. a machine, a cut, and a task in flight on it
  2. a file the machine hands over is kept here
  3. and the memory a worker keeps goes back and comes forward again
  4. and the token that went up comes back the same

## 02 — the jobs api call by call

  1. a machine is running a task, which is what most of this surface answers
  2. and every call it offers answers
  3. and it cannot ask about a task that is not its own
  4. and a file handed over is filed under the task, not under a name it chose

## 03 — watching it work

  1. a run is asked for a stream, not one object at the end
  2. and the reader takes the last result line, or a whole-file object
  3. and the watcher it writes is node that runs
  4. and whichever run is happening now has a name that does not change
  5. and the supervisor takes its turn the same way

## 04 — what a worker is handed

  1. a run is given the three commands, and each is made executable
  2. and none of them carries a credential
  3. and okc-say never fails the work it was describing
  4. and the skill is fetched per run, not installed once

# 09 — judging

Reading what came back and saying yes or no — and it is **work**, not a field.

*stands on the order*

## 00 — a judgement is work of its own

  1. a judgement is asked for against a branch cut, and gets a ref of its own
  2. and the same subject is not judged twice at once
  3. and a job for doing work cannot be run as a judge
  4. and a judgement is filed against something that exists
  5. and what it is reading cannot be changed while it reads it
  6. **DRAFT** — and GitHub is told, beside the pull request

## 01 — the judge is the gate

  1. a task written over the wire without a judgement is refused
  2. and naming a judgement that has not finished is not enough
  3. and a judgement that does not exist is not a way round it
  4. and the same task, written at the window, is allowed

## 02 — two libraries one queue

  1. a judge cannot be given to a task
  2. and both kinds wait in one line, with judgements in front
  3. and the order is written down once, where the queue reads it

# 10 — the supervisor

The machine that decides what work there is, rather than one doing it.

*stands on the machines are built and what this host has and a worker credential and the supervisor and judging*

## 00 — a supervisor is not a runner

  1. a supervisor machine is one the queue never offers
  2. and the tag that makes it one cannot be typed on
  3. and it cannot be typed off one that has it
  4. and a task cannot ask to be run on one

## 01 — driving the app

  1. a supervisor machine is up, and it can ask what it may do
  2. and everything else does not exist for it
  3. and it may send a change out, and not land it
  4. and all it can see of the machines is their names and their tags
  5. and what it proposes waits for a person
  6. and it can cut a branch, write a task on it, and queue it
  7. and the machine it runs on is never given work itself

## 02 — reading a long list

  1. a repository with thousands of issues comes back one page at a time
  2. and the next page is a different page
  3. and pull requests page the other way, with a count
  4. and a repository in this workspace answers about its parent

## 03 — the two apis

  1. a runner and a supervisor are both up, and this host knows which is which
  2. and the runner is refused the supervisor API
  3. and the supervisor is refused the jobs API
  4. and each still gets its own

## 04 — the conversation

  1. a person can say something, and it is recorded as a person saying it
  2. and the supervisor cannot say something as you
  3. and what it says is signed with the machine that said it
  4. and a message is not read until it has been handed over
  5. and a receipt never goes backwards
  6. and two supervisors are never running at once

## 05 — what its model may run

  1. a supervisor machine is up, with its tool server and its gate
  2. and the tool server offers exactly what this host allows
  3. and the gate denies everything that is not one of them
  4. and the sign-in desk holds nothing
  5. and only a supervisor machine has a desk at all
  6. and it holds no repositories, and got none of the project setup

## 06 — the sign in it works with

  1. which sign-in it uses is one answer, asked in one place
  2. and "in use" is not the same question as "free to hand over"
  3. and signing one in is idempotent, quiet, and never starts anything
  4. and what it is signed in as is on its own state

## 07 — an issue becomes a pull request

  1. **DRAFT** — a person opens an issue and the supervisor reads it
  2. **DRAFT** — and a judge decides whether the claim is real before any work is written
  3. **DRAFT** — and the work is judged again before it goes out
  4. **DRAFT** — and the pull request carries the issue it came from
  5. **DRAFT** — and one cut, never one repository

## 08 — somebody elses pull request

  1. an incoming pull request is not judgeable until somebody says so
  2. and an allowance names the commit, not the pull request
  3. and STALE is its own answer, because it is neither of the other two
  4. and a model cannot allow one
  5. and it is not on the supervisor's list at all
  6. **DRAFT** — a judge investigates an arrived pull request
  7. **DRAFT** — and what it found is reported back on the pull request
  8. **DRAFT** — and a merge somewhere else does not leave what is out unmergeable

# 11 — cooling the host

The last suite, and the only one that takes things away.

*stands on the machines are built*

## 00 — the host is left as it was found

  1. this was asked for
  2. nothing of the kit's is still holding anything
  3. and the kit's machines are removed, disks and all
  4. and nothing the drills made is left on this host
  5. and the machines the kit kept back are available again
