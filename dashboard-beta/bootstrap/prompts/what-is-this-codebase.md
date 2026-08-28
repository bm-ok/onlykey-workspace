Work out what this codebase is, for somebody who has never seen it.

Nothing that reads your answer can see the code. A supervisor deciding what work
to ask for next has this file and nothing else, so what you leave out does not
exist as far as the rest of this system is concerned.

You are surveying, not reviewing. Do not look for bugs and do not judge quality —
there is a different judge for that. The question here is only: what IS this.

WHERE TO START. Your working folder holds one or more git repositories, all
checked out on the same branch. Read the top level of each first, then the
README, then whatever the README points at. Follow what is actually imported and
called rather than what a document claims; where they disagree, the code is the
fact and the disagreement is worth a line of its own.

COVER THESE, IN THIS ORDER.

  1. WHAT IT IS. One paragraph per repository: what it does, who or what uses it,
     and whether it is a program, a library, a service or something else. If you
     cannot tell, say that plainly — "this looks like X but nothing confirms it"
     is more useful than a confident guess.

  2. HOW THEY RELATE. Which repository depends on which, and how — imported,
     called over a network, sharing a file format, or not at all. If they are
     unrelated, say so; a folder of unrelated repositories is a fact worth
     knowing early.

  3. HOW IT IS BUILT, TESTED AND RUN. The actual commands, taken from the files
     that define them rather than from prose: the package manifest, the makefile,
     the scripts folder, the CI configuration. Say which of them you ran, if any,
     and what happened. Say plainly when there is no test suite.

  4. THE SHAPE OF IT. The directories that matter and what lives in each. Name
     the entry points — the file somebody would open first to follow what
     happens. Ignore vendored code, build output and dependencies; say that you
     did.

  5. THE CONVENTIONS IT KEEPS. How it is written: module style, error handling,
     naming, comments, how tests are laid out. What a change would have to look
     like to belong here. This is the section that decides whether future work
     fits in, so be concrete and quote a short example rather than describing.

  6. WHERE THE RISK IS. Not bugs — PLACES. What is load-bearing, what is
     obviously fragile or old, what has no tests around it, what touches
     credentials, the network or a filesystem. Somewhere a change is most likely
     to hurt.

  7. WHAT WOULD BE WORTH DOING. Three to five specific things, each one a line:
     what, in which repository, and why it is worth it. This is what a supervisor
     will read and turn into a request, so vague entries produce vague work.

WRITE YOUR ANSWER TO A FILE CALLED CODEBASE.md in your working folder.

Begin it with exactly this line:

# What this codebase is

Then a section per heading above, in that order:

## What it is
## How they relate
## How it is built, tested and run
## The shape of it
## The conventions it keeps
## Where the risk is
## What would be worth doing

Finish with a section "## Not read", naming anything you could not read and why —
generated, enormous, in a language you do not follow. Write "nothing" if you read
it all. An honest gap is information; a confident guess is damage.

Be concrete. Name files. Somebody is going to read the whole thing and then
decide what a machine does next based on it.