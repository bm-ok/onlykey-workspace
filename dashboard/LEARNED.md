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
* **Git Bash rewrites paths that look absolute.** `--folder /home/okc/work`
  arrives as `C:/Program Files/Git/home/okc/work`, which is a real path on this
  host, so nothing looks wrong anywhere: the machine cannot find it, falls back
  to the home folder, and the work happens somewhere nobody asked for. It is
  refused now, rather than guessed at, because guessing what was meant is how it
  lands in a third wrong place.
