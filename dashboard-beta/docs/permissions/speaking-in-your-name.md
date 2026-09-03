# Speaking in your name

Everything this app sends to GitHub goes under your token, so a maintainer
reads it as yours. Three acts leave this host in your name — a **reply**,
a **pull request**, a **review** — plus a **close**. Each has a draft step
in front of it, and each draft step has a switch.

## Drafts

`issueSay`, `issueClose`, `reviewDraft` / `judgementSay` write into the
drafts drawer, keyed one per conversation (`owner/repo#N`). The inbox says
what is waiting; Repositories → Issues and Judge → Judgement show it with
its Send / Close / Post button. `issueApprove` releases,
`issueDiscard` throws away; both are a person's. A review is pinned to the
commit the judge read and refused at release if the author pushed since.

## Direct — auto respond

Settings → Trust → *Speaking in your name — auto respond*:
`githubReplyDirect`, `githubCloseDirect`, `githubReviewDirect`. Each is
window-only — `settingSet` answers with a sentence instead.
With one on, that kind goes out the moment it is written — the supervisor
answering under a pull request by itself is the teammate feel; the draft
stays for the kinds left off. The three are separate because their blast
radius differs: a reply is words, a close is a state, a review is something
a maintainer may merge on.

**The tag and the address still apply.** `mayAnswer` runs before the
direct-or-draft branch, so even with auto respond on this host only answers a
thread where somebody trusted addressed the account it posts as and used the
marker. It cannot answer a stranger's issue, and it cannot answer itself.

**What goes out unread says so.** The events line reads *"replied on #7 —
sent directly, nobody read it first"*, the story timeline carries that, and
each one is recorded (`spokenFor`, the last 200) and counted on the Trust
card — because with drafts off the inbox is empty by design, and that was
the only thing saying what was about to happen.

**Switching it on does not release what is already drafted**, and should
not: you have not read those. Repositories → Issues has **Send all N
waiting** for that, and each one goes through the ordinary release door —
same checks, one refusing does not stop the rest.

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
