The path through this app, once
================================

What somebody does from opening this for the first time to landing a change and
stopping. Every step is one thing, in order, with the tab and the button on it.

It is a NARRATIVE, not a reference. `README.md` says how each part works and what
it refuses; this says what order the parts are touched in — the thing a new
person cannot get from a list of features, and the thing an end-to-end drill
needs in order to be end-to-end.

Steps 1–4 are set-up and happen once ever. 5–9 are a piece of work. 10–13 are
landing it and stopping. Somebody returning tomorrow starts at OPEN A FOLDER OF
REPOSITORIES only if they closed it, and otherwise at CUT A BRANCH TO WORK IN.

Every command named is the same action the button calls. Verified against
`okc.js` — if one is not in that list, this file is wrong and the list is right.


OPEN A FOLDER OF REPOSITORIES
------------------------------

1. Click the workspace chip, left of the tabs. On a first run it reads
   `no workspace`, and it is the only thing worth clicking.
2. Read what it says: a workspace is a folder whose subdirectories are git
   repositories. Every other tab is a statement about one, so they are switched
   off by name until there is one.
3. Add a folder on the right. `okc.js workspaceAdd --dir <path>`
4. Confirm the chip now names the folder rather than saying `no workspace`.
5. Go to LOOK AT WHAT IS THERE.


LOOK AT WHAT IS THERE
----------------------

1. Open the Repositories tab.
2. Click Repos. Every repository found in the folder is listed, with its default
   branch. Nothing was configured; they were found.
3. Click Overview. This is everything waiting across all of them — the one
   question GitHub's own pages cannot answer, because they are per-repository.
4. Click Ask GitHub only if a token is set. It is empty until then, and that is
   correct rather than broken. `okc.js repositories`
5. Change nothing here. This is the "what am I looking at" tab.
6. Go to GIVE IT THE CREDENTIALS IT CANNOT INVENT.


GIVE IT THE CREDENTIALS IT CANNOT INVENT
------------------------------------------

1. Open the Keys tab. Three sections, used at opposite ends of the app.
2. Worker sign-in — the Claude credential. Sign one machine in yourself; the
   credential is taken off it and kept here, and every other machine is handed a
   copy when it needs one. Skip this if no work will call Claude.
   `okc.js credentialsBegin` hands back a URL. `okc.js credentialsHeld` reads it.
3. GitHub — a token used by this host only. Machines push to this app's own git
   server and never to GitHub, so no runner is ever handed it. Skip this if
   nothing will leave this computer. `okc.js githubKeySet --token <t>`
4. This app's own keys — the certificate a machine verifies this host by, and the
   ssh key this host gets back in with. Both are made for you. Read what remaking
   one costs before pressing it. `okc.js hostKeys`
5. Go to MAKE A MACHINE.


MAKE A MACHINE
---------------

1. Open the Virtual machines tab. This is the slow step and it is done once.
2. Press +. Give it a name, memory, processors, disk, network, and the user to
   create. `okc.js vmCreate --vm '{"name":"runner1", ...}'`
3. Press Install it. Twenty-five minutes, unattended.
   `okc.js vmInstall --name runner1`
4. Do NOT restart the dashboard while that runs. The install fetches its scripts
   from this host at the very end, and a restart at the wrong moment throws the
   whole thing away.
5. Press See its screen if it goes quiet. It is the only thing that answers
   "working or stuck" before the machine dials in.
   `okc.js vmScreenshot --name runner1`
6. When it is ready, press Take a snapshot of it and call it `base`.
   `okc.js vmSnapshotTake --name runner1 --title base`
7. Confirm the machine now reads: off, on its base snapshot, claiming nothing,
   holding nothing. That is the resting state it returns to after every task.
8. Go to CUT A BRANCH TO WORK IN.


CUT A BRANCH TO WORK IN
------------------------

1. Open the Branches tab, sub-tab Cuts.
2. Know the difference before pressing anything. A cut is a branch this app made,
   across every repository a line touches. A line is the same thing PROTECTED:
   work is merged into a line and never done on one. That is the whole
   difference, and it is why only cuts are offered as somewhere to work.
3. Press +. Name it — `feature/fix-name` — give a reason, and say what it starts
   from: a line, or another cut, never both.
   `okc.js branchCreate --branch feature/thing --reason "..." --group <line>`
4. Write the reason properly. It is what the branch is for, read months later by
   somebody deciding whether it can be deleted.
5. Press Work on it to jump straight to the next title with the cut filled in.
6. Go to WRITE THE TASK.


WRITE THE TASK
---------------

1. Open the Tasks tab, sub-tab Add task. Two columns: what it will carry on the
   left, the form on the right.
2. Know what a task is: what a worker is told, and the branch it delivers on.
   Writing one touches no machine.
3. Type a title. Pick the branch cut. Write the brief as instructions to somebody
   who cannot ask you a question.
4. Leave job, prompt and contract as "none" for now. Most work needs none of
   them; they are for when the same brief is being retyped for the third time.
5. If you do want them, they live on the Actions tab and are written right to
   left: Contracts (the rules — what a worker may NOT do), then Prompts (the
   words, naming the contract they hold to), then Jobs (the script that gives
   those words to a worker). Each is approved where it is written, and approving
   is refused over the wire.
6. Picking a prompt fills in the brief, and the contract and job it is tied to.
   All three stay editable — a task carries its own COPY of each, so editing the
   library afterwards changes nothing that already went out.
7. Press Write it.
   `okc.js taskCreate --task '{"title":"...","brief":"...","branch":"..."}'`
8. The task is on the Board as a draft. While it is a draft, Edit it on the card
   reopens it here. Once it is queued or out it cannot be changed: the brief is
   the question its work answers.
9. Go to START IT.


START IT
---------

1. Open the Tasks tab, sub-tab Board, and pick the task.
2. Look at whether it has a job. That one fact decides what the card offers.
3. With a job: press Queue it. The next free machine is brought up, given a
   credential, set up on the branch, handed the job, waited on, and then put away
   — off, rolled back, claiming nothing. `okc.js taskQueue --id <task>`
4. With no job: press Work on it in VS Code, or Work on it in a terminal. A
   machine is brought up and set up the same way and then left running for you.
   Nothing is dispatched. `okc.js taskWorkOn --id <task> --open editor`
5. Close the window if you like. The queue runs in the server, not in the page.
6. Go to WATCH IT.


WATCH IT
---------

1. Tasks → Board, on the card: the Attempts section, and what the worker is doing
   right now. `okc.js taskProgress --id <task>`
2. Live: the log as it happens. `okc.js logSince`
3. Sessions: what the worker remembered. `~/.claude` is archived when a run ends
   and unpacked before the next starts, keyed by the task — so a task given out
   twice is one conversation across two machines. `okc.js sessions`
4. Terminal: a shell on the machine, if you want to look yourself.
5. Go to FINISH IT.


FINISH IT
----------

1. With a job, do nothing. The queue ends it: the log is kept on this host, the
   credential is taken back, the machine is put away.
2. By hand, press Finish it on the card. Same ending — the machine is given back
   and the task goes up for a verdict. It is disabled until there is a machine to
   give back, and the tooltip says so. `okc.js taskFinished --id <task>`
3. Read the Artifact column: the branch, its commits and files, per repository.
   `okc.js taskArtifact --id <task>`
4. Read Handed back: anything that could not travel on a branch, handed over from
   inside the machine with `okc-artifact <file>`.
5. Read the diff before deciding anything.
   `okc.js taskDiff --id <task> --repo <name>`
6. Record the verdict from the command line. There is no button: a verdict is
   somebody reading what came back, and the card shows the brief. A screen for it
   is in `ROADMAP.md`.
   `okc.js taskJudge --id <task> --verdict accept --note "..."`
7. Go to MAKE THE BRANCH A LINE.


MAKE THE BRANCH A LINE
-----------------------

1. Open the Branches tab, sub-tab Cuts, and pick the branch that carries the
   finished work.
2. Press Make it a line. `okc.js branchAsLine --branch <branch>`
3. Understand what changed: it was a cut, somewhere to work. It is now a line —
   protected, merged into, never worked on.
4. That protection is the point. A cut can be tainted by anybody with a machine;
   a line cannot, which is what makes it eligible for a pull request.
5. Go to PROPOSE IT AND READ WHAT IT LANDS.


PROPOSE IT AND READ WHAT IT LANDS
-----------------------------------

1. Open the Branches tab, sub-tab Lines.
2. Press Propose it for landing. `okc.js linePropose --name <line> --why "..."`
3. Know that this changes nothing. It says somebody thinks it is done, and it is
   what puts the line on the left of the next sub-tab.
4. Open the sub-tab Changes. Pick the proposed line, and the line it goes into.
5. Read Commits — what would land. `okc.js changeRead --from <line> --into <line>`
6. Read File changes — the diff, per repository.
   `okc.js changeDiff --from <line> --into <line> --repo <name>`
7. This is the last look before anything leaves this computer. Take it.
8. Go to CUT THE PULL REQUESTS.


CUT THE PULL REQUESTS
----------------------

1. Open the PR cuts tab.
2. Know what a cut is here: ONE act across every repository the line touches.
   This is the part GitHub cannot do — each repository sees its own pull request,
   each is approved on its own, and "is it in" cannot be answered by looking at
   any single one.
3. Open the sub-tab Write one first, if the description matters. The preview is
   the editor, and it is composed from real facts about the two lines chosen —
   including the links between the pull requests in this cut, which nothing else
   can write, because the numbers do not exist until all of them are open.
   `okc.js prTemplateSet --title "..." --body "..."`
4. Go back to Overview and press +. Pick source and target.
5. Press Push and open them. The work is pushed onward and a pull request is
   opened in every repository that carries it.
   `okc.js prCutMake --source <line> --target <line>`
6. Press Read afterwards to ask GitHub what became of each one.
   `okc.js prCuts`
7. Press Edit all of them to change every description in the cut as one thing.
8. Go to STOP.


STOP
-----

1. Open the Virtual machines tab. Anything still running goes back.
2. Press Power off. `okc.js vmStop --name runner1`
3. Press Revert to, on the base snapshot.
   `okc.js vmSnapshotRestore --name runner1 --to base`
4. Check no machine still claims a branch. One that does is correctly never
   picked up again, and the failure looks exactly like a queue that went quiet.
5. Click the workspace chip and press Close this workspace, if you are done with
   that folder. The machines, keys, approvals and log stay — they belong to this
   computer, not to a workspace. `okc.js workspaceClose`
6. Quit the window. `okc.js appQuit`
7. Know what survives: machines keep running without the dashboard, and say which
   task they hold when they dial back in. The queue stops with the window and
   picks up again when it starts.


A SECOND PASS
--------------

1. Cut a branch, with a reason. Branches → Cuts → +
2. Write what is to be done. Tasks → Add task
3. Start it. Tasks → Board → Queue it, or Work on it in VS Code
4. Read what came back. Tasks → Board
5. Make it a line. Branches → Cuts → Make it a line
6. Propose it. Branches → Lines → Propose it for landing
7. Read the diff. Branches → Changes
8. Push and open them. PR cuts → +
9. Everything in between is the app's problem.
