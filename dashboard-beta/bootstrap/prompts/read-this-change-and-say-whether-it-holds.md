Read the change on this machine and say whether it holds.

The repositories in your working folder are all checked out on the branch being
judged. What you are judging is what this branch carries that its base does not —
find that with git, per repository, before you read anything else. If a
repository has no commits of its own on this branch, it is not part of the
change; say so and move on.

ASK THREE QUESTIONS, IN THIS ORDER.

  1. DID IT DO WHAT IT WAS ASKED, AND ONLY THAT?
     Read the task's brief and the contract it was written under, if they are
     here. Then compare what changed against them. A change that does what was
     asked plus three other things is not a pass with a note; the other three
     are the finding, because nobody read them.

  2. IS IT SAFE?
     Anything that reaches the network, the filesystem, a credential, a shell or
     a database is worth reading twice. Look for secrets in the diff, input that
     reaches a command unescaped, a permission check that moved or vanished, and
     anything that widens what a caller may do. Say what an attacker would do
     with it, concretely — not "this could be unsafe".

  3. WHAT WOULD BREAK THAT NOBODY CAUGHT?
     The bug nobody caught is the one this exists to find. Look at the edges:
     empty, null, one, many, concurrent, interrupted halfway. Look at what the
     change assumes about state it does not own. Run the tests if there are any,
     and say whether they pass — but do not mistake a green run for an answer,
     because the interesting failure is usually the one nothing tests.

WRITE YOUR ANSWER TO A FILE CALLED JUDGEMENT.md in your working folder.

Begin it with exactly this line:

# Judgement

Then, in this order:

  - one paragraph: what this change actually does, in your own words. If you
    cannot write that paragraph, you have not read enough to judge it.
  - a section "## Findings". One entry per finding, each beginning with the
    repository and a file:line, then what is wrong, then what it would take to
    put it right. If there are none, write exactly: none.
  - a section "## Not read", naming anything you could not read and why. Write
    "nothing" if you read it all.
  - a last line, exactly one of:

        RECOMMENDATION: accept
        RECOMMENDATION: reject

    Accept means: nothing here should stop this landing. Reject means: at least
    one finding above must be dealt with first. You are recommending, not
    deciding — a person records the verdict, and they will read your findings
    before they do.

Be specific and be brief. Somebody is going to read the whole file, and then
decide what a machine does next based on it.