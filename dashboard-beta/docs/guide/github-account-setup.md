# Give the app its own GitHub account

**Do not run this on your primary account.** Make a second GitHub account, and
let the app be that account: every branch it pushes, every pull request it
opens, every reply it sends goes out as somebody whose only job is this.

## Why

- **Blast radius.** The token is `repo`-scoped or fine-grained, but it is still
  a credential on a machine that runs models. On a second account the worst case
  is bounded by what that account can reach; on your primary account it is
  everything you can reach, in every organisation you belong to.
- **You can tell the two apart afterwards.** A thread where `bmatusiak` asks and
  `okc-bot` answers reads correctly to a maintainer, to you six weeks later, and
  to this app. One where both are you does not.
- **The app stops being able to ask itself for things.** This is not
  hypothetical: with one account, everything the app posts is written by a
  trusted login, and nothing on the way out strips the marker — so a reply that
  quoted a request could be read back as a fresh one. See
  [the trigger](#the-trigger) below.
- **Rate limits are per account.** Sweeping a busy tracker stops competing with
  your own use of GitHub.

## Make the account

1. A new GitHub account. Name it for what it is — `okc-bot`, `yourname-okc`.
   It needs its own email; most providers allow `you+okc@…`.
2. Turn on two-factor authentication for it. It can push to repositories.
3. Give it access to the repositories it will work on — see
   [Write access](#write-access).

## Write access

The app pushes branches to the repository the workspace's `origin` points at,
and opens pull requests into the repository *Send work to* names. The new
account has to be able to do both, and there are two shapes:

**Collaborator on the repositories you already have** — add `okc-bot` as a
collaborator with write access on each fork the workspace holds. Nothing else
changes: the workspace's remotes, *Send work to*, the fork chain and the sandbox
owners list stay as they are, and only the token is swapped. This is the least
to re-check, and the one to pick if you are not sure.

**The account has its own forks** — `okc-bot` forks, and the workspace's clones
are re-pointed at its forks (`git remote set-url origin …`). The chain grows a
link, so afterwards: pick *Send work to* again on each repository (Repositories
→ Repos), add the new owner to the sandbox list (Settings → General) if you use
the drills, and expect `Closes` to stop auto-closing where the merge is no
longer into the issue's own repository.

Either way the app tells you if it cannot: Keys → GitHub says **may send work**
per repository, and an errand appears in the inbox — *the token cannot send work
where it goes* — naming the account and the destination, rather than letting a
cut fail at the push an hour later.

## The token

Keys → GitHub → **Replace it**, signed in as the new account:

- **Fine-grained**, if every repository in the workspace has the same owner.
  Contents: read and write. Pull requests: read and write. Metadata: read.
  Nothing else. It is the smallest thing to lose.
- **Classic**, if they do not — a fine-grained token covers one owner only, so
  an organisation fork with a personal-account parent needs `repo`. Add
  `workflow` only if a branch will ever touch `.github/workflows`.
- Give it an expiry either way. The pane reads it and says how long is left.

The token is checked against GitHub before it is kept, so a token that does not
work never replaces one that does; the card then says `held — okc-bot`. Nothing
ever shows it again, and no machine is ever handed it.

**Afterwards, press Check on Repositories → Repos.** Every capability recorded
about a repository was probed with the old token and says nothing about the new
one; the inbox says so until you do (*checked as somebody else*).

## What stays yours

- **The trusted list is the people who ask** — you, and anyone else whose word
  should count. It is not the app. If the app's own account is on it, the inbox
  says *one account for both sides* and you should take it off.
- **Approvals stay at the window** — until you decide otherwise. The account
  changes who speaks; it does not change who decides. Replies, closes and
  reviews are drafted for you, and merging is always yours.
- **Auto respond is reasonable now, and was not before.** Settings → Trust
  turns the draft step off per kind. On a separate account that is the app
  speaking as itself; on your primary account it would have been the app
  speaking as you. Even then it can only answer a thread where somebody
  trusted addressed it and used the tag, and what goes out unread is recorded
  and counted on that card.
- **Your own account still merges.** `Closes owner/repo#N` closes the issue when
  the merge lands in the issue's own repository, or when the person merging has
  write access there — which is you, whichever account opened the pull request.

## The trigger

A comment is a request to this app when **three** things are true:

    [FROM:bmatusiak] @okc-bot okc: revalidate this one
     └ optional, and never believed  │      └ the tag
                                     └ the app's own account

1. **Who** — GitHub says a trusted account wrote it. Never what the text claims:
   `[FROM:x]` is carried on the reading and decides nothing, and if it disagrees
   with the author the reading says so.
2. **Addressed** — it names the account this app posts as. A comment that uses
   the marker without addressing the app is not a request to it, and the reading
   says what one reads like. This is also why the app can never trigger itself:
   it does not @-mention itself.
3. **The tag** — `okc:`, the marker set at Settings → Trust. One today; the
   reading records which tag matched, so several meaning different things is a
   small step later.

If the app has no token yet, there is no account to address and the older two
questions stand on their own.

## The order to do it in

1. Make the account, and give it write access one of the two ways above.
2. Keys → GitHub → **Replace it** with the new account's token.
3. Repositories → Repos → **Check**.
4. Settings → Trust: the list is **you**, not the app. Marker unchanged.
5. Settings → General: add the new owner to the sandbox list if its forks are
   where the drills would run.
6. Say `@<the new account> okc: …` on an issue, and watch Supervisor → Chat.

The inbox is the checklist: while any of *one account for both sides*, *the
token cannot send work where it goes* or *checked as somebody else* is showing,
something above is unfinished.
