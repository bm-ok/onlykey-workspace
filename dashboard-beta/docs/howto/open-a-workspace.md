# Open a workspace and check the repositories

A workspace is a folder of git repositories. Everything on the Repositories
tab, every task and every machine's clone is about the one that is open.

## Steps

1. **Workspace** (top left) → **Choose a folder…**, which opens this
   computer's own folder dialog; in a browser tab there is none, so a list
   of the disk is used instead and says how many git repositories each
   folder holds. Then **Remember and open it** — *Remember it* files the
   folder without switching to it. Repositories are looked for one level
   down.
2. **Repositories → Repos** → **Check** (or wait: the sweep runs by itself
   every five minutes while *Watching GitHub* is on). The check asks GitHub
   about each repository: reachable, what the token may do there, its
   parent and source fork, open pull requests and issues.
3. Read each row. *Reachable, and the token may use its code and pull
   requests* is the good state. A fork shows *one above yours* and *the
   project*; **Send work to** picks which of the chain your pull requests go
   to, and **Read issues from** which of the chain's trackers are read.
4. **Pick where work goes on every repository.** Until you do, the card says
   *not picked*, the selection sits on **nowhere**, and a cut refuses — this
   app does not guess a destination, because guessing meant opening a pull
   request from your fork into your fork on every repository at once.
   **nowhere** is also a real answer, recorded like any other: a repository
   whose issues you read and whose pull requests you judge, but which never
   sends work.
5. **Repositories → Overview** for everything open at once: issues, pull
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
- **Per-workspace state lives inside the workspace**, in a `.okc` folder
  beside the repositories: tasks, judgements, cuts, drafts, the library,
  the provisioning scripts, and the machine register. Copy the folder and
  its state comes with it; delete the folder and nothing is orphaned in
  appdata. What that costs is written down in `core/state/main.js` — the
  machines and the artifacts go with the folder too.
  What stays with **this computer** is the host's own: sign-ins, the
  certificate authority, its ssh key, and which workspace is open.
- **A folder that has never been a workspace is set up as one.** With no
  `.okc` in it, it is given the set this app shipped with — the jobs,
  prompts, contracts and provisioning scripts from `okc-bootstrap.tar` —
  and everything arrives unapproved, waiting to be read. A folder that
  already has a drawer is left exactly alone.
- **The drawer keeps itself out of git.** It sits beside the repositories,
  not inside one, but that is a layout and one `git init` at the wrong
  level makes it wrong — so a `.gitignore` is written into it naming what
  is the host's: `machines.json`, which holds each machine's dial-in token
  and the password its user boots as, the `cached-*` files, and which
  machine this computer has open. Everything else in there is meant to be
  kept, and is the half a second workspace can be started from.
- **A new workspace is inert.** Every switch that arms this app follows the
  folder it was set for — watching GitHub, the supervisor waking itself,
  whose word counts, what is sent without being read, the drills — so a
  folder opened for the first time can do none of it until you say so.
  [Switching workspaces](switch-workspaces.md) has the whole list and what
  stays with this computer instead.
