//---------------------------------------------------------------------------
//WHAT IN A DRAWER IS THIS HOST'S RATHER THAN THIS WORKSPACE'S.
//
//A DRAWER IS NOT MEANT TO BE INSIDE A REPOSITORY. It sits beside them in a
//workspace, not within them — but that is a layout, and a layout is one
//`git init` at the wrong level from being wrong.
//
//---- AND THE ANSWER IS NOT "IGNORE EVERYTHING" ---------------------------
//
//MOST OF A DRAWER IS WORTH KEEPING. The jobs, prompts, contracts and
//provisioning scripts are what a workspace is set up FROM — ../../bootstrap
//ships exactly those as a tar so a second workspace can start from the first —
//and the lines, the cuts, the landings, the template and the repository notes
//are the workspace's own record of what is being done. A blanket `*` would
//hide the half of this folder somebody most wants to keep, and hide it
//silently.
//
//WHAT IS NAMED HERE IS THE OTHER HALF: what a host has to set up for itself
//anyway, and could not use somebody else's copy of.
//
//  * A SECRET. `machines.json` carries every machine's dial-in token — the
//    thing it proves it is itself with — and the password its user boots as,
//    beside paths to disks that exist on one computer.
//  * A CACHE. `cached-*` is thrown away and asked for again by design, and
//    `cached-github.json` alone runs to megabytes that would land in a diff.
//  * WHEN THIS HOST LAST LOOKED, and which machine it has open. True of one
//    computer, meaningless on another.
//  * WHAT A WORKER REMEMBERED. `sessions/` is a gzipped tar of a machine's
//    `~/.claude` per branch cut — every turn, every tool call, everything it
//    was told — made by a machine THIS host lent a credential to. Somebody
//    else opening the workspace has their own machines and their own runs, and
//    the folder grows by megabytes a task. Named as a FOLDER because that is
//    what it is: one directory per key, holding `claude.tgz`.
//  * WHAT A RUN HANDED BACK. `artifacts/` is whatever work PRODUCED and gave to
//    this host — a built binary, a screenshot, a log with command output in it.
//    It is capped at 64 MB a file and at nothing in total, and what is in one
//    was chosen by a worker rather than by anybody here. A FOLDER, so the lanes
//    under it — worker, judge, job — are covered without naming three.
//
//    THE SAME OMISSION AS `sessions/`, FOUND THE SAME WAY: both are invisible
//    until real work runs, and by then they are already staged. This one is
//    worse in one respect — a session is a transcript this host made, an
//    artifact is a file this host did not choose.
//
//`cached-*` IS A PATTERN AND NOT TWO FILENAMES, because the names are built
//rather than written: ../cached/server.js does `doc('cached-' + name)`, so
//every cache anybody adds later is covered without anybody remembering to
//come back here.
//
//`repositories.json` IS DELIBERATELY NOT ON THE LIST, and it is the one that
//had to be argued about. It holds this host's probe results — what its token
//could reach, and which account asked — which are noisy and are nobody else's.
//It also holds `target`: WHERE WORK GOES for each repository, which is a
//decision somebody made on purpose. The probe results rebuild themselves on
//the next sweep; the decisions do not rebuild at all. So it is kept, and the
//noise is the price.
//
//THIS FILE IS NOT ON THE LIST EITHER, deliberately. It has to be tracked to do
//its job: a clone with no `.gitignore` in the drawer is a clone with no guard,
//and the first `add -A` there commits the tokens.
//---------------------------------------------------------------------------

module.exports = [
    '# What in here is this HOST\'s, not this workspace\'s: secrets, and what a host',
    '# sets up for itself anyway. Everything else is kept -- the jobs, prompts,',
    '# contracts and provisioning a workspace is set up from, and its own record of',
    '# lines, cuts, landings and where work goes.',
    '',
    '# Every machine\'s dial-in token and the password its user boots as, next to',
    '# paths to disks that exist on one computer.',
    'machines.json',
    '',
    '# Caches. Thrown away and asked for again; cached-github.json alone is',
    '# megabytes of churn. A pattern, because the names are built and not written.',
    'cached-*.json',
    '',
    '# When this host last looked, and which machine it has open.',
    'github-arrived.json',
    'diy.json',
    '',
    '# What a worker remembered: a tar of a machine\'s ~/.claude per branch cut,',
    '# made by a machine this host lent a credential to. Megabytes a task, and',
    '# every turn it was told.',
    'sessions/',
    '',
    '# What a run handed back: a built binary, a screenshot, a log with command',
    '# output in it. Chosen by a worker rather than by anybody here, up to 64 MB',
    '# a file. A folder, so worker/, judge/ and job/ are all covered.',
    'artifacts/',
    ''
].join('\n');
