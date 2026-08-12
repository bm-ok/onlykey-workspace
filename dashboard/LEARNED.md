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
* **Git Bash rewrites paths that look absolute.** `--folder /home/okc/work`
  arrives as `C:/Program Files/Git/home/okc/work`, which is a real path on this
  host, so nothing looks wrong anywhere: the machine cannot find it, falls back
  to the home folder, and the work happens somewhere nobody asked for. It is
  refused now, rather than guessed at, because guessing what was meant is how it
  lands in a third wrong place.
