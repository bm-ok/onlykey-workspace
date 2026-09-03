const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeScript = require('../../src/app/vms/dispatch/script');
const makeWatcher = require('../../src/app/vms/dispatch/watcher');

//---------------------------------------------------------------------------
//GIVING A MACHINE A TASK, AND LETTING GO OF IT.
//
//THE CLAIM WORTH THE MOST: no credential is ever put in the environment. The
//output of a run is captured to this host and KEPT, so a credential reaching
//agent-visible output — an env dump, a stack trace — is copied out and filed by
//design. The machine's token goes to a FILE, under umask 077.
//
//AND THE SECOND: everything a person or another agent wrote goes through a
//guarded heredoc. A task with a line reading like a marker would otherwise end
//the file early and have the rest run as shell — not an error, a different
//program.
//---------------------------------------------------------------------------

let SH = null;
for (const p of ['/usr/bin/sh', '/bin/sh', 'C:/Program Files/Git/usr/bin/sh.exe']) {
    try { if (fs.existsSync(p)) { SH = p; break; } } catch (e) { /* keep looking */ }
}

let build;

beforeEach(() => {
    const payloads = { api: () => '//the job api\n', runner: () => '//the runner\n', watch: () => '//the watcher\n' };
    build = makeScript({ payloads, watcher: makeWatcher({ payloads }) }).script;
});

const SPEC = {
    id: 'run-2026-08-22T04-08-57',
    task: 'do the thing',
    folder: '/home/okc/work',
    vm: 'runner1',
    token: 'a-real-token',
    base: 'https://192.168.51.63:7317'
};

const of = (over) => build(Object.assign({}, SPEC, over || {}));

//---- the credential --------------------------------------------------------

test('the token never appears as an environment assignment', () => {
    const s = of({ job: 'console.log(1)', prompt: { id: 'p1', name: 'one', text: 'hi' } });

    //ENV IS WHAT A TRANSCRIPT DUMPS, and the output of a run is captured here
    //and kept. This is the interaction the header of the source is about.
    for (const line of s.split('\n')) {
        if (/^\s*(export\s+)?[A-Z_]+=/.test(line)) {
            assert.equal(line.includes('a-real-token'), false, 'the token is in the environment: ' + line);
        }
    }
    assert.equal(s.includes('OKC_TOKEN=a-real-token'), false, s);
});

test('it goes to a file instead, and the file is private before it is written', () => {
    const s = of({ job: 'x' });

    const umask = s.indexOf('umask 077');
    const auth = s.indexOf('/auth <<');
    assert.ok(umask >= 0, 'nothing narrows the permissions: ' + s);
    assert.ok(umask < auth, 'the credential is written before the umask that protects it');
    assert.match(s, /runner1:a-real-token/);
});

test('a run with no job is handed no credential at all', () => {
    const s = of({});
    assert.equal(s.indexOf('a-real-token'), -1, s);
    assert.equal(s.indexOf('/auth <<'), -1, s);
});

//---- everything somebody else wrote goes through a guarded heredoc ------------

test('the task is written byte for byte, not put on a command line', () => {
    const task = 'do the thing\nwith $HOME and `backticks` and \'quotes\'';
    const s = of({ task });

    assert.ok(s.includes("cat > $HOME/.okc-runs/run-2026-08-22T04-08-57/task.txt <<'OKC_TASK_EOF'"), s);
    assert.ok(s.includes(task), 'the task was altered on the way to the machine');

    //READ FROM THE FILE AT RUN TIME, so its length and contents are the file's
    //problem rather than the shell's.
    assert.match(s, /claude -p "\$\(cat \$HOME\/\.okc-runs\/run-2026-08-22T04-08-57\/task\.txt\)"/);
});

test('a task containing a marker line is refused rather than ending the file early', () => {
    //NOT AN ERROR, A DIFFERENT PROGRAM. Everything after the marker would be
    //executed as shell.
    assert.throws(() => of({ task: 'step one\nOKC_TASK_EOF\nrm -rf /' }),
        /reading exactly "OKC_TASK_EOF"/);
});

test('a contract containing a marker line is refused too', () => {
    assert.throws(() => of({ contract: 'a\nOKC_CONTRACT_EOF\nb' }),
        /reading exactly "OKC_CONTRACT_EOF"/);
});

test('and so is a job, and a prompt', () => {
    assert.throws(() => of({ job: 'a\nOKC_JOB_EOF\nb' }), /reading exactly "OKC_JOB_EOF"/);
    assert.throws(() => of({ job: 'x', prompt: { id: 'p', text: 'a\nOKC_PROMPT_EOF\nb' } }),
        /reading exactly "OKC_PROMPT_EOF"/);
});

test('the run script itself goes through the same guard as everything else', () => {
    //THE ONE HEREDOC THE VERSION THIS COMES FROM WROTE INLINE, without the
    //marker check. Nothing put user prose in it, which is why it never bit —
    //"nothing does today" is not the same as a check.
    const s = of({});
    assert.ok(s.includes("cat > $HOME/.okc-runs/run-2026-08-22T04-08-57/run.sh <<'OKC_RUN_EOF'"), s);

    //A folder is the value most likely to carry something strange, and it is the
    //one that lands inside run.sh.
    assert.throws(() => of({ folder: "/home/okc/a\nOKC_RUN_EOF\nrm -rf /" }),
        /reading exactly "OKC_RUN_EOF"/);
});

//---- the three kinds -----------------------------------------------------------

test('a brief goes to a worker, streamed so it can be watched', () => {
    const s = of({});
    //`--output-format json` WRITES ONE OBJECT AT THE END, so out.log is empty
    //for the whole run and then complete: a twenty-minute worker is a file of
    //zero bytes and a machine that is on.
    assert.match(s, /--output-format stream-json/);
    assert.match(s, /--verbose/);
    assert.match(s, /--dangerously-skip-permissions/);
});

test('a shell run is the same machinery with a command in place of a worker', () => {
    const s = of({ shell: true });

    assert.match(s, /bash \$HOME\/\.okc-runs\/run-2026-08-22T04-08-57\/task\.txt/);
    assert.equal(s.indexOf('claude -p'), -1, s);
    //SAME DIRECTORY, SAME PID FILE, SAME STATUS, SAME DETACHMENT — so what it
    //proves about the machinery is what a worker would have proved.
    assert.match(s, /echo \$\$ > .*\/pid/);
    assert.match(s, /echo \$\? > .*\/status/);
    assert.match(s, /nohup setsid bash /);
});

test('a job runs node, and still needs a worker on the machine', () => {
    const s = of({ job: 'console.log(1)' });

    assert.match(s, /node \$HOME\/\.okc-runs\/run-2026-08-22T04-08-57\/run-job\.js/);

    //A JOB LOOKS LIKE IT SHOULD BE EXEMPT AND IS NOT. ../../src/app/vms/dispatch/
    //guest/job-api.js hands a job `claude()`, which runs `claude -p` on this
    //machine — so a job dispatched to a machine without one dies at whatever
    //line first asks for a worker, minutes in.
    assert.match(s, /command -v claude/);
});

test('a shell run is not asked for claude either', () => {
    assert.equal(of({ shell: true }).indexOf('command -v claude'), -1);
});

test('and a brief is refused up front on a machine with no worker', () => {
    //BETTER THAN A RUN THAT STARTS, WRITES NOTHING AND EXITS 127 twenty minutes
    //into somebody waiting for it.
    const s = of({});
    assert.match(s, /command -v claude/);
    assert.match(s, /claude is not installed on this machine/);
});

test('a run cannot be two kinds at once', () => {
    //THE MACHINERY IS IDENTICAL, so nothing downstream would disagree — the run
    //would simply do one thing and be recorded as another.
    assert.throws(() => of({ job: 'x', shell: true }), /not job and shell at once/);
});

//---- the record ------------------------------------------------------------------

test('the run is detached, in its own session, so it outlives the connection', () => {
    const s = of({});
    //THE CHANNEL IS HOW IT WAS ASKED, NOT WHAT HOLDS IT UP. setsid is also what
    //puts the worker and everything it spawns in one process group, which is
    //what `stop` relies on.
    assert.match(s, /nohup setsid bash .*\/run\.sh > \/dev\/null 2>&1 &/);
});

test('it is recorded as started immediately, and says which run it was', () => {
    const s = of({});
    //A RUN THAT DIES IN ITS FIRST SECOND is still a run that happened rather
    //than a directory nobody can account for.
    assert.match(s, /date -u \+%Y-%m-%dT%H:%M:%SZ > .*\/started/);
    assert.match(s, /echo okc-dispatched run-2026-08-22T04-08-57/);
});

test('the current link is moved so a watcher can follow the next run too', () => {
    const s = of({});
    //SOMETHING THAT WANTS TO SEE THE WORK would otherwise have to know an id
    //that did not exist a moment ago, and be told again for the next one.
    assert.match(s, /ln -sfn \$HOME\/\.okc-runs\/run-2026-08-22T04-08-57 \$HOME\/\.okc-runs\/current/);
    assert.ok(s.includes('$HOME/.okc-runs/current/out.log'), s);
});

test('an id that is not an id is refused before any of it is built', () => {
    assert.throws(() => of({ id: '../../etc' }), /is not a run id/);
});

//---- the contract ------------------------------------------------------------------

test('the contract is carried, not referenced', () => {
    const s = of({ contract: '# rules\nbe careful' });

    //A PATH PROVES NOTHING about what the worker was told, read six weeks later.
    assert.ok(s.includes("contract.md <<'OKC_CONTRACT_EOF'"), s);
    assert.ok(s.includes('be careful'), s);
    assert.match(s, /--append-system-prompt-file \$HOME\/\.okc-runs\/run-2026-08-22T04-08-57\/contract\.md/);
});

test('with no contract there is no flag pointing at a file that was never written', () => {
    const s = of({});
    assert.equal(s.indexOf('--append-system-prompt-file'), -1, s);
    assert.equal(s.indexOf('contract.md'), -1, s);
});

//---- the way back ---------------------------------------------------------------------

test('a task can hand a file back without knowing a url or a port', () => {
    const s = of({});
    //THE MACHINE GOES BACK TO ITS BASE SNAPSHOT when the work ends: a file left
    //on the disk did not survive, a file handed over did.
    assert.ok(s.includes("okc-artifact <<'OKC_ART_EOF'"), s);
    assert.match(s, /chmod \+x .*\/okc-artifact/);
    //ON PATH FOR THE RUN, so it is a command rather than a path to be told.
    assert.match(s, /PATH=\$HOME\/\.okc-runs\/run-2026-08-22T04-08-57:\$PATH/);
});

test('and can say what it is doing without being able to fail its own work', () => {
    const s = of({});
    assert.ok(s.includes("okc-say <<'OKC_SAY_EOF'"), s);
    //BEST EFFORT, ALWAYS EXITS 0. A line that could not be delivered must never
    //fail the work it was describing.
    assert.match(s, />\/dev\/null 2>&1 \|\| true\nexit 0/);
    //AND IT IS RUNNABLE, which nothing asked. `okc-artifact` is checked for its
    //`chmod` in the test above and `okc-watch` in ../vms/dispatch-payloads; this
    //one was written, put on PATH, and never made executable as far as any check
    //here was concerned. The source does it — the gap was the asking.
    assert.match(s, /chmod \+x .*\/okc-say/, 'okc-say is written and never made executable, so calling it fails on the machine');
});

//---------------------------------------------------------------------------
//AND BOTH OF THEM AUTHENTICATE AS THE MACHINE, WHICH IS THE POSITIVE HALF.
//
//The credential checks at the top of this file are all NEGATIVE — the Claude
//token is not in the environment, not on a command line, not present at all when
//there is no job. Every one of them passes just as happily if the two commands
//that talk to this host carry no credential whatsoever and simply fail on the
//guest, twenty minutes in, saying 401.
//
//WHAT THEY USE IS THE MACHINE'S OWN TOKEN, read from the agent's environment at
//the moment of the call — the same identity git already replays on every push,
//and the reason a run's artifacts can be filed against the machine that sent
//them rather than trusted because they arrived.
//
//THIS WAS ASKED IN THE APP THIS IS PORTED FROM and stopped being asked here —
//see ../../src/app/tests/suites/08-a-task-on-a-machine/README.md, which records
//where the rest of that drill went.
//---------------------------------------------------------------------------
test('the two commands that reach this host authenticate as the machine', () => {
    const s = of({});
    for (const cmd of ['okc-artifact', 'okc-say']) {
        const at = s.indexOf('/' + cmd + " <<'");
        assert.ok(at >= 0, cmd + ' is not written into the run at all');
        //FROM THE END OF THE OPENING LINE, because the opener names the marker
        //too — slicing to the first `_EOF` after it finds the opener's own and
        //leaves a body four characters long, which matches nothing and reads as
        //a missing credential.
        const from = s.indexOf('\n', at) + 1;
        const body = s.slice(from, s.indexOf('_EOF', from));
        assert.match(body, /-u "\$\{OKC_VM\}:\$\{OKC_TOKEN\}"/,
            cmd + ' does not authenticate as the machine, so this host cannot tell who sent what');
    }
});

test('nothing is handed back when there is nowhere to hand it to', () => {
    const s = of({ base: null });
    assert.equal(s.indexOf('okc-artifact'), -1, s);
    assert.equal(s.indexOf('okc-say'), -1, s);
});

test('the skill is fetched at dispatch rather than baked in when the machine was built', () => {
    //A MACHINE BUILT LAST MONTH would otherwise be working to last month's
    //rules, and the failure is a worker doing something this host stopped
    //wanting weeks ago.
    assert.match(of({}), /worker-skill.md\?vm=\$\{OKC_VM\}/);
    assert.match(of({}), /\|\| true/);
});

//---- and it is shell -------------------------------------------------------------------

test('everything it produces parses as shell', { skip: SH ? false : 'no sh on this host' }, () => {
    //A QUOTING MISTAKE HERE PRODUCES A DIFFERENT PROGRAM, not an error — so the
    //thing that will read it is what gets asked whether it can.
    const cases = [
        {},
        { shell: true },
        { job: 'console.log(1)', prompt: { id: 'p', name: 'n', text: 'hi' }, contractId: 'c1', contractName: 'C' },
        { contract: '# rules' },
        { resume: 'sess-1' },
        { base: null },
        { folder: "/home/okc/a folder with spaces and 'quotes'" },
        { task: "a task with $HOME, `id`, 'quotes' and \"doubles\"" }
    ];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-script-'));
    cases.forEach((over, i) => {
        const file = path.join(dir, 'case-' + i + '.sh');
        fs.writeFileSync(file, of(over));
        assert.doesNotThrow(
            () => execFileSync(SH, ['-n', file.split('\\').join('/')], { encoding: 'utf8' }),
            'case ' + i + ' is not valid shell: ' + JSON.stringify(over));
    });
});

test('a folder with a space in it survives, which is the bug that started all this', () => {
    //`bash -c` WAS THE FIRST VERSION and every dispatch died instantly with no
    //out.log at all: a shell-quoted path inside a single-quoted -c argument ENDS
    //that argument, so bash received `cd` with the rest as positional parameters.
    //A folder without spaces reassembled by accident and hid it.
    const s = of({ folder: '/home/okc/my work' });

    //BOTH OF THEM, COUNTED. The folder is changed to twice — once by the
    //dispatch and once inside run.sh — and asserting only that the quoted form
    //appears SOMEWHERE is satisfied by either one alone. Two sabotages walked
    //through this line for exactly that reason, and `sh -n` cannot help:
    //`cd /home/okc/my work` is perfectly valid shell, it is just `cd` with two
    //arguments, landing somewhere nobody asked for.
    const quoted = s.split("cd '/home/okc/my work'").length - 1;
    assert.equal(quoted, 2,
        'the folder is quoted ' + quoted + ' times out of the two places it is used');
    assert.equal(s.indexOf('cd /home/okc/my work'), -1, 'an unquoted folder reached the machine');

    assert.equal(s.indexOf('bash -c'), -1, s);
});

//---- which skill the machine is given --------------------------------------
//
//ONE FILE WENT TO BOTH ROLES AND IT IS A WORKER'S. It opens by telling its
//reader that its branch is the deliverable and to commit and push it, and a
//judge may not push at all — it reads a branch somebody else wrote and hands
//back a judgement. So a judge was being told, in the one document that says
//what it is, to do the single thing this host refuses it.
//
//SURVIVABLE ONLY BECAUSE THE PUSH IS REFUSED BY NAME, which is a guard turning
//away a bad instruction: it costs a judge turns and teaches it nothing about
//what it should have done instead.
//
//ASSERTED ON THE SCRIPT because that is where the choice is made, and it is one
//word in a URL — the shape of thing that is read past in review and cannot be
//seen at all from anywhere else.

test('a worker is given the worker skill', () => {
    const s = of({});
    assert.match(s, /provision\/worker-skill.md/);
    assert.doesNotMatch(s, /judge-skill\.md/);
});

test('a judgement is given the judge skill, and not the worker one', () => {
    const s = of({ judging: true });
    assert.match(s, /provision\/judge-skill\.md/);
    assert.doesNotMatch(s, /worker-skill.md/,
        'a judge was handed the document that tells it to push the branch it is judging');
});

test('either way it lands in the same place, because it is the same slot', () => {
    for (const judging of [false, true]) {
        const s = of({ judging });
        assert.match(s, /-o "\$HOME\/\.claude\/skills\/working-here\/SKILL\.md"/);
    }
});

test('no way back means no skill either, rather than a fetch that cannot work', () => {
    //`base` IS THE HOST'S ADDRESS. Without one there is nothing to fetch from —
    //see ../../src/app/runners/runs/server.js, which leaves it null when the
    //address cannot be worked out, and says the run still runs.
    const s = of({ base: null, judging: true });
    assert.doesNotMatch(s, /judge-skill\.md/);
    assert.doesNotMatch(s, /worker-skill.md/);
});
