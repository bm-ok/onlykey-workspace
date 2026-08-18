What went wrong, and what it taught
===================================

Why parts of this look the way they do. Every entry cost real time, and every one
is invisible in the code that now looks obvious -- which is the reason for
writing them down rather than trusting that the fix speaks for itself.

They are kept out of `README.md` deliberately. That document is how to use this;
this one is archaeology, and mixing them makes the first too long to read and the
second too scattered to find. If an entry here starts changing what somebody
should DO, it has stopped being history and belongs back there.

One thing they nearly all share, and it is the pattern worth carrying forward:
**the expensive failures reported success.** Not one of these announced itself.

* **A script that overwrites the file it is running from.** Bash reads a script by
  byte offset, so the overwritten file carried on at the old offset inside new
  content: part of it ran twice and everything after it silently never ran. Hence
  one bootstrap script, and stages written somewhere else entirely.
* **`sshd -t` needs host keys.** During an install they do not exist yet, so the
  check failed for a reason that had nothing to do with the config being tested —
  and the config was deleted as a result. It passed on one image and failed on
  another purely by timing.
* **`.bashrc` returns immediately when not interactive.** Anything added to it is
  therefore invisible to a command sent to the machine, while looking perfectly
  correct in an interactive shell. This caught both node and `DISPLAY`, separately,
  the second time after the lesson was already written down three files away.
* **A destroyed machine keeps its connection.** A VM killed mid-flight sends no FIN,
  so the socket looks healthy forever — and a new machine of the same name inherited
  it and reported itself provisioned. Silence is not the same as health, so a session
  that says nothing is now treated as gone.
* **Checking the wrong shell proves nothing.** Every check that matters asks a login
  shell, because that is what a dispatched command gets.
* **A fallback is a guess, and a guess moves the error somewhere else.** The
  command line treated a `--vm` value that failed to parse as JSON as a plain
  string. What came back from `vmCreate` was "give it a name" — about the one
  field that was correct — while the real fault was a shell eating the
  backslashes in a Windows path three layers up.
* **`systemctl start` does nothing to a service already running.** Re-running the
  setup rewrote the agent and its environment, reported success, and left the
  previous process running against neither. Everything it printed was true.
* **A variable cannot survive a shell that has already expanded it.** The
  installer's command runs inside a double-quoted argument VirtualBox expands
  first, so `x=$(...)` arrives empty — and a fingerprint check written that way
  compares empty to empty, *passes*, and accepts any authority at all. The
  comment above that code is what caught it; the same expansion then ate the
  example when it was written into a commit message with `-m`.
* **The instrument can be the thing that is broken.** TLS looked broken from this
  host because Windows `curl` uses schannel and cannot take a private authority
  from `--cacert`. The guest — the only client that counts — had no trouble at
  all.
* **`sshd -t` answers about its surroundings, not about the config.** Twice. It
  needs host keys, and it needs `/run/sshd`, which does not exist during an
  install because `/run` is a tmpfs the ssh service populates at boot. Both times
  the check failed for a reason unrelated to the file being tested, the file was
  deleted on the strength of it, and the machine came up with root able to log in
  while the install reported success. Anything it needs is made first now, and
  the step reads `permitrootlogin` back out of `sshd -T` afterwards — because
  *the file was written* and *the machine is tightened* are different claims, and
  the gap between them is where this went wrong both times.
* **`curl` is not in the installer's target.** The bootstrap had a `wget`
  fallback for that reason; a later rewrite kept it on one fetch and dropped it
  from another, because wget spells its authority flag differently. The install
  then failed after twenty-five minutes having printed "the dashboard is not
  reachable" ten times — a sentence about the network, describing a missing
  program.
* **A message that names the wrong cause is worse than no message.** That same
  failure said the dashboard was unreachable; a certificate never downloaded was
  reported as one that "is not the one this machine was told to expect", which
  is an accusation of substitution against a machine that could not download
  anything. Missing and wrong are told apart now.
* **Silence is not the same as health, and the timeout is only a backstop.** A
  machine whose power is pulled sends no FIN, so its socket looks healthy for the
  seventy seconds it takes silence to be noticed — and in that window it is
  listed as connected and commands are dispatched into it. Every place that makes
  a machine stop being itself has to say so; `vmRemove` did, `vmStop` and
  `vmSnapshotRestore` did not.
* **VirtualBox releases a lock after the command that took it has returned.** Taking
  a snapshot locks the machine, so starting it on the next line lost the race every
  time — and `SessionState` read `Unlocked` 100ms before the start was refused for
  being locked, so asking was not enough either. Waiting and retrying are both
  needed, because they cover different things.
* **An error can name the half that did not matter.** That same failure said the
  restart failed, which was true and harmless: the snapshot it exists to produce had
  already been taken and recorded. What it did not say was why the machine was now
  powered off. A failed operation whose real work succeeded reads as though nothing
  happened, which is the more expensive direction to be wrong in.
* **`pkill -f` matches its own argument list.** A script that kills a pattern
  finds itself, every time. It was fixed once by bracketing the pattern — which
  worked, and then failed identically, because the literal appeared in *two*
  places and only the first had been bracketed. A recorded pid and
  `kill -- -PID` has no such failure mode. Bracketing is a trick that has to be
  remembered everywhere; a pid is a fact.
* **A pty returns drawing instructions, not text.** A sign-in URL scraped from
  `script -qec` came back wrapped in OSC 8 hyperlink escapes and doubled — the
  terminal's instructions for how to *render* a link, faithfully captured and
  entirely unusable. Anything read from a pty is stripped before it is believed.
* **`chmod 0600` on Windows is theatre.** It toggles the read-only bit and
  nothing else. A credential written that way sat in plain text, protected by an
  ACL and by nothing at rest — which is fine against another user and useless
  against a backup, a sync folder, or a support bundle. It is sealed with DPAPI
  now, and `sealed` reports which of the two actually happened rather than
  implying the stronger one.
* **The refusal that had never fired.** Snapshotting a machine that holds a
  credential was refused in code, but the flag it reads was added after the only
  machine holding one had already been given it — so the flag was false and the
  first test of the refusal *created the very snapshot it exists to prevent*, and
  reported success. A guard is not a guard until something has been refused by it.
* **A quote inside a quoted argument ends that argument.** Every dispatched run
  was built as `bash -c '…'` with a shell-quoted path interpolated into it, so
  bash actually received `cd` with the remainder as positional parameters. Every
  dispatch died instantly, leaving not even an empty output file — and a folder
  with no spaces in it reassembled by accident, which is why it survived to the
  first folder that had one. Generated shell goes into a file now: one layer of
  quoting instead of three, and a record of what actually ran.
* **A missing result is not a result that is still coming.** A run with no status
  file was reported as running, which is true only while something is alive to
  write one. A run that was killed — or that never started, which is how the
  quoting bug above presented — waited forever, and a watcher waited with it.
  Three states, and the pid is checked rather than assumed.
* **The same hole, through a second door.** Snapshotting a machine that holds a
  credential is refused by reading a flag — and that flag was set when this host
  *handed* a credential over, but not when a machine *signed itself in*. So the
  guard that had been written, fixed, tested and documented was still wide open
  along the other path into the same state. A guard on a fact must be set
  everywhere the fact becomes true, and enumerating those is a separate job from
  writing the guard.
* **A signed-out worker does not fail as "signed out".** The first task ever
  given out laid a workspace across every repository, dispatched, recorded a
  run, and came back as an api error inside a json blob. Everything between the
  button and that blob reported success, and the actual sentence — *Not logged
  in* — was one field deep in a machine's output. Now it is asked before
  anything is set up, and asked of the MACHINE rather than of the registry:
  there are three ways to be signed in and the registry knows about one.
* **A clean exit is not a delivery.** A worker told to push to a protected branch
  was refused by the hook, reported what happened, and its process ended
  normally — so the run read `finished, exit 0` while nothing at all had
  arrived. Every signal on the machine's side said success and every one of them
  was true; the exit code is about the program, not about the work. This is why
  `delivered` is read from the branch on this host and never from the run, and
  the drill that proved the hook proved that at the same time.
* **A refusal for the wrong reason is not a pass.** A drill asserting that a
  claimed branch is refused to a second machine was passing while proving
  something else: the second machine was itself on a branch, so it was refused
  for *that* — a rule that fires first, before the claim is ever consulted.
  Caught only because the assertion matches the refusal's message rather than
  the fact of one; a bare try/catch would have gone on agreeing indefinitely.
* **A class name that exists nowhere fails silently, and looks like a dead
  control.** Task cards were given `picked`; the stylesheet has `pick` and `on`.
  The click worked and the panel beside it changed, but the list had no cursor,
  no hover and no highlight — so the only visible evidence was that nothing
  looked clickable, and it was reported as "not selectable". CSS has no
  equivalent of an undefined-name error, which makes a misspelt class about the
  quietest failure available in a window.
* **A record that dies with the machine is not a record.** Run output lived in
  `~/.okc-runs` on the machine that produced it — and a machine here is the
  disposable half: rolled back, deleted, rebuilt, all correct things to do, all
  of which take the only account of what happened with them. Two rollbacks in
  one afternoon erased the logs of two runs whose results had already been
  reported, leaving a task saying work was done and nothing saying how.
* **A pool that never fills is a pool that is never tested.** With machines to
  spare, "queued" and "given out" are indistinguishable: every task starts at
  once, so the ordering, the serialising and the cleanup between tasks are all
  untried. The first queue here deadlocked after exactly one task per machine —
  a finished machine still claimed its branch, a claimed branch is correctly
  "not free", and from outside it looked like a queue that had simply gone
  quiet. Nothing failed. Nothing said anything.
* **VirtualBox allows two snapshots with the same name.** Everything here
  restores BY name -- the queue does it before every task -- so a second
  "base" turns every future restore into a coin toss between a clean starting
  point and whatever else was called base a month ago. Nothing announces it:
  the restore succeeds, on the wrong disk. One machine ended up with `base` at
  the root of its tree and `base` three levels down, and the only sign of it
  was a duplicated line in a list of names.
* **A rule with no exit is not a rule, it is a trap.** "A machine stays on its
  branch until it is CLEAN" was enforced, and there was no way to say it was
  clean -- the only route off a branch was a rollback, which discards. So a
  machine that had finished, pushed everything and was carrying nothing held
  its claim for ever, kept out of the queue and unable to be given anything
  else. Half a rule reads as correctness right up until somebody needs the
  other half.
* **Powered off is not unlocked — and only two callers knew it.** VirtualBox
  reports a machine as `poweroff` while it still holds the session, and the
  operations that need the disk to themselves are not refused in that window so
  much as raced. Restoring a snapshot into it left a machine that started to a
  black screen and never booted: nothing failed, nothing was logged, and the
  disk simply was not what anybody thought. The wait already existed and was
  used by `destroy` and by `vmBaseSnapshot` — restore, take and delete each did
  their own `isOff` check and stopped there. A lesson that is applied in some
  places is a lesson that has not been learned.
* **A summary that costs a process is not a summary.** The board read every
  task's branch out of git to say what was on it — three or four `git` calls per
  repository per task — and the window drew every three seconds, twice over. A
  profile showed **94% of the window's samples inside `spawn`**, doing nothing
  else at all: ten tasks cost 2.8 seconds of a 3-second cycle. Caching the answer
  hides it; the fix is to ask a cheaper question first. One `for-each-ref` per
  repository says where every branch is, and nothing is recomputed unless its
  branch actually moved — eighty processes a draw became two, and the steady
  state went from 2800ms to 80ms.
* **Could not run is not the same as failed.** Half the drills here need a
  machine that is on, holding a credential, or on a branch -- and the whole
  design of this tool puts machines at REST: off, clean, holding nothing. So
  running the suite on a quiet system reported "4 failed" when nothing
  whatever was wrong. That is the fastest way to teach somebody to ignore a red
  number, and it is the same mistake as reading a missing result as a result:
  two different states, one word.
* **A counter derived from what still exists is not a counter.** Task numbers
  were the highest on the board plus one, which is correct until the highest is
  deleted -- and then the next task takes its number back. It happened within an
  hour of the numbers being added: #11 was removed and the next task became #11.
  Nothing failed; a number simply stopped meaning one piece of work, in exactly
  the places numbers are used -- a commit message, a note, somebody asking what
  happened to eleven. An identity that has to survive deletion cannot be derived
  from what survived.
* **A supervisor that cannot see the work must not conclude the work is over.**
  The queue waited on a run by polling the machine, and a failed poll threw —
  straight out of the wait, out of the task, and into the `finally` that puts a
  machine away. So pulling the network cable for **one minute** powered the
  machine off and rolled it back, mid-run, while the work itself was perfectly
  fine: detached, still going, and destroyed by the thing supervising it. The
  run is detached on purpose; an outage is something happening to the dashboard,
  not to the work.
* **A partitioned socket blocks for ever, and it took three fixes.** The agent
  read with no timeout, so a network that went away left `recv()` blocked
  indefinitely; the reconnect loop underneath was written correctly, retried for
  ever, and was never reached. **A machine that lost its network never came
  back.** Each attempt looked right and only the third was:

  **TCP keepalive** never fires, because keepalive only probes an *idle*
  connection and this one beats every twenty seconds. **Closing the socket when a
  beat fails** never fires either, because `sendall` succeeds into the kernel's
  buffer for about fifteen minutes of retransmits — a one-way heartbeat proves
  nothing, so the dashboard now answers every beat and silence became
  measurable. And when that finally *did* detect the outage, closing the socket
  from the heartbeat thread **still** did not wake a `recv` already blocked
  inside the syscall: the descriptor went away and the thread stayed parked. The
  agent diagnosed itself correctly, wrote it in its journal, and sat there:

      okc-agent: nothing from the dashboard for 80s; dropping the session
      (and then nothing, ever again)

  What works is a **read timeout**, which needs no other thread to co-operate —
  and which is only safe because the far end now answers, so ninety seconds of
  nothing genuinely means gone.

  The other lesson is where the answer came from: the guest's own journal, over
  ssh. From the dashboard the agent simply looked absent, which is the one thing
  it was not.
* **`Wants=` does not mean "after".** The agent's unit said
  `Wants=network-online.target`, which does not wait for the network so much as
  **pull that target into the boot** — dragging in `NetworkManager-wait-online`
  and blocking startup until it is satisfied or times out. The one service whose
  job is to report that a machine is in trouble was the reason a machine in
  trouble took longest to say so. It does not need the network up: it retries for
  ever, and a reboot is an ordinary reconnect.
* **Connected is not usable.** The agent dials in as soon as the network works,
  which is a minute or more before anybody has a graphical session — so a machine
  reported itself ready while still showing a splash screen, and anything needing
  a display arrived too early and failed for a reason pointing nowhere near the
  cause. Asked of logind, on every beat, because it starts false and becomes true
  later: recorded once at hello it would have said "no desktop" for ever.
* **Git Bash rewrites paths that look absolute.** `--folder /home/okc/work`
  arrives as `C:/Program Files/Git/home/okc/work`, which is a real path on this
  host, so nothing looks wrong anywhere: the machine cannot find it, falls back
  to the home folder, and the work happens somewhere nobody asked for. It is
  refused now, rather than guessed at, because guessing what was meant is how it
  lands in a third wrong place.
* **A valid token is not a usable worker.** Claude Code decides whether to run
  its first-run wizard from a flag in its config, not from whether it can
  authenticate — so a machine holding a perfectly good credential opened on
  "choose a theme" and then on "Select login method", a sign-in it did not need
  and could not finish there. The program disagreed with itself out loud:
  `claude auth status` reported the right account and the right plan while the
  screen asked how to log in, because the two read different files. It was
  reported as "claude doesn't work with the auth key", and every theory that
  started from the token was wrong. Handing over a credential now marks the
  wizard done in the same breath.
* **One TLS connection, two threads, and openssl allows neither.** The agent read
  the socket on its main thread while the beat thread and every running command
  wrote to it from others. There was a lock, and it was around sending only — so
  writes could not corrupt each other, while a write could and did collide with
  the blocking `recv`. Python does no locking for you here, and openssl does not
  permit one connection to be used from two threads at once.

  **The failure is not an error.** The TLS state machine is left inconsistent and
  the connection is torn down CLEANLY, so both ends see an orderly shutdown and
  each reports the other as having closed first. That is what made it so hard:
  the dashboard logged "the machine closed it" while the machine's journal said
  "the dashboard closed the connection", and both were telling the truth about
  what they saw. Every theory built on believing one of them was wrong, and there
  were four — a long command, `claude` specifically, a leaked file descriptor, a
  throwing log subscriber.

  The tell was the shape, not any one message: intermittent at roughly one run in
  five, triggered by output rather than by duration, and stable for as long as
  nothing ran. Idle, the only writer is one small beat every twenty seconds and
  the odds of overlapping a read are slim; streaming output makes it likely.

  Reads go through the same lock now, with `select` on the descriptor — which
  touches no TLS state — so the lock is held only for the recv itself. The beat
  thread no longer closes the socket either, because closing sends a close_notify,
  which is one more use of the connection from one more thread. Ten commands and
  twenty thousand streamed lines without a single reconnect, where before the
  first or second command would take the channel down.
* **Two `ssh` programs, one config file, and neither reads the other's paths.**
  Windows OpenSSH — the one VS Code Remote runs — takes `Include "C:/Users/..."`.
  Git's MSYS build reads that as RELATIVE, looks for a file called `C:` inside
  `~/.ssh`, finds nothing, and continues without a word, because a missing
  include is not an error in either. So `ssh okc-runner2`, which this tool tells
  people to type, answered "could not resolve hostname" as though the machine
  were at fault. Both spellings are written now; each program ignores the one it
  cannot read.
* **The window is the only part of this that fails silently.** Everywhere else a
  wrong name throws or is refused by name. A stylesheet does not:
  `className: 'picked'` against a stylesheet that says `pick` produces no error,
  no warning, and a panel that renders unstyled — found, eventually, by a person
  saying the list was not selectable. `test/window-test.js` now checks every
  class the window applies, every custom property it reads and every id it looks
  up against what exists. It caught two bad variable names within a minute of
  being written.
* **A host restart leaves a machine holding a credential, and nothing said so.**
  A credential is taken back before a machine is shut down, so a powered-off
  machine holding one cannot be reached by anything working correctly — it means
  the machine was stopped from OUTSIDE that sequence, and a Windows update doing
  it overnight is the ordinary way. Every other warning in the window is about a
  machine that is RUNNING, so this one was invisible: a real credential sat on a
  powered-off disk for eight hours, silently blocking the next snapshot, waiting
  for somebody to read a field. It matters more when the machine is off than when
  it is on, not less — a running machine is at least visible; a stopped one looks
  finished.

  The recovery has an order that is easy to get backwards. The copy ON THE
  MACHINE was newer than the one on this host, because Claude Code refreshes its
  token and rewrites the file — and an OAuth refresh rotates the refresh token,
  so the host was holding one that had probably already stopped working. Grabbing
  before forgetting keeps the credential that demonstrably still authenticates.
  Forgetting first would have left a stale copy to be handed to the next machine,
  where it would fail as "the worker is signed out" on a machine that had just
  been handed a credential.

* **A new state can make an old rule wrong without touching its code.** The queue
  adopts, on every restart, any task sitting in `given` with no run id — written
  when that could only mean a dispatch interrupted mid-setup, which is a task
  nothing is doing and which should go back in the queue. Correct, and it stayed
  correct until a person could take a task by hand: that task sits in `given`
  with no run id for as long as somebody is working in it, because there is no
  run — the exit code is a human saying "finished". So every restart re-queued
  every hand-taken task and gave it to Claude on a second machine while its owner
  was still in the first.

  The rule was never edited. Its meaning changed underneath it, because "nothing
  is running" stopped implying "nothing is happening". Nothing failed, no test
  broke, and it was found by looking at a screenshot and noticing a task marked
  `working` on a machine nobody had given it to.

  It cost nothing, and that is the second lesson: the branch claim refused the
  second machine — "drill/cable-pull is already being worked on by runner1" — so
  the work was never run over the top. The layer that caught it was not the layer
  that was wrong, which is the entire argument for having more than one.

* **`ready: true` meant "the bytes arrived", and was read as "it works".**
  `vmCredentialsPut` placed a credential, set the first-run flag, and reported
  readiness without ever asking the worker anything. A credential can be placed
  perfectly and be expired — which it was: every panel said the machine was
  signed in, and `claude` answered "OAuth session expired and could not be
  refreshed". The fix is one line appended to a remote command that was already
  being run, so it costs nothing, and it turns a claim about this host's actions
  into a report of the machine's state. Prefer the second wherever the first is
  cheap to check.

* **A credential has two clocks, and the one you can read is the wrong one.** The
  access token is short-lived and EXPIRED IS ITS NORMAL STATE -- Claude Code
  refreshes it whenever it needs to, so an expired one says nothing about whether
  the credential works. The refresh token is the one that matters, and this host
  was holding one dated four weeks out while a worker answered "OAuth session
  expired and could not be refreshed".

  Both were true. A refresh ROTATES the refresh token, so a credential grabbed
  from a machine that has refreshed since is holding a superseded one: valid
  dates, dead credential. The clock is therefore proof in one direction only --
  expired means certainly dead and is worth refusing on, because nothing can
  recover it; unexpired means only the absence of one kind of bad news.

  So `usable` is true/false/null rather than a boolean, the panel shows the clock
  and the last real attempt as two separate rows, and the disagreement between
  them is left visible instead of being resolved into one verdict. The
  disagreement is the information: "27 days left" beside "refused 20 seconds ago"
  is the whole explanation of what is wrong.

* **A panel that asks git something on a timer is a panel that costs a process
  per repository per tick.** This is written down already — it is why
  `artifact.read` caches — and it came back through a new door within a day of
  being read. The Merge pane called `mergeCompare` and `mergePlan` on every draw:
  three or four git processes per repository for the first, and for the second a
  REAL MERGE (`merge-tree` performs the whole thing to find out whether it would
  conflict) plus a `git status` each. Twenty processes every three seconds, on a
  pane that was open and untouched.

  A devtools trace said it in one line: 78% of the samples that were not idle
  were inside `spawn`. That is the same number the artifact cache was written to
  fix, and the same shape — expensive question, cheap-to-be-wrong answer, asked
  on a clock rather than when the question changed.

  The rule that generalises: **the window redraws on a timer, so anything it
  calls is on a timer.** A new action is cheap to add and free to call from the
  command line, and neither of those says anything about what it costs three
  seconds at a time. Before wiring one into a paint function, ask what it spawns.

* **The window redraws on a timer, so every question it asks is asked on a
  timer — and the expensive ones decompose into the same two.** A second trace,
  after the Merge pane was fixed, still put 39% of samples inside `spawn` with
  nothing happening. It was not one greedy caller. It was `git for-each-ref` and
  `git symbolic-ref`, asked over and over inside a SINGLE draw: once in `all()`,
  again inside `groups()`, again in `baselines()`, again per branch through
  `scopeOf`, and — worst — once per (branch, repository) pair by `freeIfBusy`,
  which opens by comparing HEAD to the branch and returning. Eighteen processes
  to learn three facts.

  Three fixes, in order of how much they were worth: ask `freeIfBusy` only about
  repositories where the branch actually IS checked out (`all()` already knew
  which); let `groups()` read each repository's branches once instead of once per
  named part; and memoise the two ref reads themselves for a second. 18 git
  processes per board read became 6, and 0 for a second read within the same
  second. Live, with the window open and untouched: 14 samples with a git process
  alive became 6.

  The memo is invalidated FROM `git()` ITSELF, by looking at the verb — branch,
  checkout, merge, fetch, push, reset. A cache invalidated by hand at each call
  site is stale exactly where somebody forgot, and the forgetting arrives with
  the seventh writer, months later, in a change about something else.

  The general lesson is about decomposition, not caching: a function that costs
  one process is fine, and six of them in one draw are the same process six
  times. Ask what a panel spawns, not what it calls.

* **`node --check` proves syntax, not that a file can be loaded.** Removing three
  functions left their names in `module.exports`. Every check passed — syntax
  fine, `npm test` fine, both suites green — and the dashboard then failed to
  start at all with `ReferenceError: landPlan is not defined`. The window came up
  empty and the command line said nothing was listening.

  A missing export is a runtime error at module scope, so the cheapest possible
  test catches it: `node -e "require('./repos/branches')"`. That belongs beside
  `node --check` in the routine, and it is worth running for every file a change
  touches rather than just the one it was about.

* **GitHub's `permissions` on a repository describes the ACCOUNT, not the token
  acting for it.** All three repositories reported `read, push, admin` for a
  fine-grained token that was then refused with "Resource not accessible by
  personal access token" the moment it asked for a branch list. Believing that
  field would have produced a dashboard saying "may push" right up until a push
  failed — probably halfway through opening three pull requests, which is the
  worst possible moment to find out.

  So capability is PROBED: ask for the thing itself and record what came back.
  Two extra requests on an action nobody runs on a timer, and it turns a
  description of an account into a statement about what will actually work. Both
  answers are shown, labelled, because the difference between them is the whole
  explanation of the failure.

  The same shape as two other lessons here — `ready: true` for placing a
  credential file, and a clock that says a credential has four weeks left while
  it is already dead. Three times now the pattern has been: a field that looks
  like the answer, next to the real answer nobody asked for.

* **And say what is needed BEFORE it is needed.** The app knew exactly which
  permissions it wanted and said nothing, so the first real token arrived missing
  one. Diagnosing that afterwards is good; naming it in the dialog that asks for
  the token is better, and is the difference between a two-minute setup and
  finding out one repository at a time.

* **The rule existed, was right, and was not applied to the next three panels
  built.** A third trace put `spawn` back at 25% of the window's samples with
  nothing happening. Not a new fault — the same one: `paintRepos` ran on every
  draw whatever tab was on screen, and one call cost nine git processes (a remote
  url, a head and a branch list per repository). The template preview cost six
  more, also every draw.

  The Branches tab had solved this before either was written: `if (branchPane ===
  'baselines') paintBaselines()`. A panel behind a tab nobody is looking at asks
  nothing. That line was three feet away in the same file and got copied for
  neither new tab.

  So the lesson is not "cache things" — it is that a rule which lives only as an
  instance of itself does not generalise on its own. Every paint function now
  starts by asking whether it is the one being looked at, and the two that reach
  the network cache on what they depend on rather than on time.

  Measured across the three traces: spawn 70% -> 13% -> 25% -> and 4 samples with
  a git process alive out of 40 after this. The regression cost as much as the
  original fix saved, and would have kept costing it, because each new panel
  looked reasonable in isolation.

* **Three callers reached the actions table directly, so there was nowhere to put
  a rule.** The window did `app.actions[name].run(args)`, the pipe did its own
  lookup, and a drill's `okc` did a third. That was fine while there was nothing
  to say in between — and adding "a workspace can be closed" needed exactly that:
  one place where every call passes through.

  The alternative was a check inside each of the fifty-three actions that is a
  question about a folder of repositories, which is fifty-three chances to forget
  one, in the file that grows fastest. With `call()` it is a `needs: 'workspace'`
  key beside `about:`, and the same function serves the window, the terminal and
  the drills, so none of them can be refused something another one is allowed.

  It also gave the window something to SAY. `workspaces` reports the marked
  names, so "53 of this app's actions are questions about a folder" is read off
  the table rather than written into a paragraph that goes stale.

* **A path built from nowhere throws about an argument nobody passed.** Closing a
  workspace made `stateDir()` return null, and `path.join(null, 'tasks.json')`
  came back as `The "path" argument must be of type string. Received null` — from
  `workspaces`, the one action whose whole job is to answer while none is open.

  Reading is a fair question with nothing open and the answer is "nothing", so
  the readers return empty rather than throwing; what must not happen quietly is
  a WRITE, and that is stopped at the action where it can say why. Two different
  answers to "there is nowhere to keep this", each in the place that can give it.

  The same shape bit `serve.js`: `path.join(root(), name)` with a null root turns
  a name that came off a URL into a RELATIVE path, which is the one thing the
  `NAME` regex above it exists to prevent.

* **Tearing down is where you find out what was holding on.** Adding "close it"
  was the cheapest end-to-end test this app has had of its own assumptions: it
  found the null paths above, a `workspaceUse` that read `current().dir` without
  considering there might not be one, and a queue that would have read an empty
  board and called it idle — the right outcome by the wrong route, and one stale
  file away from dispatching into a workspace nobody is serving.

  None of those are edge cases of closing. They are all "this value was never
  absent, so nothing was written for absent", and the only way to find them was
  to make it absent.

* **Serialise VBoxManage. VBoxSVC is one service and it can be asked into a
  corner.** It locked up: `list vms` stopped answering at all, `startvm` failed,
  and getting it back took closing every VirtualBox process and restarting the
  service. Nothing abusive caused it — the window polls `vmList`, which is four
  processes with two machines (`list vms`, `list runningvms`, and a `showvminfo`
  each), and the command line calls the same action into the same process with
  none of the window's pacing.

  The window was never the hammer and it is worth being precise about that,
  because the obvious fix would have been to slow it down and that would have
  fixed nothing. `draw()` already refuses to overlap itself, `sync()` awaits
  before rescheduling, it skips entirely while the window is hidden, and it polls
  at twelve seconds unless a machine is running. **The gap was that there was no
  coordination BETWEEN callers**, and a service that is slow when it is unwell
  turns every new caller into another process held for up to the two-minute
  timeout. That is how slow becomes stuck.

  So every call goes through one strictly serial chain, and identical reads in
  flight are one read — without the second half a serial queue only converts
  "four at once" into "four in a row". Measured after: 24 concurrent calls, 649
  samples of the live process table, **most VBoxManage processes alive at once:
  1**.

  Two properties keep it safe. The queue wraps only the leaf that spawns, so a
  nested call is impossible by construction and it cannot deadlock. And a failed
  call does not poison the chain — the next one runs whatever the last one did.

  The cost is real and is the right cost: a read can wait behind a write, and a
  write here can be five minutes (`closemedium --delete`, `unattended install`).
  It is bounded, because the draw loop will not stack reads behind it, and it
  says so in the log when anything waits more than ten seconds — otherwise
  "VirtualBox is unwell" and "the window has gone quiet" look identical.

* **Do not race the operator for a wedged service.** While they were closing
  VirtualBox and restarting VBoxSVC, this session kept running `vmList` and then
  ran `VBoxManage list vms` directly. Their words: "me and you where fighting to
  start it." On the first `VBoxManage` failure the right move is to say it looks
  environmental, stop touching it, and carry on with the parts of the task that
  need no machine — which is most of them, since the actions split into host and
  workspace and neither half needs a hypervisor to answer.

* **An invalidation idiom that stores a value collides with that value.** The
  repaint guard keys panels on a signature, and the way to force a redraw was
  `changed(key, null)` — "store something nothing will match". That was used
  ninety-five times. But `null` is not a spare token here: it is what every
  detail panel is handed when nothing is selected. So deleting the last prompt
  did this — the handler stored `"null"`, the repaint that followed compared the
  real `null` against `"null"`, matched, and drew nothing. The panel kept showing
  the prompt that had just been thrown away, with buttons that then failed with
  "there is no prompt called…", while the list beside it said "none yet". Two
  halves of one screen disagreeing about whether something exists.

  It survived because it is invisible in review. Both call sites read
  `changed(key, null)`; nothing in the line says one means "forget" and the other
  means "compare". And it only bites where the empty value happens to be the
  same as the sentinel, which is why it looked fine everywhere else for months.

  The fix is that invalidating has its own word — `forget(key)`, which deletes
  the entry rather than storing a signature, so it cannot collide with any value
  because it holds none. The eight sites that genuinely compare against "nothing
  selected" still say `changed(key, null)` and mean it.

  Proved by lifting `changed` and `forget` straight out of `ui/base.js` and
  running the delete sequence against both idioms: the old one still shows the
  deleted prompt, the new one shows the empty state.

* **Splitting a file leaves bare names behind, and `node --check` passes on
  every one of them.** The one-file server became `actions/*.js`, and each new
  file's require block was rebuilt from what its actions APPEARED to need.
  Anything reached by a bare identifier that had simply been in scope before fell
  out silently. `files` did, and the artifact endpoint hung with no response --
  a ReferenceError inside a request handler leaves the socket open. `port` did,
  four times in `actions/machines.js` and once in `actions/runs.js`.

  The `port` one is worth the detail, because of WHERE it hid. In machines.js it
  was inside `vmWorkspace`, which only reaches that line once the branch exists
  -- so every task with a valid branch failed with "port is not defined", and
  every task with a typo failed earlier with a better message and masked it. In
  runs.js it was inside a `try/catch` that swallowed it, leaving `base` null: the
  guest was then never told where to hand an artifact back, which is why
  `okc-artifact` had never once worked. A syntax check passes on all of this. A
  bare identifier is valid syntax; it fails when its line is evaluated, which
  here was inside an action, in a queue, on a machine that had already booted.

  Found by writing a checker rather than by reading: strip comments, strings and
  template text (keeping `${...}`, which is where both bugs were), collect every
  binding form, and report names used as `x.y` or `x(` that nothing declares. It
  took three attempts to stop reading English prose as identifiers -- the first
  reported two thousand.

* **A credential's clock proves death, never life.** `credentialsHeld` said the
  refresh token was good until September; the worker answered "OAuth session
  expired and could not be refreshed" and the run failed. `credentialLife`
  already says this in as many words -- expired means definitely dead, unexpired
  means nothing -- and it is still the thing that gets assumed, because a green
  tick beside a date reads as an answer. The only test is a worker actually
  authenticating, and nothing marks a held credential as suspect after a run
  fails that way.

* **Back up before the checks that throw.** The session archive is taken
  immediately after `claude` returns and before a single one of the refusals that
  read its answer. That ordering is the whole value: the run that failed with the
  expired credential still kept its transcript, and a run that ended badly is the
  one whose transcript is worth most. Filing it after the checks would keep a
  record exactly when nobody needs one.

* **A guest's reply is not just what you asked for.** The re-dial check reads a
  one-line JSON note off a machine, and the first version parsed the whole
  reply — which arrives with the channel's own `$ <what>` echo on the front, so
  `JSON.parse` failed on every machine. It failed *quietly*, because it was
  wrapped in a `catch` that returned "no note": exactly the same answer a
  machine holding nothing gives. The fix is two things and both matter — read
  the last line rather than all of it, and never let "unreadable" and "absent"
  come out as the same answer.

* **Re-queueing on restart is honest; guessing is not.** A restart puts an
  unstarted task back in the queue, which is right — a process that has just
  started knows nothing about what was in flight. The first attempt at the other
  half inferred what was still held from the registry: a machine marked
  borrowed, a branch claim that looked right. That is a guess, made by the one
  party that cannot check it, about a machine somebody may have reverted by hand
  while the dashboard was not running. The machine is asked instead. It writes
  `$HOME/.okc-task` when its workspace is set up, loses it when it is rolled
  back, and says which task it has the moment it dials in — a fact with the same
  lifetime as the thing it describes, which no registry entry has.

* **An unambiguous match can be unambiguously the wrong button.** `windowClick`
  refuses when the words match several buttons, which felt like the whole of the
  problem — and then a click meant to demonstrate that refusal named a button
  that matched exactly one. It was "Clear", on a pane holding somebody's
  half-written task, and it cleared it. The refusal that existed was for the case
  where the tool cannot tell which; the case that cost something was the tool
  being certain and wrong. Hence `--dry`: say which button you would press,
  press nothing. The values were recoverable only because `windowControls` had
  been run a moment earlier and its output was still on screen.

* **The renderer was the silent process for the whole life of this app.** NW.js
  runs a node context and a window, `stdio: 'inherit'` was already on the spawn,
  and only the first was ever heard from — Chromium keeps console output for its
  devtools unless `--enable-logging=stderr` says otherwise. So a window that
  threw on load produced a blank panel and nothing else, which is
  indistinguishable from a panel with nothing to show.

  Proved by breaking it on purpose: `been.recall('tasks')` at the top of
  `ui/tasks.js`. `node --check` passed, and so did `npm test` including the
  declared-names checker — `been` IS declared, and nothing static can see that
  it has no `recall`. Before the flag: silence. After it, on stderr and in the
  live log, `the window threw (tasks.js:20): TypeError: been.recall is not a
  function`. Not `--v=1`, which buries that under Chromium's own internals.

* **Spacing that belongs to the container cannot describe the join between two.**
  `.stack` has a gap inside itself and `.chips` carries its own margin, but a
  column holding two of them had no rule about where they meet -- so whether
  there was a gap depended on which classes happened to be adjacent. On Branches
  -> Lines the "Default branches" card sat flush against the first line while the
  lines below it were spaced: one list, two answers, because the first card is
  outside the stack. Three places had it, and every one was somebody adding a
  second container to a column with nothing to remind them. The relationship
  between two siblings is the parent's business, so the rule went on `.col`.

  The two cases that make such a rule correct rather than nearly correct: skip
  panes, because a column holds several and shows one, and a margin on the second
  makes a sub-tab jump depending which; and undo it after a `hidden` sibling,
  because an adjacent-sibling selector counts elements that are not on the
  screen, so the first visible container gets pushed down by a gap under nothing.

* **`direction: rtl` moves leading punctuation to the other end.** It is the
  standard way to truncate a path from the left -- `...ory/src/store.js` beats
  `src/very/long/direct...` -- and it hands every leading NEUTRAL character to
  the paragraph direction. A dot is neutral, so `.gitignore` rendered as
  `gitignore.`, and so did every dotfile in the changed-files list. The markup
  was right, the `title` was right, and the only thing wrong was the screen --
  which is why it survived: invisible to every check except looking at it. A
  left-to-right mark before the text (`::before { content: "\200e" }`) gives the
  dot a strong LTR neighbour on both sides and it stays where it was written.

* **Every "is this merged" answer in this app was asked by sha, and GitHub
  squashes.** A squashed pull request turns a branch's commits into ONE new
  commit with a new sha on the target; the original is still on the branch,
  untouched. So `rev-list --count base..branch` truthfully reports unmerged work
  about work that landed a week ago — and the board said "1 commit no default
  branch has", and `branchDelete` demanded `force` to delete finished work. That
  last one is the real cost: it trains somebody to force the one refusal that is
  the whole safety.

  `git cherry` compares PATCH IDS, so a change already applied — squashed,
  rebased or cherry-picked — is marked `-` and only genuinely new work is `+`.
  Proved in a throwaway repo rather than reasoned about: after a `merge
  --squash`, `rev-list --count` says 1 and `git cherry` says `-`.

  Cached on the PAIR OF COMMITS with no clock in it. The answer is a pure
  function of two commits: unchanged commits cannot have a changed answer, and
  changed ones have a different key. A panel asking every few seconds spawns
  nothing in the steady state and recomputes the instant something moves, which
  no time-based cache can promise.

* **A checker that cries wolf stops being read.** `declared-test` collected the
  first name after `const`/`let`/`var` and no more, so `let baseAt, branchAt`
  declared one of two and reported the other as undeclared — in a file where both
  are plainly on the same line. Fixing it to take the whole line then swallowed
  `for (const line of rows)` and produced six new false alarms. The shape that
  works is the LEADING identifier of each comma-separated part. Confirmed both
  ways afterwards: a deliberately undeclared name is still caught.

* **A deny list checked after an allowlist never fires.** `core/events.js` names
  six tags that are deliberately NOT kept — window, capture, ipc, channel,
  provision, editor — and the comment reads as a rule in force. It was never
  implemented: `worthKeeping` asked only whether any tag was in KEEP, and every
  one of those entries also carries a tag that IS kept, because a channel line is
  tagged `['vm', <name>, 'channel']`.

  The cost was the whole point of the record. `taskProgress` polls a machine for
  its runs every thirteen seconds while somebody watches a task, and 89 of the
  last 400 kept entries were that one poll — so "what happened to runner1 while I
  was away" had already scrolled out of a two-thousand-line file by the time
  anybody asked. A record that keeps the heartbeat and drops the acts is worse
  than no record, because it is believed. Now refused BEFORE the allowlist, and
  `test/events-test.js` asserts it both ways.

* **Two claims on a machine, and only one was released.** `vmSnapshotRestore`
  clears the branch claim when a disk goes back, with a long comment about how a
  standing permission to push work that is no longer on the disk is "the quiet
  kind of wrong". It did not clear the BORROW, which is the same kind of claim
  with the same lifetime. runner1 sat `poweroff`, `claims a branch: nothing`,
  "not on a branch and not running anything" — and beside all of that,
  `borrowed — working on inspection/check1 in a terminal`, which is the one thing
  keeping it out of the pool, naming work that had moved to another machine days
  earlier. When a field is added that means "not available", every place that
  releases availability has to learn about it.

* **A note about the world goes stale exactly when the world changes.** The
  warming suite worked out which machines were missing in its first check and
  kept the answer in `state`. Resuming an interrupted run CARRIES the checks that
  already passed — which means the code inside them does not run — so the series
  picked up holding "both machines are missing" about two machines that were by
  then built and correctly powered off, and sat waiting for them to dial in.
  Twice. The rule that came out of it: state may keep what the world cannot say
  (which machines this run built, when it started) and must never keep an answer
  the world can be asked for. `whatIsMissing()` asks, every time, wherever it
  matters.

* **A comment named a caller that never existed.** `ui/tasks.js` said "`taskGive`
  is untouched and is still what the queue calls". `git log -S taskGive --
  tasks/queue.js` returns nothing at all: that string has never been in the
  queue, so the sentence was wrong the day it was written, not stale. The queue
  dispatches with `vmDispatch` and `jobRun` and does its own accounting around
  them. Two techniques came out of it — `git log -S <name>` says when a name
  stopped being used, and the same with `-- <file>` says whether it was ever
  there — and one tool, `test/unused.js`, which lists what nothing calls and what
  is named only in prose. A comment cannot call anything.

* **The kernel is silent on the boot you are watching.** A drill waited for
  `root=UUID=` on the serial console to know a machine had rebooted into what it
  installed. That line reaches the wire because first-boot writes a grub drop-in
  — and the drop-in applies from the NEXT boot, which `first-boot.sh` says in as
  many words at the point it writes it. Two machines got most of the way through
  provisioning, 4325 lines of console each, with zero matches for the thing being
  waited on, under a fifty-minute timeout that would eventually have called a
  good install a failure. The marker that works is what the installed system
  actually says first: `okc: first boot: making the machine reachable`.

* **Starting a machine ended its turn about a second in.** "One machine comes up
  at a time" was enforced by `busy.comingUp`, and the queue and the installer
  both waited for the console before handing the host on. `vmStart` — the one a
  person presses — ended its turn when `VBoxManage` returned, which is before the
  machine has done anything. The turn now ends when the kernel speaks, and there
  is a five-second settle before the next machine starts: the seconds straight
  after the first byte are the heaviest of the boot, so ending the turn there
  hands the host over at the worst possible moment.

* **The shape of an answer is not a name, so nothing static can catch it.** Three
  drills were written against interfaces that do not exist: `{ isos }`
  destructured from an action returning a bare array, so a gate reported "no
  Ubuntu ISO" on a host with four and had never once opened; `githubHeld.works`,
  a field that is not there, so a dead token would have passed; and `stage:
  'ready'` asserted of a machine that reports `connected` while it is dialled in
  and can never say both. `node --check` passes on all three, `npm test` cannot
  see them, and a drill that refuses to run looks exactly like a drill being
  careful. Only running them found it — which is the argument for the kit, and
  the reason to read an action's answer before writing against it.

* **A guest added from the command line was sealed as `[object Object]`.**
  `--token '{"claudeAiOauth":...}'` arrives as an OBJECT, because that is what
  makes `--vm '{...}'` and `--task '{...}'` work, and `core/guests.js` did
  `String(token)`. So the fourteen characters "[object Object]" were sealed, a
  fingerprint of them was recorded, and the guest was reported as added. The
  credential is gone at that point and the way you find out is a machine
  answering "not signed in" weeks later — with every panel on this host agreeing
  it holds one, because a fingerprint of the wrong bytes is perfectly consistent
  with itself. Found by handing a machine one and reading back what landed: the
  new sealed handover delivered exactly what this host held, and what it held was
  the mangling. Objects are stringified as JSON now and the literal is refused
  by name.

* **A check that cannot tell base64 from encryption is worse than no check.** The
  first version of "nothing travels as cleartext" searched the commands sent to a
  machine for pieces of the credential. The way the credential USED to travel was
  base64 inside a command line — so that check would have found nothing and
  passed against the exact code it was written to condemn. It decodes every
  base64 run in what was sent before searching now, and that was verified by
  running it against a reconstruction of the old command, which it correctly
  condemns.

* **A repaint guard hid a real state change, twice in one afternoon.**
  `changed(key, signature)` compares the ANSWER a panel was given, and a panel's
  own state is not part of that answer. Pressing "Read what was said" set a flag
  and repainted; the paint returned one line in, because `supervisorState` had
  not changed. The same early return left a Wake button enabled after the state
  that disabled it had gone, and the Judge tab had it too. The shape is always
  the same: **the data did not change, the decision did, and the guard only
  knows about the first.** Anything driven by a decision this window made belongs
  above the guard, with its own guard that includes the decision.

* **An option given a value of the wrong shape failed silently in three checks.**
  `ask({ extra })` is a second BUTTON — `{ label, onClick }` — and two dialogs
  passed it a DOM node. The result was a button with `textContent: undefined`
  and the thing that was supposed to be shown never rendered at all: a "write a
  judging prompt" dialog with no editor in it. `node --check` passed, the markup
  checker passed, `npm test` passed. Only looking at it found it, which is what
  a screenshot is for.

* **`jobSave` unbound every judging job from its prompt, and every panel still
  said "can judge".** `promptId` was overwritten with null whenever a save did
  not mention it, unlike the code and the tags beside it — so two rewrites that
  only changed a script quietly cut the chain. The fault appeared twenty minutes
  later as a machine booting, taking a credential, cloning three repositories and
  refusing with "no brief, so there is nothing to give the job". A job with no
  prompt is not broken; only a JUDGE with no prompt is, so the refusal now lives
  at `judgementCreate` where the difference is known.

* **A worker credential can be clock-valid, freshly "rotated", and dead.**
  `credentialsHeld` reads the refresh token's own expiry, and the suite's "a
  machine can really sign in with it" passed at 14:30 on a credential that was
  dead by 17:11. Worse: taking it back reported it ROTATED, with a new
  fingerprint — the CLI had written its failed-refresh state back to the file.
  Rotation says something happened, not that it worked. The only proof is a
  worker's own transcript: "Failed to authenticate: OAuth session expired and
  could not be refreshed".

* **Testing it yourself is not optional, and I skipped it.** Three judging chains
  were written, approved by the operator, and handed straight to a supervisor to
  run. The first real use was the bootstrap, and it failed on a fault that one
  command-line run would have found in a minute. The operator's question —
  "did we ever try to test the judge out ourselves?" — was the whole review.

* **Rolling a machine back destroys the evidence of why the run failed.** The
  job's own output lives on the machine, and the machine is restored to its base
  snapshot the moment the run ends. What survived was the session archive, which
  is what actually said why. Anything a failure needs to be diagnosed from has to
  be handed back before the rollback, not read afterwards.

* **A twenty-minute run was a file of zero bytes, by request.** Dispatch asked
  `claude -p` for `--output-format json`, which writes ONE object when the worker
  finishes — so the run log was empty for the whole run and then complete. The
  record was correct and unwatchable, and "is it doing anything" had two answers
  available: wait, or stop it and find out. `stream-json` writes an event per
  line as it happens, costs nothing else, and makes `tail -f` the live view.
  What made this last so long is that nothing was BROKEN: every panel was
  truthful, the record was kept, and the missing thing was only visible to
  somebody sitting in front of it wanting to watch.

* **The reader has to change in the same commit as the format.** `claude()` in
  the job API parsed the whole log as one object, so switching to a stream would
  have made every run report "it said nothing" — a silent, total failure of
  every job at once, on a change that reads like a display preference. It now
  takes the last `result` line and still accepts a whole-file object, so runs
  from either side of the change read the same.

* **A `.catch` on something that returns `undefined`, inside a handler wrapped
  in a silent catch, killed every line below it.** `firstSnapshotIfItNeedsOne`
  returns early — no promise — for a machine that already has a base snapshot,
  which is every established machine. server.js chained `.catch` onto it, so
  dialling in threw a TypeError on that line, and channel.js caught it with
  `catch { /* never worth dropping a session over */ }` and said nothing. The
  rest of what happens when a machine arrives had never run, on any machine
  older than its first boot, for as long as that line had been there. It
  surfaced only because something new was added underneath it and did not
  happen. **A catch that swallows without a word turns the next bug into an
  afternoon**; that one logs now, and still does not drop the session.

* **Two readings of one question will disagree, and the wrong one will be the
  one on screen.** `credentialsHeld` filters supervisors out of its guest list
  deliberately — it answers "is there anything to hand a runner". A new banner
  read that list, found no supervisor, and told the operator this host had no
  supervisor sign-in while one sat on the Runners tab with a "here" badge. The
  fix was not a better filter: it was one function, `guests.supervisorKey()`,
  that everything asks — the thing that signs a supervisor in, the pane that
  offers the choice, and the banner that explains what is wrong.

* **"Free" and "in use" are not opposites, and reading one for the other blanked
  the answer.** The same function reports what could be HANDED OVER; a sign-in
  already on a machine is not that. The pane asked it "which one is in use" and
  got "none" at the exact moment a supervisor was signed in and working. Two
  fields now, because they are two questions.

* **"Nothing here can change that without being able to get in" was false, and
  it stood in a comment for months.** A machine built before this app had an ssh
  key has an EMPTY authorized_keys, so nothing can ssh in at all — not the
  Terminal tab, not VS Code, not the back door that exists for when the agent
  stops answering. On this host that was three machines out of five, including
  the supervisor, and it reads as "Too many authentication failures", which
  sounds like a key being rejected and is really a machine with no keys to
  reject. The fix was always available: an agent already runs on the machine and
  already executes what this host sends it, so the key goes over the CHANNEL —
  `vmAuthorizeKey`. It grants nothing new, which is why it can be a button: the
  channel it is sent over can already run any command there as that user. **A
  sentence in a comment explaining why something is impossible is worth
  re-reading once the app has grown a new way in.**

* **A feature can be finished and still land on a machine that cannot run it.**
  The stream tab was correct, the watcher was correct, the shell was correct —
  and the tab said `Permission denied` because ssh to that machine has never
  worked. Nothing in the feature was wrong; the road it drove on was out. Test a
  new path on the machine somebody will actually use it on, not only on the one
  it was written against.

* **A refusal that names something which cannot be created is a trap, not a
  guard.** `prCutMake` demanded a judgement of the LINE — "Nothing has judged
  'csvstat lockfile ignore'" — and a judgement can only be made against a
  BRANCH. The line is what `branchAsLine` renames the branch to, so the flow the
  supervisor's own skill prescribes (judge it, make it a line, cut it) could
  never pass its own gate. Watched live, the supervisor tried every way out and
  each one was shut by a different correct-sounding sentence: `branchAsLine`
  said the line already exists, `judgementCreate` said there is no branch cut by
  that name. Three true refusals and no route.

  Two lessons, and the second is the general one. **A gate must accept the names
  the thing it guards can actually be called** — here, the line's name *and*
  every branch the line is made of. And **a refusal is only a guard if something
  can satisfy it**: when writing one, follow the sentence to what somebody would
  do next, and check that door is open.

  It also cost nothing to find and would have cost everything to miss: the
  machinery was correct, the message was fluent, and the fact was wrong.

* **A read that erased what it returned, and it read as a model ignoring
  somebody.** `whatsNew` marks the conversation read on the way out, and the
  supervisor's skill tells it to keep the bookmark and pass it. It calls
  `whatsNew` two to four times in a single turn. So the first call returned the
  message and moved the mark, and the second — made with that fresh bookmark,
  mid-turn — was handed an empty conversation. Whichever look it happened to
  compose its answer from decided whether the person had said anything at all.

  Four messages went that way: each delivered, each stamped read by
  `supervisor-1`, each answered with a tidy status report. One of them said "you
  have twice not answered me, tell me which it was", and the reply was "nothing
  to do".

  **Two hours went into the wrong explanation.** Every hypothesis was about the
  model — instruction-following, a rule buried too deep in a 24,000-character
  skill, a request losing to the status loop — and a section was added to the
  skill to fix a symptom that was never there. The bookmark proved delivery, so
  delivery was assumed correct and never questioned.

  The lesson is not "check delivery". It is that **when a model appears to ignore
  something, suspect the pipe before the mind** — a destructive read is
  indistinguishable from inattention from the outside, and the mind is the more
  interesting explanation, which is exactly why it gets reached for first.

  The floor is now the last thing the supervisor itself SAID: anything after that
  is by definition unanswered and no bookmark it passes can hide it. There is a
  check that fails without the fix, in the conversation suite, proved by putting
  the bug back and watching it fail.

* **A rule written for tasks, and a second kind of work added later. Four times
  in one day.** Judging shares the queue with tasks, is dispatched by the same
  tick, and is set up on a machine the same way — and four separate rules that
  already existed had never been extended to it:

  - **The queue's adoption.** A task stranded in `given` with no run is
    re-queued on restart, and the comment above it describes finding exactly that
    twice in one afternoon. A judgement in the same state was invisible to
    everything: the queue only looks at `queued`, the recovery loop only looks
    for a run to wait on. Found by restarting the dashboard during the twenty
    seconds between "the workspace is set up" and "the run has started".
  - **The conclusion reader.** It knew `RECOMMENDATION: accept|reject` and
    `CLAIM: true|false|unclear`, and the prompt for reading an arrived pull
    request asks for `RECOMMEND: YES|NO`. A judge read for three and a half
    minutes, wrote twelve thousand characters, ended exactly as instructed, and
    was recorded as having reached no conclusion.
  - **The run log.** A task's is archived under its uid; a judgement's was kept by
    nothing at all, so it died with the machine a few lines later. When one
    failed, the supervisor asked `taskLog` three times and was refused three
    times — a judgement is not a task — and had to infer the reason from a stack
    line that happened to be in the event stream.
  - **The detail panel.** "Which is a" was an either/or written when there were
    two kinds, so the first judgement of an arrived pull request was described as
    "branch cut — the work as it stands". Not empty, not obviously broken: the
    wrong one, stated confidently.

  **Adding a second kind of anything means auditing every rule about the first.**
  `tasks.read()` without a matching `judging.read()` nearby is the shape to
  grep for, and each of these four looked like a new bug rather than the same one.

* **Validating a worker's answer before handing it back destroys the work.** The
  claim-checking job wrote `CLAIM.md`, then checked its heading, its sections and
  its last line, and *then* handed it over as an artifact. A judge read three
  repositories for 154 seconds, wrote a full answer, got the last line slightly
  wrong, and the job threw — so the file existed on a machine that was rolled
  back seconds later and nothing came back at all. 0.77 USD and the entire
  reading, lost to a formatting slip.

  **Hand the work over first, then judge its shape.** A malformed answer should
  cost its conclusion, which is right, and not the reading, which is the
  expensive part and is still perfectly readable by a person.

* **An internal distinction, leaking out as a statement about the world.** This
  app calls a repository by its workspace name; GitHub calls it `owner/name`.
  That difference is nobody else's business, and it escaped three times:

  - an allowance was filed under `bmatusiak/local-repo-a#13` and looked up under
    `local-repo-a#13`, so the gate said "nobody has allowed this" about a pull
    request somebody had just allowed;
  - `pulls --repo bmatusiak/local-repo-a` was refused with "there is no
    repository called that", which is false, and is the least useful thing that
    could be said about the one repository the caller was surest of;
  - `judgementCreate` accepted only one of the two names for the same thing.

  **Accept every name the thing can honestly be called**, and never phrase an
  internal mismatch as a fact about what exists. The first cost a supervisor a
  whole turn and a refusal that was flatly untrue.

* **"Unreachable" is not "gone".** The GitHub watcher rebuilds its record from
  what it FOUND, and treats anything absent as closed. Ten minutes of no DNS
  therefore dropped every issue and pull request on all three repositories, and
  the next successful look reported a four-hour-old pull request as *arrived* —
  waking the supervisor to spend a turn establishing that nothing had happened.
  On a repository with fifty open pull requests, one dropped connection is fifty
  arrivals.

  It was noticed only because the supervisor diagnosed it in its own reply. **A
  source that could not be read must not be allowed to speak about what has
  changed in it.**

* **A button that is present, enabled and unreachable.** A verdict note is a line
  when a person writes one and can be a whole review when a judge does. Twelve
  thousand characters in an uncapped table cell pushed every button in the panel
  a hundred and fifty thousand characters of markup below the fold. Nothing
  looked broken, so nothing was reported — the answer to "where is that button"
  was "scroll for a minute".

  **A cell whose content comes from somewhere else needs a lid.** And the deeper
  one: the honest answer to "where is it" was that it should not have been there
  at all. It now sits on the row where the person started the work, which is
  where they went looking.

* **An unclosed `</div>` that only bites when something is added after it.** A
  pane relied on the browser closing it at `</section>`. Adding a pane after it
  put the new one INSIDE the old: it was given `.active` correctly, the DOM said
  `class="pane active"`, and the screen showed nothing, because its parent is
  `display: none`. Two screenshots of an empty tab and a long look in the wrong
  place. **Close what you open, even where the parser forgives you** — the
  forgiveness is not inherited by the next person's markup.

## "Local" stopped meaning "free"

The window felt sluggish. A trace of 85,076 events over 33.6 seconds put
`spawn` at the top of the profile with individual samples over three seconds.
Three consecutive draws measured warm, in one process, said why:

```
draw 1:  1479ms   12x git=501ms   2x powershell=469ms
draw 2:   952ms   12x git=496ms
draw 3:   940ms   12x git=479ms
```

A third of the time busy, for ever, on a three-second timer.

Nine of the twelve were `remotes.read()`, called by `waiting` for the badges.
`read()` adds a default branch, a head commit and a branch count to each
repository, and every one of those is a git process. **`waiting` uses none of
them.** It wants pull requests, a parent and a target -- facts only GitHub
knows, already written down in a file. It was paying nine processes every
three seconds for three fields it never read, and an inner `remotes.read()`
inside the per-pull-request loop made it eighteen. `core/inbox.js` did the
same thing three more times over.

The fix was not a cache. It was `notesOnly()` -- the same reading with the git
left out -- and hoisting the calls that were inside loops. Steady-state draws
went from 950ms and twelve processes to **20ms and none**.

THE HEADER OF `repos/remotes.js` ALREADY STATED THIS RULE, one level up:
network calls are never on a timer, `read()` is local and instant. That was
written when the alternative was GitHub, and it was true then. "Local and
instant" is a comparison, not a property, and it quietly stopped holding the
moment `read()` ran twenty times a minute -- process startup on Windows is
tens of milliseconds each and they contend.

So the rule is not "cache the expensive thing". It is:

* **Count what a function starts, not what it returns.** Multiply by twenty an
  hour. `inbox` composes nine kinds of waiting work and measured 9ms; the one
  line inside it asking for a branch count cost fifty times that.
* **A reading that answers more than the caller asked is not free generosity.**
  Give the cheap half its own name so a caller on a timer can take it.
* **A comparison in a comment expires.** "Instant compared to X" is a fact
  about X. When the caller changes, re-measure rather than re-reading.

This is the third time a paint path has been given something that spawns --
twice before at 70% and 25% of the window's samples. The guard at the top of
CLAUDE.md is right; it keeps being applied to the panel that was just built
and not to the one built next.
