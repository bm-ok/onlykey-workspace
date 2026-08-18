TODO
====

Working state, not documentation. `README.md` is the document and stays the one
that describes how any of this works — if something here is finished, it belongs
there and should leave this file. Anything left in here long enough to go stale
was probably never going to be done.

Something that needs *exercising* rather than building belongs in
`test/suites/` — a folder is a suite, a numbered file in it is a test, an it()
is a check, and `test/outline.md` is the whole list in order. `TEST-PLAN.md` is
the prose that came before it and is kept as history. Something that is not
built yet because it is not its turn belongs in `ROADMAP.md`.


What the test kit is owed
-------------------------

The suites run green — 76 passed, 0 failed, 7 could not be tried, in nine
minutes — and the seven say what they needed rather than what went wrong.

**What is outstanding about the app itself is not here any more.** A thing the
app should do and does not is a DRAFT check, declared in the suite where it
would happen — `draft(name, note)` in `tasks/harness.js` — and every one of them
is gathered at the top of `test/outline.md` with its note. That file is
generated, and the app rewrites it on startup while testing mode is on, so the
list cannot go stale the way this one does. Judging and the credentials are
there now.

What is left below is about the KIT rather than the app — the machinery that
runs the checks, which cannot describe its own gaps as checks without arguing
in a circle: 

* **`requires()` marks dirty and does not refuse.** The order is declared and
  has consequences; it does not yet stop a suite being run before the ground it
  stands on has passed. That is the difference between describing the order and
  enforcing it.

* **`test/unused.md` is the hardening queue.** 8 actions named only in comments,
  24 with no caller, 12 with neither a button nor a drill, 52 exports nothing
  outside their file uses. Some are legitimately command-line tools; the list
  stops crying wolf once an action can say it is one on purpose.

* **Three checks can only run in flight**, and one wants a contract nobody has
  approved. They report what they needed, which is honest, but they are the
  coverage that a single sequential run does not reach.


How the window gets checked
---------------------------

It photographs itself, which is how every open item below with the word "panel"
in it will be settled. `README.md` has the detail; the short form is:

    okc.js windowShot --view <tab> [--pick <row>]   returns when the file is on disk
    okc.js windowShot --when loading                the placeholder, not the answer
    okc.js windowSlow --ms 4000                     hold a loading state to judge it
    npm test                                        every class, property and id exists

The picture and the markup answer different questions and both are needed: a
class matching no rule, a panel off the bottom and an empty badge are invisible
in the markup and obvious in the photograph.


Where the bigger picture lives now
----------------------------------

Two documents took most of what used to be listed here, because it was not
"outstanding" so much as "not built yet", which is a different thing and wants a
different shape:

    ROADMAP.md   the order to build in, from here to the vision. Step 0 is not a
                 feature: no real repository has ever been through this loop
    GAPS.md      what the older design projected, what of it was one ecosystem
                 rather than a tool, and where this is already ahead of it

What stays below is the near ground: things half-done, things that bit and were
not fixed, and the state of the machines.


Outstanding
-----------

* **Three of today's fixes have no check, and each is a claim code review cannot
  settle.** The conversation suite has one for the destructive read, proved by
  putting the bug back and watching it fail. These three do not:

  - **set aside and force.** A set-aside job is hidden from a machine and still
    visible to the window; bringing one back OVER THE WIRE withdraws its
    approval and at the window does not; `skillSave` is refused while the window
    holds unsaved edits and goes through with `force`. Four claims, no machine
    needed, and the whole point of the feature is the asymmetry.
  - **"unreachable is not gone".** The watcher carries forward what it could not
    read. Needs a simulated failure rather than a real outage, so it is a check
    on the carry-forward rather than on the network.
  - **a stranded judgement is adopted.** Hardest of the three: `adopt` is not
    exported and only runs at startup, so this may have to be a draft.

* **The supervisor has no way to know what it is spending.** The meter records
  every run per sign-in and it is the app's number, not the supervisor's — and
  its own context grew 325k to 686k cached tokens across three turns while it was
  being asked to read findings files. Nothing tells it that, and nothing stops
  it. Worth deciding whether that is a number it should see.

* **Eight judgements ended without a verdict.** They are on the Judge tab and
  each is a real answer nobody recorded a decision about. Not a fault; a backlog,
  and the badge counts it correctly.

* **Judging works, and the lane has been round several times.** Done, and left
  here for one waking only because what replaced it is the useful part. Judges
  have read branch cuts, an arrived pull request and two claims: J37 wrote a
  twelve-thousand-character review of somebody else's pull request ending
  RECOMMEND: NO, J38 and J39 settled claims, J42 answered one with a
  ten-thousand-character CLAIM.md. Every one of those handed a file back and the
  supervisor read it through `judgementFindings` and nowhere else, which is the
  design working rather than being described.

  **What is not proven is the newer half.** `check-a-claim-and-say-what-else`
  and its contract — the one that requires an "Also noticed" section for
  findings nobody asked about — are approved, in use, and have run ZERO times:
  every claim so far went to the older `check-a-claim`, with both offered and no
  steer. Setting the old one aside would force it, which is one press and is what
  set-aside was built for. Until that has happened, the asides section is a claim
  about a contract rather than about a judgement.

* **The supervisor has one triage entry pointing at a judgement that is gone.**
  It wrote `judge-survey-codebase-1` down as "waiting on a judge" and that
  judgement was removed. `triage` resolves ids now, so on its next waking it
  will be told there is nothing to wait for — worth watching, because that is
  the first time the notebook will contradict what it believed.

* **Two sign-ins have never been used.** `runner1` and `runner2` replaced the
  credential that died. Nothing has run a worker on either, so "this host can do
  work" is currently an assumption. One task or one judgement settles it.

* **The judging chains have been approved twice and rewritten three times.**
  They are approved and runnable now, and the scripts have never had a
  successful run through them — so what is approved is read but not exercised.


* **The credential comes BACK in a command's output.** Going down it is sealed
  now — the machine makes a keypair, publishes the public half, and this host
  sends ciphertext (`core/handover.js`, checked by "nothing travels as
  cleartext"). Coming back, `vmCredentialsGrab` and `guestBack` read it with
  `cat`, so it arrives in a command's OUTPUT: not in `ps` and not in a shell
  history, which is why this is the smaller half — but not sealed either. The
  mirror is the same two files with the roles swapped: this host publishes, the
  machine seals to it. See `ROADMAP.md`, "A key exchange between host and guest,
  for the credential".

* **The Claude sign-in flow is hard-coded, and jobs exist now.** Every step of
  `credentialsBegin` / `credentialsFinish` is a sequence of guest commands
  written into the dashboard, from before there was another way to run one. A
  job is exactly that — a script that runs on a machine, read and approved
  before it does — so the flow could be one, editable without a release and
  keeping the sign-in URL on the machine rather than logging it here. The
  sticking point is that a credential is not an artifact and must not be handed
  back like one. See `ROADMAP.md`, "Signing a worker in, as a job rather than as
  code".

* **`runner1` is running an agent two fixes behind.** It never got the read
  timeout or the unit change, and it has not got the TLS locking either — so it
  is the only machine left that still drops its channel whenever a command
  produces output. It needs the same push, which needs it started and dialled in.
  It has booted since, so this is now ordinary work rather than blocked.

* **Nothing has been left running for hours.** A five-minute soak passed on a
  timer; the overnight one is written and waiting as **#17**, ten hours of
  heartbeats. What it is looking for is what only shows up over time: a channel
  that drops, an agent that dies, a disk that fills. Worth queueing on a night
  when Windows updates are deferred — an overnight update killed a runner
  mid-credential once already.

* **The queue adopts work it did not dispatch.** A task handed straight to a
  machine with `taskGive` is picked up by the queue on the next restart, treated
  as in flight, and its machine put away — which rolled back a workspace somebody
  had set up by hand. Either adoption should be limited to tasks the queue
  started, or handing one over directly should say that this is what happens.

* **`taskUpdate` can force a task into any stored state.** Bounded — the set is
  checked, and `working` and `delivered` are derived rather than settable — but
  still a way round the state machine from the command line, and it was used to
  fix a task the queue had stranded. Either that is a legitimate repair tool and
  should say so, or it should refuse the transitions that make no sense.

* **The Branches tab runs past the bottom of the window.** The baselines block
  that first caused it is gone with the setting it described, and the left column
  still runs past the viewport once there are half a dozen branch cuts — so it is
  the column that wants a height, not that one block. Same class of thing as the
  terminal's height, which is measured rather than guessed.

* **The branch board is re-read from git on every poll, and thrown away.** Three
  `symbolic-ref` calls run whatever tab is open, for the banner about repositories
  parked off their default; the board itself is another ten while Branches is up.
  Each is ~70ms of `execFileSync`, which blocks the window's own thread because
  the page and node share one. The fix is not to cache on a clock but on a
  SIGNATURE — the refs are files, so stat them and only spawn git when something
  moved, the same trick `snapshotTimes` already uses on the `.vbox` file.

  Making git async instead was considered and written down as the wrong first
  move: it does not remove the work, only stops it blocking, and it converts the
  file that decides what is protected and what may be pushed. **The trigger to
  revisit it is workspace size** — at three repositories a cold read is 0.22s and
  not worth that risk; at twenty it is ~1.5s on every real change and it is.

* **No list of drafts anywhere.** A pull request draft is kept per pair of lines
  and only surfaces when that pair happens to be selected in the writer, so
  something written and left is findable only by retracing the steps to it. The
  drafts know their own age; nothing shows it.

* **Repositories still has the header layout that was wrong on PR cuts.** "Ask
  GitHub" sits in the same row as a heading for the column beside it, so neither
  says what it is over. PR cuts was fixed by giving each column its own heading;
  this was not, and the two now disagree.

* **The folder chooser has never been clicked.** `Workspaces → Choose` opens the
  desktop's own directory picker, which is the one control here that cannot be
  driven from a terminal — everything around it is verified and the dialog itself
  is not. Cancelling is the case to try: it is handled deliberately, because
  `change` does not fire when somebody backs out and waiting only for that would
  hang whatever was awaiting it for the life of the window.

* **`legacy/contracts/dashboard/supervisor-mode.md` is still on disk.** Its rules
  now live in the supervisor skill. The file is two sentences of generic filler
  that nothing loads, and deleting it needs a hand that is not this one —
  `legacy/` is untracked.

* **Contracts are runtime state, and the history question is still open.** They
  are a library now — written, approved, edited, thrown away, and copied into
  every task that goes out under them — which answers most of what this entry
  used to be about: a task carries the words it was held to, so what governed a
  finished run cannot drift. What is still true is that `contracts.json` lives in
  the per-user data directory, so the rules themselves have no history. The copy
  in each task is the record; the library is not versioned.

* **Nothing counts a handed-back file as delivering.** The board reads
  "done, nothing delivered" for a task whose run produced an artifact, because
  `reads` only looks at the branch. #31 and #32 both say it while their files sit
  in the panel beside them. Either the summary should count files, or it should
  say "nothing on the branch" and mean it.

* **A job's artifacts are only reachable through a task.** Run one on its own and
  the file is filed under the run id — `taskFiles` cannot see it, and no pane
  shows it. It is on disk and findable only by opening the folder.

* **The Jobs pane's Run it button asks for no machine.** `jobRun` refuses without
  one, correctly, so the button lands on "Say which machine" every time. It needs
  the picker the run dialog already has for prompts.

* **The undeclared-name checker is not in `npm test`.** It is what caught `port`
  after `files` had already been caught by hand — strip comments and strings,
  collect every binding form, report names used as `x.y` or `x(` that nothing
  declares. It runs clean apart from one known false positive (a destructured
  parameter with a call in its default). Two regressions of this exact shape have
  now shipped, and `node --check` passes on both.


The next joints
---------------

Not tasks. Two things the shape of this now implies, either of which is a
session's work on its own and neither of which should be started by accident.

**Nothing merges.** `taskJudge` deliberately does not — a verdict is a person's
decision and landing work is a separate act with its own rules — and nothing
else does either. So accepted work sits on its branch for ever, and the two
branches on the board are both accepted and both still sitting there. That is
the next joint after the round trip: the loop currently goes out, comes back,
and stops. In `legacy/` this is what the gate was for, and its rules are written
down there rather than here.

Worth being clear that this is a *decision*, not an omission: everything
delivered so far is on a branch precisely because nothing has decided it should
be anywhere else.

**Nothing runs the supervisor.** Every piece is in place — the queue drives
machines, pre-defined tasks are written and approved, a worker is given rules and
watched, and what comes back is judged — and a person still writes every task by
hand. `legacy/PLAN.md` describes the AI-driven mode and is explicit about why it
is allowed at all: the dashboard sits between the model and the workers, so
distribution goes through the observable channel rather than a private call
inside an orchestrator. That constraint is already satisfied by the queue; what
does not exist is anything proposing the work.


Unproven, and unexplained
-------------------------

Not missing work — things that have been reasoned about rather than seen. The
drills themselves live in `TEST-PLAN.md`, and all of them now pass, including
the four that only have anything to look at while a machine is mid-work.

* **A machine sometimes sits at the Ubuntu splash for ten minutes or more after
  a restore, and this is now REPRODUCIBLE and unexplained.** Seen on `runner2`
  this afternoon (nine minutes, then it came back) and on `runner1` tonight
  (eleven minutes, still there when it was powered off). Both followed
  force-stop → restore → start.

  Two theories are dead. The double rollback was the first suspect and is fixed,
  yet this happened after a single restore. `Wants=network-online.target` in the
  agent unit was the second, and is also a real fault worth fixing — but it
  would cost ninety seconds, not eleven minutes.

  **What would settle it:** the boot messages rather than the splash. Ubuntu
  hides them behind `quiet splash`; taking those off the kernel command line for
  one boot would say which job is hanging, and `systemd-analyze blame` afterwards
  would say how long everything took. Neither has been tried.

  A machine in this state is recovered by powering it off; it costs nothing but
  the ten minutes, and rebuilding one takes twenty.


What is on the board, on purpose
--------------------------------

Two tasks, kept because between them they are the record of what this thing can
do -- and because both are accepted and still sitting on their branches, which is
the open joint above:

* **#1 `task/first-round-trip`** — accepted. The first time work went out and
  anything came back.
* **#10 `task/both-repos`** — accepted, having been **rejected and sent back
  once**. Two repositories, two attempts, the verdict that caused the second one
  still in its record. The whole loop, in one task.

The drill tasks and their branches are gone; their kept logs are not, being
filed under a uid that is never reused. Throwing away the note about the work
does not throw away the evidence of it.


Decisions waiting on the operator
---------------------------------

Not work, and not for a session to settle on its own.

* **Pushing happens, and nothing here tracks when.** This said "nine commits have
  never been pushed" for long enough that it stopped being true without anybody
  noticing: `origin/main` is at `5bfd5f6`, so most of it has gone. Check rather
  than read — `git rev-list --count origin/main..main`, after a fetch, because
  the remote-tracking ref is only as fresh as the last one. A number written down
  here is a number that is wrong by tomorrow, which is the argument for the
  command instead.


What is finished is not here
----------------------------

The round trip, dispatch, the credential end to end, two machines at once, a
machine built from nothing, and the push enforcement proven against a guest --
all done, all checked by running them rather than reading them, and all recorded
where they will stay true: the drills with their dates in `TEST-PLAN.md`, what
each one taught in `LEARNED.md`, and how the thing works in `README.md`.

What has never been TRIED, as opposed to what is half-built, is the "Honest gaps"
section of `README.md`. That is a different list and it is kept there.


Where the machines are
----------------------

Volatile, and the first thing to check rather than trust:

    okc.js vmList --json

**There are four now, and two of them belong to the test kit.**

    runner3, runner4   yours. Untagged, so they take any work that asks for
                       no particular kind of machine
    kit-1, kit-2       built by `03 the machines are built` on 16 August 2026,
                       from the server ISO, both installers at once. Tagged
                       `test`, so a task tagged `test` goes to one of them and
                       waits rather than taking one of yours

The kit's two are removed by `09 cooling the host`, which is off unless asked
for with `--teardown true` — so they stay standing between runs, which is why
that suite passes in a second on a warm host instead of building for ten
minutes. Taking them away marks the build stage dirty, and the next run makes
them again.

Last checked, **all four were off**, each on a single snapshot called
`base` that predates any branch, claiming nothing, holding no credential,
borrowed by nobody, and free to the queue. That is the resting state the whole
design is arranged around, and the state to put them back into.

Nothing is on either of them that a script did not put there, and neither has
ever been signed in: the credential arrives only when the queue gives them work,
and leaves before they shut down.
