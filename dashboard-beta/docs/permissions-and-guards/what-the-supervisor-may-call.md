# What the supervisor may call

`src/app/supervisor/allowed.js` is a list of action names, each with the
reason it is on the list, and `supervisorMay` prints it. Anything not on it
does not exist as far as the supervisor is concerned: the API answers *no
such verb*, not *forbidden*, because a verb that answers "forbidden" gets
retried with different words.

## The shape of the list

**Reading** — nearly everything: `repositories`, `branchBoard`, `lines`,
`tasks`, `judging`, `judgementFindings`, `judgementLog`, `prCuts`,
`prCutState`, `issues`, `issueRead`, `issueDrafts`, `pools`, `jobs`,
`prompts`, `contracts`, `skillReading`, `whatsNew`, `triage`, `todos`.

**Writing its own work** — `taskCreate`, `taskQueue`, `taskUnqueue`,
`branchCreate`, `branchAsLine`, `judgementCreate`, `judgementQueue`,
`judgementUnqueue`, `prDraftSave`, `prCutMake`, `prCutRefresh`, `lineSync`,
`repoSync`, `repoSyncBranch`, `repoForkSync`.

**Speaking, drafted** — `issueSay`, `issueClose`, `judgementSay`,
`supervisorSays`, `chatSay`.

**Proposing** — `jobSave`, `promptSave`, `contractSave`, `skillPropose`,
`skillAsked`, `skillHistory`.

**Its own notes** — `triageSet`, `triageForget`, `todoAdd`, `todoSet`.

## Withheld, and why

| withheld | reason |
|---|---|
| `prCutLand` | merging is the one place a person reads the change and says yes; everything before it is reversible from GitHub, this is not |
| `prCutUpdate`, `prCutForget` | can close every pull request in a cut, or stop tracking one; neither is needed to send work out |
| `issueApprove`, `issueDiscard` | releasing a draft is the person's press the draft exists for |
| `prAllowJudging` | reading a stranger's code is a decision |
| `issueHand` | a supervisor that hands itself work decides what it works on |
| `*Approve`, `skillApprove`, `skillSave` | approvals |
| every `vm*`, `guest*`, `key*` | machines and credentials |
| `settingSet`, `guardSet` | what may run here and what goes out in your name |
| `docWrite`, `docRemove` | the wiki is people's |

The list is a test fixture too: `test/tabs/supervisor-allowed.test.js`
holds it to the reasons, and the drill *what its model may run* holds the
machine to having no other tool at all.
