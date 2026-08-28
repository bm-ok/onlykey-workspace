var quoting = require('../shell/quoting');
var runsOf = require('./runs');

var q = quoting.q;
var heredoc = quoting.heredoc;
var RUNS = runsOf.RUNS;

//---------------------------------------------------------------------------
//GIVING A MACHINE A TASK, AND LETTING GO OF IT.
//
//FIRE AND FORGET, ON PURPOSE. A task runs for minutes or an hour, and holding
//the channel open for it would make dispatching indistinguishable from waiting —
//one command that appears to hang, no progress, and nothing else able to use the
//machine meanwhile. So this starts the work DETACHED and returns a run id.
//Progress is READ afterwards, from the session transcript, which is a delta with
//a bookmark rather than a stream nobody is watching.
//
//NOTHING HERE CARRIES A CREDENTIAL IN THE ENVIRONMENT, and that is a correction
//rather than an omission. The first version passed one as an environment
//assignment on the command that starts the run — which the agent inherits, and
//can print.
//
//That is the interaction that is easy to miss: transcripts are captured to this
//host and KEPT, so a credential reaching agent-visible output — an env dump, a
//stack trace, an error — is copied out and filed BY DESIGN. A worker is signed
//in separately through its own credential file, and where a job does need the
//machine's token it is written to a FILE with umask 077 rather than exported.
//
//---- three kinds of run, one piece of machinery ---------------------------
//
//  claude   `claude -p` gives the brief to a worker. The usual one.
//  shell    runs the brief AS A COMMAND. For exercising this machinery without
//           a worker in it — a soak wants to know what the queue, the channel,
//           the run record and the put-away do over an hour, and none of that is
//           about Claude. A `sleep` is a duration you can state.
//  job      runs a SCRIPT the operator wrote, with node, in the guest.
//
//SAME DIRECTORY, SAME PID FILE, SAME STATUS, SAME DETACHMENT, same log kept here
//afterwards — so what a shell run proves about the machinery is what a worker
//would have proved.
//
//A JOB RUNS ON THE MACHINE, WHICH IS THE WHOLE POINT. A job is arbitrary code,
//and code that runs on the operator's own computer is a program running as them
//— the API it is handed is a convenience, not a sandbox, because a Node module
//can require anything it likes. On a machine the blast radius is a thing that
//gets rolled back to a snapshot when the work ends.
//
//AND A JOB DOES NOT GET `okc`. "This machine cannot reach the dashboard's
//actions at all" is part of why a worker may run with permissions skipped, and
//it stays true: a job gets the same door everything else on the machine gets — a
//command on its PATH, authenticated by the machine's own token — and nothing
//wider.
//---------------------------------------------------------------------------

module.exports = function script(deps) {
    var d = deps || {};
    var payloads = d.payloads;
    var watcher = d.watcher;

    function build(spec) {
        var it = spec || {};

        //THE ID IS CHECKED BEFORE IT IS A PATH. Every line below joins it to a
        //directory — see ../dispatch/runs.js, which owns the shape.
        var id = runsOf.checkId(it.id);
        var dir = RUNS + '/' + id;

        //EXACTLY ONE KIND. Two of these set at once is a run that does one thing
        //and is recorded as another, and the caller that did it would never find
        //out: the machinery is identical, so nothing downstream disagrees.
        var kinds = [it.job ? 'job' : null, it.shell ? 'shell' : null].filter(Boolean);
        if (kinds.length > 1) {
            throw new Error('A run is a job, a shell command, or a brief for a worker — not '
                + kinds.join(' and ') + ' at once.');
        }

        //THE CONTRACT IS CARRIED, NOT REFERENCED.
        //
        //It used to be a path on the machine, which is why it was never once
        //used: nothing here puts a file on a machine, so the flag named
        //something that could not be made to exist. The text comes from this
        //host and is written into the run's own directory.
        //
        //Which is the better arrangement anyway. Rules that govern a run belong
        //beside that run, not in a file somewhere else that can be edited
        //afterwards — read six weeks later, a path proves nothing about what the
        //worker was actually told, and the whole point of keeping a run record is
        //that it cannot drift.
        var rules = it.contract ? dir + '/contract.md' : null;

        var out = [];

        out.push('set -u');
        out.push('mkdir -p ' + dir);

        //WHICHEVER RUN IS THE ONE HAPPENING NOW, under a name that does not
        //change.
        //
        //A run's directory is named after the run, which is right for the record
        //and useless for watching: something that wants to SEE the work has to
        //know an id that did not exist a moment ago, and has to be told again for
        //the next one.
        //
        //So the box gets a link, moved at the start of every run, and one watcher
        //beside it that follows THROUGH the link. A terminal opened on this
        //machine at any moment shows whatever it is doing now, and goes on
        //showing the next thing.
        out.push('ln -sfn ' + dir + ' ' + RUNS + '/current');
        out.push(watcher.watcherFor(RUNS, RUNS + '/current/out.log'));

        out.push('cd ' + q(it.folder) + ' 2>/dev/null || cd "$HOME"');

        //THE TASK AS WRITTEN, BYTE FOR BYTE, so what was asked can be read back
        //later rather than reconstructed from a command line.
        out.push(heredoc(dir + '/task.txt', it.task, 'OKC_TASK_EOF'));

        if (rules) {
            out.push('# The rules this run was given, kept with it.');
            out.push(heredoc(rules, it.contract, 'OKC_CONTRACT_EOF'));
        }

        //ONLY A SHELL RUN SKIPS THIS, AND A JOB DOES NOT.
        //
        //A job is node rather than a worker, so it looks like it should be
        //exempt — and it is not: ./guest/job-api.js hands a job `claude()`, which
        //runs `claude -p` on this machine. Exempting jobs was tried while porting
        //this and caught by diffing against the app it came from; the failure it
        //would have produced is a job that dispatches cleanly and dies at
        //whatever line first asks for a worker, minutes in.
        //
        //A shell run genuinely has no worker in it — that is what it is for.
        if (!it.shell) {
            out.push('if ! command -v claude >/dev/null 2>&1; then');
            out.push('  echo "okc: claude is not installed on this machine, so it cannot be given work"');
            out.push('  exit 1');
            out.push('fi');
        }

        if (it.base) out.push(theWayBack(dir, it.base, !!it.judging));
        if (it.job) out.push(theJob(dir, it));

        //---- what actually runs ------------------------------------------
        //
        //WRITTEN TO A FILE AND RUN, rather than passed to `bash -c`.
        //
        //It was `bash -c` once, and every dispatch it produced died instantly
        //without leaving so much as an empty out.log. A shell-quoted path is
        //wrapped in single quotes, and putting one inside a single-quoted -c
        //argument ENDS that argument — so the command bash actually received was
        //`cd`, with the rest arriving as positional parameters. A folder without
        //spaces reassembled by accident and hid it; the first folder with a space
        //in it did not.
        //
        //A file has no such layer: written once, verbatim, by a heredoc whose
        //delimiter is quoted so nothing here expands. It is also the honest
        //record of what ran, sitting beside the task and the output.
        //
        //AND IT GOES THROUGH THE SAME GUARDED heredoc AS EVERYTHING ELSE. The
        //version this comes from wrote this one inline — the only heredoc in the
        //file without the marker check — so a value reaching it that contained a
        //line reading OKC_RUN_EOF would have ended the file early and run the
        //rest as shell. Nothing put user prose in here, which is why it never
        //bit; "nothing does today" is not the same as a check.
        out.push(heredoc(dir + '/run.sh', runSh(dir, it, rules), 'OKC_RUN_EOF'));

        //DETACHED WITH nohup AND ITS OWN SESSION, so the run outlives the
        //connection that started it — the channel is how it was asked, not what
        //holds it up. `setsid` is also what puts the worker and everything it
        //spawns in one process group, which is what ../dispatch/runs.js `stop`
        //relies on.
        out.push('nohup setsid bash ' + dir + '/run.sh > /dev/null 2>&1 &');

        //RECORDED IMMEDIATELY, so a run that dies in its first second is still a
        //run that happened rather than a directory nobody can account for.
        out.push('date -u +%Y-%m-%dT%H:%M:%SZ > ' + dir + '/started');
        out.push('echo okc-dispatched ' + id);

        return out.join('\n');
    }

    //---- handing something back, and saying what it is doing ---------------
    //
    //A BRANCH IS THE ARTIFACT FOR ANYTHING THAT IS SOURCE, and the better one.
    //This is for what a branch cannot hold: a built binary, an archive — the
    //thing that was the POINT of the task, whose source is only how it got made.
    //
    //IT HAS TO HAPPEN FROM INSIDE THE RUN, because the machine goes back to its
    //base snapshot when the work ends. A file left on the disk did not survive; a
    //file handed over did. So these are put on PATH for the run and a task can
    //simply call them, without knowing a URL, a port, or where on the host
    //anything lands.
    //
    //THE CREDENTIAL IS THE MACHINE'S OWN TOKEN, which is exactly what it already
    //uses to push commits — git replays it from the remote URL on every push.
    //This adds no exposure that pushing did not already have.
    function theWayBack(dir, base, judging) {
        var lines = [];

        lines.push(heredoc(dir + '/okc-artifact', [
            '#!/bin/sh',
            '# okc-artifact <file> [name] -- hand a file to the dashboard, where it is kept',
            '# against the task this run belongs to.',
            'set -eu',
            '[ $# -ge 1 ] || { echo "usage: okc-artifact <file> [name]" >&2; exit 2; }',
            '[ -f "$1" ] || { echo "okc-artifact: no such file: $1" >&2; exit 1; }',
            'exec curl -fsS --cacert "${OKC_CA:-/etc/okc/ca.pem}" \\',
            '  -u "${OKC_VM}:${OKC_TOKEN}" \\',
            '  -X POST --data-binary @"$1" \\',
            '  "' + base + '/artifact?vm=${OKC_VM}&name=${2:-$(basename "$1")}"',
            ''
        ].join('\n'), 'OKC_ART_EOF'));
        lines.push('chmod +x ' + dir + '/okc-artifact');

        //SAYING WHAT IT IS DOING, WHILE IT IS DOING IT.
        //
        //A worker that thinks for twenty minutes is invisible: the machine is on,
        //the run is "running", and the person watching has a spinner. The job API
        //has had log and report since jobs existed — but a plain task's worker is
        //not a job and had no way to say anything at all until its run ended.
        //
        //BEST EFFORT, ALWAYS EXITS 0. A line that could not be delivered must
        //never fail the work it was describing.
        lines.push(heredoc(dir + '/okc-say', [
            '#!/bin/sh',
            "# okc-say <text> -- put a line in the dashboard's live log, tagged with this",
            '# machine. Never fails the caller.',
            '[ $# -ge 1 ] || { echo "usage: okc-say <text>" >&2; exit 2; }',
            'curl -fsS --get --cacert "${OKC_CA:-/etc/okc/ca.pem}" \\',
            '  -u "${OKC_VM}:${OKC_TOKEN}" \\',
            '  --data-urlencode "vm=${OKC_VM}" \\',
            '  --data-urlencode "text=$*" \\',
            '  "' + base + '/provision/say" >/dev/null 2>&1 || true',
            'exit 0',
            ''
        ].join('\n'), 'OKC_SAY_EOF'));
        lines.push('chmod +x ' + dir + '/okc-say');

        //AND A WAY TO STAND BEHIND IT AND WATCH — see ./watcher.js.
        //
        //The run log is FOLLOWED rather than summarised, because the question
        //this answers is "is it doing anything", which a status field cannot
        //answer and a finished report answers too late. Dispatch asks claude for
        //stream-json for exactly this reason; without a reader the file is
        //correct and unreadable.
        lines.push(watcher.watcherFor(dir, dir + '/out.log'));

        //AND THE SKILL THAT SAYS WHAT ANY OF THIS IS.
        //
        //FETCHED AT DISPATCH rather than installed when the machine was
        //provisioned, for the same reason the supervisor's is re-fetched on every
        //wake: a machine built last month would otherwise be working to last
        //month's rules, and the failure is a worker doing something this host
        //stopped wanting weeks ago.
        //
        //Best effort. A worker with no skill is a worker that has to be told
        //everything in its brief — which is where this project started, and is
        //survivable.
        //
        //---- AND WHICH ONE DEPENDS ON WHAT THE MACHINE IS BEING ASKED TO DO ---
        //
        //ONE FILE WENT TO BOTH, AND IT IS A WORKER'S. It opens with "your branch
        //is the deliverable — commit to it and push it", and a judge may not push
        //at all: it reads a branch somebody else wrote and hands back a verdict.
        //So a judge was being told, in the one document that says what it is, to
        //do the single thing this host refuses it.
        //
        //THE REFUSAL CAUGHT IT, which is the only reason this was survivable and
        //is not a reason to leave it: a guard turning away a bad instruction
        //costs a judge turns and teaches it nothing about what it should have
        //done instead.
        //
        //AND THE TWO DELIVERABLES ARE EXACTLY INVERTED. A worker's is the branch
        //and `okc-artifact` is the footnote for what a branch cannot hold; a
        //judge's IS the artifact — see ../../queue/onejudgement.js, which reads
        //what it concluded out of what was handed back — and the branch is
        //somebody else's work that it must not touch. One document cannot lead
        //with both.
        //
        //THE MACHINE IS THE SAME MACHINE. This is about the WORK, not about the
        //tags it carries — `beta-worker1` is tagged both, and does both.
        var skill = judging ? 'judge-skill.md' : 'runner-skill.md';

        lines.push('mkdir -p "$HOME/.claude/skills/working-here"');
        lines.push('curl -fsS --cacert "${OKC_CA:-/etc/okc/ca.pem}" -u "${OKC_VM}:${OKC_TOKEN}" \\');
        lines.push('  -o "$HOME/.claude/skills/working-here/SKILL.md" \\');
        lines.push('  "' + base + '/provision/' + skill + '?vm=${OKC_VM}" 2>/dev/null || true');

        return lines.join('\n');
    }

    //---- a job's own API, and the three lines that start it ------------------
    //
    //Both are real files — see ./payloads.js — read at dispatch and written here.
    //They are code that runs somewhere consequential, and code that cannot be
    //opened by an editor or checked for syntax is code that gets read less
    //carefully than it deserves.
    //
    //THE CREDENTIAL IS A FILE. The note at the top of this file is about exactly
    //that: env is what a transcript dumps, and the output of a run is captured
    //here and kept. It is the token belonging to this machine, the one already
    //written into its git remotes, so this adds no exposure that pushing did not
    //already have.
    function theJob(dir, it) {
        return [
            'umask 077',
            heredoc(dir + '/auth', String(it.vm) + ':' + String(it.token), 'OKC_AUTH_EOF'),
            heredoc(dir + '/prompt.txt', it.prompt ? it.prompt.text : '', 'OKC_PROMPT_EOF'),
            heredoc(dir + '/job.js', it.job, 'OKC_JOB_EOF'),
            heredoc(dir + '/api.js', payloads.api(), 'OKC_API_EOF'),
            heredoc(dir + '/run-job.js', payloads.runner(), 'OKC_RUNNER_EOF')
        ].join('\n');
    }

    //---- the file the run actually is ----------------------------------------
    function runSh(dir, it, rules) {
        var lines = [];

        //ITS OWN PID, FIRST, so a run that dies can be told from one still going.
        //Without it a run that was killed reads as "running" forever, because the
        //status file it would have written is exactly what never got written.
        lines.push('# Its own pid, first, so a run that dies can be told from one still going.');
        lines.push('echo $$ > ' + dir + '/pid');
        lines.push('cd ' + q(it.folder) + ' 2>/dev/null || cd "$HOME"');

        //THE RUN'S OWN DIRECTORY FIRST, so "okc-artifact" is a command a task can
        //call rather than a path it has to be told.
        lines.push('PATH=' + dir + ':$PATH');
        lines.push('export PATH');

        if (it.job) {
            //THE PROMPT TEXT IS A FILE BESIDE THE SCRIPT rather than an
            //environment variable: a prompt is prose, and prose in an environment
            //is one newline away from being unreadable — and env is exactly what
            //a transcript dumps.
            lines.push('OKC_FOLDER=' + q(it.folder));
            lines.push('export OKC_FOLDER');
            lines.push('OKC_BASE=' + q(it.base || ''));
            lines.push('OKC_RUN=' + q(it.id));
            lines.push('export OKC_BASE OKC_RUN');

            if (it.prompt) {
                lines.push('OKC_PROMPT_ID=' + q(it.prompt.id));
                lines.push('OKC_PROMPT_NAME=' + q(it.prompt.name || it.prompt.id));
                lines.push('export OKC_PROMPT_ID OKC_PROMPT_NAME');
            }

            //THE RULES THAT PROMPT RUNS UNDER. The TEXT is already written beside
            //this as contract.md, by the same heredoc a task's contract goes
            //through — these only say WHICH contract it was, so a job can report
            //it by name.
            if (it.contractId) {
                lines.push('OKC_CONTRACT_ID=' + q(it.contractId));
                lines.push('OKC_CONTRACT_NAME=' + q(it.contractName || it.contractId));
                lines.push('export OKC_CONTRACT_ID OKC_CONTRACT_NAME');
            }
        }

        lines.push(theCommand(dir, it, rules) + ' > ' + dir + '/out.log 2>&1');
        lines.push('echo $? > ' + dir + '/status');

        return lines.join('\n');
    }

    //STREAMED, RATHER THAN ONE BLOB AT THE END.
    //
    //`--output-format json` writes a single object when the worker finishes, so
    //out.log is empty for the whole run and then complete. Nothing can be
    //watched: a twenty-minute worker is a file of zero bytes and a machine that
    //is on.
    //
    //`stream-json` writes one event per line as they happen — which makes
    //`tail -f` on this file the live view of a worker thinking, and costs nothing
    //else. `--verbose` is required alongside it when running with -p.
    //
    //`--dangerously-skip-permissions` IS THE POINT RATHER THAN A SHORTCUT. A
    //worker that stops to ask cannot run unattended, and asking is exactly what
    //nobody is there for. It is defensible HERE and would not be anywhere else:
    //this machine cannot reach the dashboard's actions at all, may push one
    //branch and no other, cannot touch a default branch, cannot rewrite or delete
    //what it has pushed, and is thrown away when the work is done.
    function theCommand(dir, it, rules) {
        if (it.job) return 'node ' + dir + '/run-job.js';
        if (it.shell) return 'bash ' + dir + '/task.txt';

        //THE TASK IS READ FROM THE FILE AT RUN TIME rather than put on the
        //command line, so its length and its contents are the file's problem
        //rather than the shell's.
        return 'claude -p "$(cat ' + dir + '/task.txt)"'
            + ' --dangerously-skip-permissions --output-format stream-json --verbose'
            + (rules ? ' --append-system-prompt-file ' + rules : '')
            + (it.resume ? ' --resume ' + q(it.resume) : '');
    }

    return { script: build };
};
