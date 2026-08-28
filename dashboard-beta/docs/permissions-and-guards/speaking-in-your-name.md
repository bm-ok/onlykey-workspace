# Speaking in your name

Everything this app sends to GitHub goes under your token, so a maintainer
reads it as yours. Three acts leave this host in your name — a **reply**,
a **pull request**, a **review** — plus a **close**. Each has a draft step
in front of it, and each draft step has a switch.

## Drafts

`issueSay`, `issueClose`, `reviewDraft` / `judgementSay` write into the
drafts drawer, keyed one per conversation (`owner/repo#N`). The inbox says
what is waiting; Repositories → Issues and Judge → Judgement show it with
its Send / Close / Post button — purple. `issueApprove` releases,
`issueDiscard` throws away; both are a person's. A review is pinned to the
commit the judge read and refused at release if the author pushed since.

## Direct

Settings → Trust → *Speaking in your name*: `githubReplyDirect`,
`githubCloseDirect`, `githubReviewDirect`. Each purple. With one on, that
kind goes out the moment it is written — the supervisor answering under a
pull request by itself is the teammate feel; the draft stays for the kinds
left off. The three are separate because their blast radius differs: a
reply is words, a close is a state, a review is something a maintainer may
merge on.

## Who may ask

Only a trusted login's marked comment is a request (`readingOf` — kind
*request* or *evidence*). The supervisor may only answer what was asked
about; `mayAnswer` re-reads the thread fresh before any reply or close, so
a tag withdrawn is a permission withdrawn.

## A pull request

Opening one is the supervisor's — sending work out — and is not drafted:
it needs a judgement of the code and it is reversible on GitHub. Merging is
never the app's. `prCutLand` is purple.

## What never goes out

Assigning, labelling, editing other people's issues — there is no tool.
This app helps somebody else's project; it does not run it.
