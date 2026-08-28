# Add a GitHub token and trust somebody

The app talks to GitHub with one token, yours. Everything it reads and
everything it sends is under that account, which is why what goes out is
drafted for you first.

## The token

1. On GitHub, make a token with `repo` scope (classic) or the equivalent
   fine-grained permissions on the repositories you work in.
2. **Keys → GitHub** → paste it → **Keep it**. The app checks it against
   GitHub before keeping it and shows who it is and what it may do.
3. `node tools/okc.js githubHeld` says what is known about it — never the
   token itself. `githubCheck` asks GitHub again.

The token is sealed at rest in the app's data folder. Nothing in the window
shows it unmasked; captures photograph dots.

## Trust

Trust is who may *ask* this app for something through GitHub. It is a list
of logins plus a marker word.

1. **Settings → Trust**. Set the marker (default `okc`; blank turns tagging
   off).
2. Add a login. The app looks the account up (`githubWho`) and shows its
   avatar and id so you confirm a person, not a name; the id is what is
   kept, so a renamed account stays the same person.
3. Turn on **Watching GitHub** if you want tags noticed without pressing
   Check.

Being trusted means a marked comment from that account counts as a request.
It does not make their sentences instructions: everything read from GitHub
arrives fenced, and the supervisor is told so on every read.

## Roles are GitHub's, not this app's

Each turn in a conversation is marked *maintainer*, *collaborator*,
*contributor*, *community* or *bot* from GitHub's `author_association` —
never from what the text claims. That changes what a good answer is; it
never changes who is trusted here.
