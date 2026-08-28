# Sign a machine in to Claude

A machine runs Claude with a credential this host holds and lends. The
credential is sealed here, given to a machine for a run, and taken back
after. Nothing on a machine keeps it.

## Get a credential

1. **Keys → Claude sign-ins → Sign in.** Name it, pick its role: *worker*,
   *judge* or *supervisor*. A judge and a worker are different sign-ins on
   purpose, so what each spends is metered apart.
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
whatever the worker refreshed. By hand:

    node tools/okc.js vmCredentialsPut --name w2 --role worker
    node tools/okc.js vmCredentialsForget --name w2

A sign-in that cannot authenticate is **paused**, not revoked — nothing
lends it again until `guestResume --name X --why ...` says the pause was
wrong.

## The supervisor's

**Supervisor → Chat → Start** brings the supervisor up and signs it in as
one act (`supervisorUp`). `supervisorKey` says which sign-in it uses;
`supervisorDown` takes the credential back and stops the machine, in that
order.

## What you will not see

The token. `guests` shows a fingerprint and account details, the Keys tab
shows dots, and captures photograph dots. Anything that would print one is a
bug.
