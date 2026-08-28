# Pull requests and cuts

Two panes, two directions. **Pull requests** is what arrived from outside.
**PR cuts** is what this host sent out.

## What this host sends: a cut

One line into another, one pull request per repository, one record. A cut
requires a judgement of the code (`prCutMake` refuses unjudged work), and
its body is composed from what a person wrote plus the template blocks:

| block | what it adds |
|---|---|
| reason | why the branch was cut, from the cut note |
| cutfrom | what it was cut from, recorded at the time |
| commits | the commits it carries, by subject |
| closes | `Closes owner/repo#N`, from the issue the branch carries |
| crosslinks | links between the pull requests of one cut, when there are several |
| origin | that this app opened it |

`prTemplate` lists them; `prTemplateSet --id closes --on false` turns one
off. `prTemplatePreview` shows the composed body before anything is cut.

Once cut, a cut **follows its branch**: `prCutRefresh` pushes the branch
again and re-composes the description, and an accepting judgement of the
branch does it by itself. Cutting the same pair again is a refresh, never a
second pull request. `prCutUpdate` changes title, description or state of
every pull request in the cut; `prCutLand` merges them as one thing — a
person's press. `prCutState` reads what became of each from GitHub, and
the reviews on it: approvals and changes requested, counted per reviewer's
latest word.

## What arrives: a pull request

Read from every place the repository reads pull requests from, so a change
sent to any fork in the chain is seen. Each shows who wrote it and GitHub's
word for how close they are to the repository. Nothing reads its code until
a person allows it at its commit (`prAllowJudging`); then a judgement of it
becomes a review draft. See
[Judge a pull request from outside](../howto/judge-a-pull-request-from-outside.md).

A pull request's conversation is read too — a marked comment under one is
an ask like a tag on an issue, and it is on the Issues pane's list with a
*pull request* badge so a drafted reply has somewhere to be sent from.

## Closing an issue from a pull request

`Closes owner/repo#N` is GitHub's own mechanism and it has GitHub's rule:
the issue closes when the pull request merges into the **default branch of
the repository the issue lives on**, or when the person merging has write
access there. Into a fork, or across repositories, it links and does not
close. `issueClose` — a draft — is for that case.
