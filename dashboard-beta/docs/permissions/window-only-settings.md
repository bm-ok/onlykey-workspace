# Window-only settings

`settings` lists every setting and says where each may be changed.
`settingSet --name X --value Y` changes the ordinary ones; the ones below
answer with a sentence instead, and the sentence is the reason.

| setting | what it does | why it is the window's |
|---|---|---|
| `testsEnabled` / `testsFor` | the drills, on for one folder; off, the Test tab is gone and every action in it refuses | they write a task and take a credential off a machine — a decision about somebody's repository, not a flag |
| `testsAsked` | a raised hand: the drills asking to be turned on, with a reason (written by `testsAsk`, answered in the window) | forging one puts a question in front of a person that nobody actually asked |
| `testsSandbox` | GitHub owners the drills may run against; with names on it every remote and its chain must belong to one | a drill against a real project's fork is a stranger typing into it |
| `githubTrusted` | who may ask this app for something through GitHub | naming a person is naming a person |
| `githubMarker` | the word that makes a comment a request | blank turns tagging off |
| `githubReplyDirect` | replies go out without the draft step | speech in your name |
| `githubCloseDirect` | closes happen without the draft step | likewise |
| `githubReviewDirect` | reviews post without the draft step | likewise, and a maintainer may merge on it |

## Ordinary settings

| setting | what it does |
|---|---|
| `supervisorWakes` | whether a landing or a verdict wakes the supervisor — the queue waking it for reasons **nobody asked for** (*Answers by itself*) |
| `watchGitHub` | whether the host sweeps GitHub every five minutes and wakes for a tag |
| `supervisorKey` | which sign-in the supervisor uses |

**Saying something to it is not on that switch.** `chatSay` wakes it whatever
`supervisorWakes` says, because somebody typing a sentence and pressing send has
already asked. The gate was there once and it was the wrong gate: a message sat
unread beside a machine that was up, signed in and idle, and the advice was to go
and press *Wake it* — which spends the same turn, one step later, after showing
somebody a message that looked ignored.

`queueAutoStart` **is gone.** The queue now comes up running on every start, like
every other timer this app has. It was a setting, off by default, and that was
the quiet version of an older fault: a host whose whole job is handing work to
machines came up not doing it, and nothing on the page said so — work simply sat
still, which looks exactly like no machine being free. Stopping the queue still
survives a save; only starting the app brings it back.

## Every one of these is set for one folder

Both tables above — all of them except `supervisorKey` — follow the open
workspace. A folder opened for the first time reads them all at their
defaults: nothing watching, nobody trusted, no marker, nothing sent unread,
no drills. **A new workspace is inert**, whatever the last one was allowed
to do.

Nothing is thrown away by switching: what is set for one folder stays with
it and is there on returning. `settings` answers for the folder open now,
and `settingSet` refuses a folder-scoped setting while no workspace is open
rather than applying it to whichever is opened next.

`supervisorKey` — which sign-in on this computer the supervisor uses — is
the one that does not follow, because it is a fact about the keyring.

Settings → General for the drills; Settings → Trust for
everything about GitHub and speaking in your name; Workspace → *What this
workspace is armed to do* for all of it at once. The file is
`state/settings.json` in the app's data folder, under `forFolder`, and
`settings` prints its path.

See [switching workspaces](../howto/switch-workspaces.md).
