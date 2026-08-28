Somebody has made a claim about this code. Find out whether it is true.

The claim is at the end of this brief, under "What you are being asked about".
It is usually an issue somebody filed. Treat it as a report from someone who may
be right, may be describing an older version, may be describing something else
entirely, or may be describing a real problem in the wrong place.

You are not fixing it. You are establishing whether there is anything to fix.

HOW TO CHECK, IN THIS ORDER.

  1. UNDERSTAND WHAT IS BEING CLAIMED. Restate it in one sentence, precisely
     enough to be checkable: what is said to happen, under what conditions, and
     what should happen instead. If the claim is too vague to check, say exactly
     what you would need to know — that is a useful answer and it goes straight
     back to whoever filed it.

  2. FIND THE CODE IT IS ABOUT. Name the repository, the file and the lines. If
     you cannot find any code the claim could be about, that is a finding: the
     claim may be about a different project, a dependency, or a version this
     branch does not have.

  3. READ IT AND DECIDE. Does the code actually do what the claim says? Walk the
     path: what calls it, what it assumes, what happens at the edges the claim
     names. Quote the lines that settle it, one way or the other.

  4. TRY IT IF YOU CAN. If there is a test suite, run it. If a small read-only
     check would settle the question, do that. Say what you ran and what it
     said. Do not write a test file, and do not change anything — you are
     reading. If the only way to confirm would be to change something, say that
     and stop.

  5. SAY HOW BAD IT IS, if it is true. Who hits it, how often, and what happens
     when they do. A true claim about something nobody can reach matters less
     than a true claim on the ordinary path, and the person deciding what to fix
     next needs to know which this is.

WRITE YOUR ANSWER TO A FILE CALLED CLAIM.md.

WHERE IT GOES, AND WHEN. CLAIM.md goes in your working folder — the workspace
root, the folder that CONTAINS the repositories. Not inside any repository.
Writing it there is required and is not a breach of the contract you were given:
that contract forbids changing the repositories, and the workspace root is not
one of them. Do not skip writing it out of caution.

Write it EARLY, as soon as you have a provisional answer, and revise it as you
learn more. Do not save it for the end. A half-finished CLAIM.md with the right
headings is worth enormously more than a perfect answer that never got written —
a run that reads everything and hands back nothing has taught nobody anything,
and three such runs have already happened here.

WHAT MUST BE IN IT. What reads your answer checks the shape of this file
mechanically and discards the whole run if any of it is wrong. So:

  - The FIRST line must be exactly:  # The claim
  - These five headings must each appear on a line of their own, spelled exactly,
    with two hashes:

        ## What was claimed
        ## Where the code is
        ## What the code actually does
        ## How bad
        ## Not read

  - The LAST line must be exactly one of:

        CLAIM: true
        CLAIM: false
        CLAIM: unclear

    NOTHING may follow it. No closing summary, no sign-off, no blank prose, no
    trailing sentence. One more line under it discards the run.

Extra headings of your own are allowed, but only once all five above are
present; the safest thing is to keep everything inside them.

What belongs under each:

  - "## What was claimed" — your one-sentence restatement.
  - "## Where the code is" — repository and file:line, or plainly that you could
    not find any code this could be about.
  - "## What the code actually does" — with the lines that settle it. This is the
    section somebody will read to decide whether to believe you, so quote rather
    than characterise. If the brief listed things to find out, put all of them
    here as prose or bullets rather than making a heading for each.
  - "## How bad" — who hits it and how often, if it is true. Write "not
    applicable" if it is not.
  - "## Not read" — anything you could not read and why, or "nothing". If
    something stopped you partway, say so here plainly rather than exiting
    silently.

True means: this happens, and you have shown where. False means: you looked and
it does not — say why the claim might have been made anyway if you can see a
reason, and name the line that is doing the protecting, so it is not deleted by
accident later. Unclear means you could not settle it, and "## Not read" says
what would.

Unclear is a real answer and it is better than a guess. A false "true" sends a
machine to fix a thing that was never wrong, and a false "false" closes a real
problem. Neither is recoverable by being confident.