# What this host has

The first thing, and the only suite whose job is to **stop**.

Everything else here assumes a host that has been set up: a folder of
repositories open, a token that can reach GitHub, permission to run drills
against this workspace. On a machine where those are missing, the suites that
follow do not fail in useful ways — they fail in nine different confusing ways,
each about the last thing it touched, and none of them says "nobody has made a
key yet".

**It is read-only, and it never sees a value.** It asks whether a key is there
and whether it works. What the key IS belongs to the person who made it, and
this app is built so that a model working on it can know that something was done
in the Keys tab without knowing what — see the Keys tab's own rules. A test that
printed a token would put it in a log, in a result, and in a transcript.

**Its checks are doors, not steps.** A missing key is `asksYou` rather than a
failure: nothing is wrong with the code, somebody has to go and do something,
and every run will say so until they do. As gates they close the rest of the
series, because everything below was about to ask for the same missing thing.

## The order this establishes

    a workspace is open          nothing here can name a repository without one
    drills are allowed here      testing mode, for this folder, chosen by a person
    a GitHub token that works    the fork flow, the pull requests, the syncing

The worker credential is NOT here. It is a different thing needed at a different
time — it is lent to a machine, so it is asked for once machines exist — and it
has a suite of its own further down.
