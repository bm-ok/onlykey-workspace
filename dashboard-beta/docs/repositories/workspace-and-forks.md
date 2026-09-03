# Workspace, forks and the chain

A workspace is a folder of repositories. Everything below is set for **that
folder** and does not come with you to the next one — see
[switching workspaces](../howto/switch-workspaces.md) for the whole list of
what follows and what stays with this computer. Each repository here is a clone
with a GitHub remote, and that remote is usually a **fork** of something —
which is usually a fork of the project. The Repositories tab keeps the whole
chain straight, because two questions depend on it.

## Where work is sent

A pull request has to open *into* somewhere. For a fork of a fork the
choices are: your own remote, the one above yours, or the project. **Send
work to** on the Repos pane (`repoTargetSet --repo X --on owner/name`)
records the choice; it is the one setting here with somebody else's name on
it, so a failed check never drops it. `repoChain --repo X` walks the chain
one link at a time and says which of them this token may open a pull
request on.

## Where issues and pull requests are read from

Issues are filed where people file them, which for a fork of a fork can be
any of three trackers — and one may have issues switched off. **Read issues
from** (`repoReadsSet --repo X --issues ... --pulls ...`) chooses which
places are read. The Issues pane names every place it read from, and says
when one could not be read whole rather than passing a short list off as a
complete one.

## Keeping in step

- `repoSync` fetches and fast-forwards every default branch; only
  fast-forwards, never merges.
- `repoForkSync` pulls each fork's default up from its parent on GitHub —
  the *Sync fork* button.
- `repoBranches --repo X` says where each branch is here, where origin has
  it, and which are out of step.
- `lineSync --name L` does the same for every branch a line names, as one
  act.

## Behind, and said so

There are **three** gaps, and they are not the same question:

| gap | where it comes from | what closes it |
|---|---|---|
| fork behind **its parent** | `repoForkBehind`, asked at the press | *Sync fork* |
| fork behind **where its work goes** | the sweep, as `behindTarget` | a pull request |
| this host behind **your fork** | the sweep, as `inStep` | *Pull &lt;branch&gt; here* |

The sweep asks GitHub how far a fork's default is behind the repository its
work **goes to** (one `compare` call, fingerprinted) and compares this
host's local default with origin's head. Both become inbox errands the
moment they are true — *fork behind where its work goes*, *this host behind
origin* — because the step after a merge used to have no word anywhere but
a note on the cut card.

**The parent is a different repository, and is not on the sweep.**
`behindTarget` is not computed at all when a repository's work goes to
itself, which is the ordinary case for a workspace of personal forks — so
it says nothing about how far behind the project a fork has drifted.
`repoForkBehind` asks that, per repository, at the moment a press needs it,
and it is what *Sync fork* is enabled from: merge-upstream always pulls
from the **parent**, and enabling it from the other measure left the button
off on every card in such a workspace, permanently.

It is compared **by sha** rather than by `owner:branch`. That shorthand
names a repository by assuming it is called the same thing on both sides,
which is wrong for a renamed fork — `bm-ok/0c-coder-lib-agent` of
`0c-coder/lib-agent` — and GitHub answers about a different repository
rather than refusing.

## What is known, and how fresh

`repositoriesCheck` asks GitHub; `repositories` answers from what was last
learnt and says when. Reads are fingerprinted (a 304 is free), pooled eight
at a time, and stop early with room left in the hourly budget so a press
still works. Three repositories with their forks, issues, threads and pull
requests come back in about ten seconds.
