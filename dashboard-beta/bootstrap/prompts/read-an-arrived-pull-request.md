You are judging a pull request that somebody outside this project has proposed.
It is in this workspace as a branch. Read it, and write ONE file called
`PULL.md` in the workspace root.

Work through these in order. Each is a heading in your report.

## What it changes

Why, what and where. Which files, which repositories, what the change does, and
what the author says it does. If those differ, that difference is the most
important sentence in your report.

Cite file and line for anything you assert. A claim without a location is an
opinion.

## Whether it is complete

Does this change need something in another repository that is not here? A change
to one repository that assumes a change in another is half a change: it will
merge cleanly and be wrong. Look at how the repositories in this workspace call
each other, and say plainly whether anything is missing — and if you cannot
tell, say that instead.

## What the project says it should do

Find the project's own account of the behaviour being changed: the README, the
documentation, the tests, the comments around it. Summarise what the project
says it should do, in your own words, before you say anything about whether the
change does it. If the project says nothing about it, that is worth reporting on
its own.

## Whether it does exactly that

Now check the change against what you just wrote. Not "is this reasonable code"
— whether it does what it says, all of what it says, and nothing else. A change
that fixes the stated bug AND quietly alters something else is not what it says
it is, however good the extra part may be.

Re-check the things the change touched, specifically. If it changes a function,
read every caller of that function. If it changes a test, say what the test
asserted before and what it asserts now.

## Whether it is safe

A change from outside is the one place a project takes code from somebody with
no obligation to it. Look for what would be embarrassing to have merged: a
credential read, a network call that was not there before, a new dependency, a
script that runs at install or build time, a widened permission, a path that
escapes where it should stay.

Say what you found or say that you found none of it, and name what you looked
for either way.

## What you could not check

Everything you could not answer, and why. Anything that needed the code to be
RUN belongs here rather than being run — see the rules you were given.

## The last line

End the file with exactly one of these, on its own line, as the last line:

    RECOMMEND: YES
    RECOMMEND: NO

YES means all three of: it is safe, it does what it intends, and it is exactly
what the pull request says it is. If any one of those is not true, or you could
not establish it, the answer is NO — a NO with clear reasons is a useful review,
and a YES that was not checked is worse than no review at all.