# Cut a pull request

A cut is one act that opens one pull request per repository the change
touches, tracked here as one landing. It needs a **line** to cut from and a
**line** to cut into, and a judgement of the code.

## Steps

1. **Make the branch a line.** Repositories → Branches Cut → the branch →
   **Make it a line** (`branchAsLine --branch fix/x --name fix/x --why ...`). A
   line is a named point: one branch per repository.
2. **Have it judged.** A cut of unjudged code is refused: *Nothing has
   judged "fix/x"*. Queue → judgement on the branch, or wait for the one the
   supervisor queues when a task lands.
3. **Write what it says.** Repositories → New PR Cut → pick source and
   target lines → title and description. The template blocks are added
   under whatever you write: why the branch was cut, what it was cut from,
   the commits, the `Closes owner/repo#N` line from the issue it carries,
   and links between the pull requests when there are several. **Preview**
   shows the composed body (`prTemplatePreview`); `prTemplate` turns blocks
   on and off.
4. **Cut it.** Pushes each branch to its repository's GitHub remote and
   opens the pull requests, into the repository chosen by *Send work to*.
   A repository with nothing picked is **refused and named** rather than
   guessed at, and one set to send **nowhere** is skipped with its reason —
   the preview says the same thing beforehand, in the *into* column.

## Afterwards

- **PR cuts** shows each pull request, its state read from GitHub, its
  reviews (approvals and changes requested, counted per reviewer).
- A later task on the same branch, judged and accepted, is pushed onto the
  open pull request by the host (`prCutRefresh`). Cutting the same pair
  again does the same and opens nothing.
- **Merging is yours**: on GitHub, or here with **Merge it** — **Merge all of
  them** when the cut opened more than one (`prCutLand`), a purple press.
- `Closes` closes the issue only when the merge is into the issue's own
  repository's default branch. Across repositories it links; close the
  issue with the drafted `issueClose`.

## After the merge

The change is upstream and two copies are behind it. The next sweep says so,
in the inbox:

1. **fork behind where its work goes** — your fork's default branch is N
   commits behind the repository you merged into. Repositories → Repos →
   **Sync fork** (`repoForkSync --repo X`) brings it up on GitHub.
2. **this host behind origin** — this copy has not fetched what the fork
   now has. **Sync** (`repoSync`) fetches and fast-forwards.
3. **line to retire** — the line the cut came from has done its job;
   retire it, and its branches if you want them gone.

In that order: the fork first, then this host, or the host fast-forwards to
a fork that is itself behind. **Repositories → Sync** is all of it in one
place — its own note says it: three gaps per repository, every card saying
where it stands on all three, and every press that closes one. There is a
third because your fork also drifts from the **project it was forked from**,
which is what `repoForkSync` actually pulls up (GitHub's merge-upstream is
always from the parent) and is a different repository from where work goes.
**Catch up everything** (`workspaceSync`) does the forks first, then this
host, then asks GitHub again. See [Catch the workspace up after a
merge](catch-the-workspace-up.md).

## Command line

    node tools/okc.js prDraftSave --source fix/x --target test-bc1 --title "..." --body "..."
    node tools/okc.js prTemplatePreview --source fix/x --target test-bc1
    node tools/okc.js prCutMake --source fix/x --target test-bc1 --title "..." --body "..."
    node tools/okc.js prCuts
    node tools/okc.js prCutState --source fix/x --target test-bc1
