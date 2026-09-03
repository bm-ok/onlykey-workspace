# Catch the workspace up after a merge

**Three gaps per repository, and they close in one order:** your fork
behind the project it was forked from, your fork behind where its work
goes, and this host behind your fork. **Repositories → Sync** is where all
three are shown and put right.

## Steps

1. Open **Repositories → Sync**. Every card carries all three standings:
   `parent:` — against the project it was forked from, which is what a
   fork sync actually closes; `work goes:` — against where its pull
   requests open, which is a different repository and often the fork
   itself; and `here:` — this computer against your fork.
2. **Catch up everything** does it in the right order: every fork behind
   its parent is synced on GitHub first, then every default branch here is
   fetched and fast-forwarded, then GitHub is asked again so the badges are
   read rather than assumed.
3. Or one row at a time: **Sync fork**, then **Pull *&lt;branch&gt;* here**. A
   button is off with its reason when there is nothing for it to do.
4. **Both presses open a dry run first.** It asks GitHub how far each fork
   is behind its parent and shows you, before anything moves: which
   repositories would be pulled up and by how many commits, which are
   already level, which cannot be asked about at all, and separately what
   would be fetched here. "Nothing would change" is an answer it gives.
5. **Lines** beneath: **Sync the line** fetches and fast-forwards every
   branch a line names. A line whose change landed shows in the inbox as
   *line to retire*; retire it on Branches Lines.

## Command line

    node tools/okc.js repoForkBehind                     the dry run, on its own
    node tools/okc.js workspaceSync                      all of it, in order
    node tools/okc.js repoForkSync --repo local-repo-b   the fork, on GitHub
    node tools/okc.js repoSyncBranch --repo local-repo-b --branch master
    node tools/okc.js repositoriesCheck                  ask GitHub again

`repoForkBehind` changes nothing. It is what the dialogs show and what
`workspaceSync` picks its list from, so the three answers cannot disagree.

## Why the order matters

Pull here before syncing the fork and this host fast-forwards to a fork
that is itself behind — level with the wrong thing. Fork first, then here.

## Why there are three gaps and not two

The parent and where-work-goes are different repositories, and a machine
can be level with one and far behind the other. For a workspace whose
repositories send work to their own forks they are the same name, and
`work goes:` then reads *sends work to itself* — which is not a problem
and is not a gap to close.

The distinction is not cosmetic. `Sync fork` is GitHub's merge-upstream and
always pulls from the **parent**; it used to be enabled off the
where-work-goes measure, which is not computed at all when those are the
same repository — so the button was off on every card in a workspace like
that, permanently, however far behind the forks had drifted.

Nothing is asked of GitHub about the parent on the sweep. It is asked at
the press, which is why the dialog takes a moment to open.
