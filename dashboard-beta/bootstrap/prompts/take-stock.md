Take stock of this machine and the folder it was set up in, and hand back a
report that somebody could read without having been there.

Say where you are: the machine's name, the folder you are actually in, and the
folder you were configured to use — and if those last two differ, say so plainly
rather than reporting the one that sounds right.

Then survey the folder. For every git repository in it, record the branch it is
on and the subject of its most recent commit. Count how many of the entries are
repositories and how many are not.

Check two things that must be true and are easy to assume: that a shell command
which fails actually fails, and that handing back a file which does not exist is
refused rather than reported as success.

Never print a credential. The address this machine pushes to contains one; if
you record it, redact it first.

Hand the report back as a file.