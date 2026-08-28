# Docs

This folder is the app's wiki. Every page is a markdown file here, shown on
the **Docs** tab, and edited from either side:

- at the window — Docs → pick a page → Edit → Save
- at the command line — `node tools/okc.js docs`, `docRead --name <page>`,
  `docWrite --name <page> --text "..."`, or any text editor on the file

Both are the same file, and git keeps the history. `docWrite` takes the
`modified` stamp `docRead` gave (`--was`) and refuses to write over a page
that changed since, so two editors cannot silently drop each other's work.

Folders are fine — `guide/setup.md` — and appear as headings in the list.
Deleting is done at the window only; `git rm` is the honest way from a shell.

What belongs here is writing *about this app*: how a flow works, why a rule
exists, what a tab is for. The work itself is on the other tabs.
