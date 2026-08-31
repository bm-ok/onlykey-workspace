# Sign a machine in to Claude

A machine runs Claude with a credential this host holds and lends. The
credential is sealed here, given to a machine for a run, and taken back
after. Nothing on a machine keeps it.

## Get a credential

1. **Keys → Claude sign-ins → Sign in.** Name it, pick its role: *worker*,
   *judge*, *supervisor* or *diy*. They are different sign-ins on purpose,
   so what each spends is metered apart — and a person's afternoon on a DIY
   machine is not billed to the pool the queue draws from.
2. The sign-in desk on a machine opens a login URL; visit it, sign in, and
   paste the code back. The credential is kept under the name; the desk is
   left empty.
3. `guests` lists what is held: name, role, fingerprint, who holds it now.
   `credentialsHeld` says how long each has left.

Command line: `claudeSignIn --name judge-b2 --wait`, then
`claudeSignedIn --name judge-b2 --code <code> --role judge`.

## Lending

The queue lends by itself: a task gets a worker credential, a judgement a
judge one, and `guestBack` takes it back when the run ends, keeping
whatever the worker refreshed. A DIY seat lends a `diy` one the same way —
see [Work in a machine yourself](work-in-a-machine-yourself.md). By hand:

    node tools/okc.js vmCredentialsPut --name w2 --role worker
    node tools/okc.js vmCredentialsForget --name w2

A sign-in that cannot authenticate is **paused**, not revoked — nothing
lends it again until `guestResume --name X --why ...` says the pause was
wrong.

## What is written beside it

Handing a credential over also writes `remoteControlAtStartup: false` into
`~/.claude/settings.json` on the machine — every time, on every machine. A
machine this host lends a sign-in to should not also be offering itself to
anything else at boot, and it is written down rather than relied on,
because the default is not this app's to depend on.

A machine holding a sign-in **cannot be snapshotted**, and the pane says so
rather than refusing quietly: a snapshot would keep a copy of the
credential for as long as the snapshot exists. Take it back first.

## The supervisor's

**Supervisor → Chat → Start** brings the supervisor up and signs it in as
one act (`supervisorUp`). `supervisorKey` says which sign-in it uses;
`supervisorDown` takes the credential back and stops the machine, in that
order.

## What you will not see

The token. `guests` shows a fingerprint and account details, the Keys tab
shows dots, and captures photograph dots. Anything that would print one is a
bug.
