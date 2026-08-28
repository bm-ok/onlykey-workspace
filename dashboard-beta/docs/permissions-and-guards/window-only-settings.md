# Window-only settings

`settings` lists every setting and says where each may be changed.
`settingSet --name X --value Y` changes the ordinary ones; the ones below
answer with a sentence instead, and the sentence is the reason.

| setting | what it does | why it is the window's |
|---|---|---|
| `testsEnabled` / `testsFor` | the drills, on for one folder; off, the Test tab is gone and every action in it refuses | they write a task and take a credential off a machine — a decision about somebody's repository, not a flag |
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

## Where

Settings → General for the drills and the queue; Settings → Trust for
everything about GitHub and speaking in your name. The file is
`state/settings.json` in the app's data folder, and `settings` prints its
path.
