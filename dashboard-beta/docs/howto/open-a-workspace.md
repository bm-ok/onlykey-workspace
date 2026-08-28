# Open a workspace and check the repositories

A workspace is a folder of git repositories. Everything on the Repositories
tab, every task and every machine's clone is about the one that is open.

## Steps

1. **Workspace** (top left) → add a folder. It must hold git repositories
   one level down; the app lists them and opens it.
2. **Repositories → Repos** → **Check** (or wait: the sweep runs by itself
   every five minutes while *Watching GitHub* is on). The check asks GitHub
   about each repository: reachable, what the token may do there, its
   parent and source fork, open pull requests and issues.
3. Read each row. *Reachable, and the token may use its code and pull
   requests* is the good state. A fork shows *one above yours* and *the
   project*; **Send work to** picks which of the chain your pull requests go
   to, and **Read issues from** which of the chain's trackers are read.
4. **Repositories → Overview** for everything open at once: issues, pull
   requests, cuts.

## Command line

    node tools/okc.js workspaces
    node tools/okc.js workspaceUse --dir C:\work\thing
    node tools/okc.js repositoriesCheck            all of them, once
    node tools/okc.js repositories --json          what was last learnt
    node tools/okc.js repoChain --repo local-repo-a  the fork chain, walked

## What to know

- What is known about a remote is only as true as the moment it was read.
  The row says when.
- Reads are fingerprinted (ETag), so a repeat check is cheap; the hourly
  GitHub budget is kept back from, and a sweep stops early with room left
  so a press still works. `caches` shows what is being reused.
- Per-workspace state (tasks, judgements, cuts, drafts) lives in the app's
  data folder under the workspace's name, not in the repositories.
