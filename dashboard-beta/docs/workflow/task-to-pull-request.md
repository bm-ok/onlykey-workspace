# From a task to a pull request

The loop for work written here rather than arriving from GitHub. Every
step is an action a person could press; the supervisor presses most of
them when it is running the loop.

    line ─ cut ─► branch ─► task ─► worker ─► judgement ─► cut ─► pull request ─► merge
                                                  │                                 │
                                          accept / reject                      a person

1. **A line to cut from.** Usually the project's default, named as a line
   (`lineSave`), kept in step (`lineSync`).
2. **A branch**, cut across every repository with a reason (`branchCreate`
   — or in the same act as the task, with `cutFrom` and `reason`).
3. **A task** on it, under an approved job (`taskCreate`, `taskQueue`).
4. **A worker** takes it on a machine of its kind, does the work under the
   contract, commits and pushes to this host, hands over anything a branch
   cannot hold, and the machine is put away clean.
5. **A judgement** of the branch (`judgementCreate`, `judgementQueue`): does
   it do what was asked, and fit how this codebase is written. It ends
   `RECOMMENDATION: accept` or `reject`.
   - *reject*: another task on the same branch, `becauseOf` the judgement,
     so the worker starts from the report. Then judge again.
   - *accept*: on.
6. **The branch becomes a line** (`branchAsLine`), what the pull request
   will say is written (`prDraftSave`), and it is **cut** (`prCutMake`):
   pushed, one pull request per repository, into the repository chosen by
   *Send work to*.
7. **Later tasks on the same branch** are pushed onto the open pull request
   when their judgement accepts (`prCutRefresh`). Nothing opens a second
   pull request for the same work.
8. **Merge** — a person, on GitHub or with `prCutLand`.

## Where it can stall, and what says so

| symptom | where to read |
|---|---|
| nothing takes the task | `queueState`, `pools` — no free machine of that kind, or the queue stopped |
| the task ran and delivered nothing | `taskLog` — the run's output survives the machine |
| the judgement "reached no conclusion" | `judgementFindings` — the report; `judgementLog` — the run |
| the cut is refused | *Nothing has judged...* — judge it; *stale* — it moved since, judge again |
| the pull request sits on an old commit | `prCutRefresh --source <line>` |
