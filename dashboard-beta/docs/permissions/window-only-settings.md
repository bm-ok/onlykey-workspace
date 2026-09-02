# Window-only settings

`settings` lists every setting and says where each may be changed.
`settingSet --name X --value Y` changes the ordinary ones; the ones below
answer with a sentence instead, and the sentence is the reason.

| setting | what it does | why it is the window's |
|---|---|---|
| `testsEnabled` / `testsFor` | the drills, on for one folder; off, the Test tab is gone and every action in it refuses | they write a task and take a credential off a machine — a decision about somebody's repository, not a flag |
| `testsSandbox` | GitHub owners the drills may run against; with names on it every remote and its chain must belong to one | a drill against a real project's fork is a stranger typing into it |
| `githubTrusted` | who may ask this app for something through GitHub | naming a person is naming a person |
| `githubMarker` | the word that makes a comment a request | blank turns tagging off |
| `githubReplyDirect` | replies go out without the draft step | speech in your name |
| `githubCloseDirect` | closes happen without the draft step | likewise |
| `githubReviewDirect` | reviews post without the draft step | likewise, and a maintainer may merge on it |

## Ordinary settings

| setting | what it does |
|---|---|
| `supervisorWakes` | whether saying something, a landing or a verdict wakes the supervisor (*Answers by itself*) |
| `watchGitHub` | whether the host sweeps GitHub every five minutes and wakes for a tag |
| `queueAutoStart` | whether the queue starts with the app |
| `supervisorKey` | which sign-in the supervisor uses |

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

Settings → General for the drills and the queue; Settings → Trust for
everything about GitHub and speaking in your name; Workspace → *What this
workspace is armed to do* for all of it at once. The file is
`state/settings.json` in the app's data folder, under `forFolder`, and
`settings` prints its path.

See [switching workspaces](../howto/switch-workspaces.md).
