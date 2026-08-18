<!-- generated: node dashboard/test/unused.js --write -->

# What nothing appears to use

**Suspects, not verdicts.** This matches names in text, so it is wrong in both
directions: an action reached only from the command line looks unused when it is
not, and a name appearing in a comment looks used when a comment cannot call
anything. Every line here is something to look at, and some of it is meant to be
here.

245 actions, 162 files searched.

## Named only in comments

The most interesting list. Nothing calls these, and something *says* something
does — so either the code moved and the comment did not, or it is dead surface
with a story attached.

- `testsAsk` — defined in actions/app.js, spoken about in test/suites/02-the-refusals/04-the-ways-round-a-refusal.js
- `vmProvisionUpdate` — defined in actions/machines.js, spoken about in tools/okc.js
- `taskGive` — defined in actions/tasks.js, spoken about in ui/tasks.js, test/suites/08-a-task-on-a-machine/01-what-survives-the-machine.js
- `testsForget` — defined in actions/tests.js, spoken about in tasks/harness.js
- `triage` — defined in actions/triage.js, spoken about in core/supervisor.js

## No caller anywhere

Reachable only by typing the name at the command line. Some of these are tools
and that is what they are for; the rest is surface nothing asks for.

- `logWatch` — actions/app.js
- `changeFile` — actions/branches.js
- `vmAuthStatus` — actions/credentials.js
- `guestBackup` — actions/guests.js
- `guestRestore` — actions/guests.js
- `machineAdd` — actions/host.js
- `machineRemove` — actions/host.js
- `machineReach` — actions/host.js
- `openEditor` — actions/host.js
- `judgementLog` — actions/judge.js
- `vmForget` — actions/machines.js
- `vmAddress` — actions/machines.js
- `vmLogs` — actions/machines.js
- `vmNetwork` — actions/machines.js
- `vmInfo` — actions/machines.js
- `vmBridges` — actions/machines.js
- `vmScripts` — actions/machines.js
- `vmRotateToken` — actions/machines.js
- `prComment` — actions/repos.js
- `gitRepos` — actions/repos.js
- `prDraftForget` — actions/repos.js
- `vmShellRun` — actions/runs.js
- `taskLogs` — actions/tasks.js
- `triageSet` — actions/triage.js
- `triageForget` — actions/triage.js
- `workspaceData` — actions/workspaces.js

## No window button and no drill

Something calls them, but nothing a person clicks and nothing a test exercises.

- `events` — actions/app.js, called by actions/app.js, actions/chat.js
- `appQuit` — actions/app.js, called by tools/restart.js
- `logSince` — actions/app.js, called by core/log.js
- `vmAuthBegin` — actions/credentials.js, called by actions/credentials.js
- `vmAuthCode` — actions/credentials.js, called by actions/credentials.js
- `vmAuthCancel` — actions/credentials.js, called by actions/credentials.js
- `vmSetupAgain` — actions/machines.js, called by actions/machines.js
- `prFetch` — actions/repos.js, called by tasks/queue.js
- `vmRuns` — actions/runs.js, called by tasks/queue.js, actions/tasks.js
- `vmRunOutput` — actions/runs.js, called by tasks/queue.js, actions/tasks.js
- `vmRunStop` — actions/runs.js, called by actions/tasks.js
- `vmSessions` — actions/runs.js, called by actions/tasks.js
- `vmSessionTail` — actions/runs.js, called by actions/tasks.js

## Exported, and nothing outside the file uses it

- core/data.js — LEGACY
- core/github.js — PUBLIC
- core/guests.js — okName
- core/handover.js — sealFor
- core/handover.js — openWith
- core/handover.js — aPair
- core/handover.js — guestHalf
- core/ipc.js — ADDRESS
- core/keys.js — CA_PEM
- core/secret.js — WINDOWS
- core/secret.js — MARK
- core/secret.js — os
- core/ssh.js — includeLines
- core/ssh.js — CONFIG
- core/ssh.js — USER_CONFIG
- core/ssh.js — PUB
- core/testruns.js — keyOf
- core/testruns.js — forgetState
- core/workspaces.js — slugFor
- core/workspaces.js — ORIGINAL
- machines/auth.js — deskHome
- machines/busy.js — release
- machines/busy.js — booting
- machines/editor.js — discover
- machines/editor.js — folderUri
- machines/job-api.js — configured
- machines/provisioner.js — resolveISO
- machines/provisioner.js — pickBridge
- machines/session.js — CLIP
- machines/vbox.js — logFolder
- machines/vbox.js — OFF_STATES
- machines/vms.js — stageOf
- repos/branches.js — headOf
- repos/branches.js — inAnyGroup
- repos/branches.js — protectedBranches
- repos/branches.js — isClean
- repos/branches.js — freeIfBusy
- repos/prtemplate.js — compose
- repos/remotes.js — remoteOf
- repos/serve.js — root
- repos/serve.js — advertise
- repos/serve.js — rpc
- repos/serve.js — SERVICES
- repos/serve.js — NAME
- tasks/artifact.js — SHOW
- tasks/artifact.js — CACHE
- tasks/contracts.js — STARTER
- tasks/harness.js — assert
- tasks/jobs.js — codePath
- tasks/jobs.js — STARTER
- tasks/onmachine.js — taskOn
- tasks/queue.js — busyWith
- tasks/store.js — STORED
- tasks/store.js — WORKERS

