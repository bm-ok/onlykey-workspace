# Refresh the bootstrap tar

`okc-bootstrap.tar` in the repository is what a fresh install starts from,
and what a folder with no `.okc` in it is set up from: every job, prompt,
contract and provisioning script, as readable files, plus a `library.json`
manifest and the `.gitignore` that keeps a drawer out of git. Nothing about
approvals is in it — everything imported arrives waiting to be read.

It is the same layout a workspace's own drawer has, which is why there is
no translation either way: a bundle is a `.okc` folder in a tar.

It does not follow approvals by itself. After a skill is approved or a
job is edited and approved, the tar is behind until somebody rewrites it.

## Steps

    node tools/okc.js bootstrapShip

    wrote ...\dashboard-beta\okc-bootstrap.tar -- 163,840 bytes, 1 of 28 entries moved:
      ~ provision/supervisor-skill.md  (42,425 characters to 42,802)

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
