# Catch the workspace up after a merge

Three copies of every default branch, and they drift one way: a change
lands where work goes, your fork is behind it, this host is behind your
fork. The sweep says so in the inbox; **Repositories → Sync** is where it
is put right.

## Steps

1. Open **Repositories → Sync**. The header says how many forks are behind
   and how many repositories here are behind their fork; each row shows
   both standings as badges.
2. **Catch up everything** does it all in the right order: every fork the
   sweep says is behind is synced on GitHub first, then every default
   branch here is fetched and fast-forwarded, then GitHub is asked again so
   the badges are read, not assumed.
3. Or one row at a time: **Sync fork** (GitHub merges the target's default
   into your fork's — one call), then **Pull *default* here**. Each button
   is greyed with its reason when there is nothing for it to do.
4. **Lines** beneath: **Sync the line** fetches and fast-forwards every
   branch a line names. A line whose change landed shows in the inbox as
   *line to retire*; retire it on Branches Lines.

## Command line

    node tools/okc.js workspaceSync                      all of it, in order
    node tools/okc.js repoForkSync --repo local-repo-b   the fork, on GitHub
    node tools/okc.js repoSyncBranch --repo local-repo-b --branch master
    node tools/okc.js repositoriesCheck                  ask GitHub again

## Why the order matters

Pull here before syncing the fork and this host fast-forwards to a fork
that is itself behind — level with the wrong thing. Fork first, then here.
