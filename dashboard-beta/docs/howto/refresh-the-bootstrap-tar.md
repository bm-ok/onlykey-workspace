# Refresh the bootstrap tar

`okc-bootstrap.tar` in the repository is what a fresh install starts from:
every job, prompt, contract and skill, as readable files plus a manifest.
Nothing about approvals is in it — everything imported arrives waiting to
be read.

It does not follow approvals by itself. After a skill is approved or a
job is edited and approved, the tar is behind until somebody rewrites it.

## Steps

    node tools/okc.js bootstrapShip

    wrote ...\dashboard-beta\okc-bootstrap.tar -- 153,600 bytes, 1 of 25 entries moved:
      ~ skills/supervisor.md  (42,425 characters to 42,802)

It writes the same bytes the window's **as a file** button hands out onto
the repository's tar — found one level above `dist/` on a development
boot, or wherever `--to` says — and prints what moved, by name with both
sizes. That line is what the commit message needs; a tar rewritten is a
diff git cannot show. Running it again with nothing changed writes nothing
and says so.

Then commit the tar.

## The other doors

- **Settings → Bootstrap** — export to a folder, export as a file, import a
  folder or a file. Importing is a person's press: it writes the documents
  that say what a machine is told it is.
- `bootstrapExport --to <folder>` is open from the command line (it changes
  nothing here); `bootstrapImport` is not.

## What is deliberately not in it

Approvals, set-aside flags, edit stamps, hashes: state about a copy rather
than about the thing. A fresh import is fresh.
