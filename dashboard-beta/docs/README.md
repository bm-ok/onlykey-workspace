# Docs

This folder is the app's wiki. Every page is a markdown file here, shown on
the **Docs** tab, and edited from either side:

- at the window — Docs → pick a suite → pick a page → Edit → Save
- at the command line — `node tools/okc.js docs`, `docRead --name <page>`,
  `docWrite --name <page> --text "..."`, or any text editor on the file

Both are the same file, and git keeps the history. `docWrite` takes the
`modified` stamp `docRead` gave (`--was`) and refuses to write over a page
that changed since, so two editors cannot silently drop each other's work.
The box at the top searches titles and bodies (`docs --q <word>` at the
command line) and shows the lines that say it.

## The suites

A suite is a folder. Each has a README saying what belongs in it.

| suite | what it is about |
|---|---|
| `howto` | step by step: do this, press that, then this happens |
| `workflow` | how work moves end to end, and where a person stands in it |
| `repositories` | the Repositories tab: forks, branches, lines, cuts, pull requests, issues |
| `queue` | the Queue tab: tasks, judgements, the tick, the library |
| `agents` | the supervisor, the judge and the worker, and their skills |
| `machines` | the virtual machines, pools, snapshots and sign-ins |
| `permissions-and-guards` | what a person may do, what a machine may do, and why |
| `development` | working on this app: the dev loop, proving a change, the tests |

Deleting a page is done at the window only; `git rm` is the honest way from
a shell. What belongs here is writing *about this app*: how a flow works, why
a rule exists, what a tab is for. The work itself is on the other tabs.
