var React = require('react');
var { useState, useEffect } = React;

//the Tests tab: this app run against itself, and what the green is worth.
//
//THE QUESTION IT ANSWERS IS NOT "IS IT GREEN". It is "what has actually been
//established about this host right now, and what does the green mean" — and
//neither half has a yes/no answer, which is why this is three columns of
//evidence rather than a runner readout.
//
//WHAT IS PROVEN, WHAT WAS MERELY NOT TRIED, AND WHAT NOBODY HAS WRITTEN YET are
//three different things and the pane keeps them apart. Live right now: 298
//checks across 12 suites and 64 tests — 201 passed, 74 that could not be tried,
//18 drafts, 5 changed, zero failed. Flattening "not tried" into failure would
//report 74 red on a system where nothing is wrong: these drills want a machine
//on, a credential lent, a branch claimed, and this app's whole design puts
//machines at rest. Resting is the normal state, so red here would train
//somebody to ignore the red.
//
//AND THE WIDEST COLUMN IS CODE, NOT OUTPUT. Each check's source rides on the
//wire — 6,025 lines of it in the current payload — because reading the check IS
//the value of the tick. Same rule as a job showing its script before it is
//approved.
//
//WHAT THE OLD PANE GOT WRONG AND THIS DOES NOT:
//
//  its worstOf() was dead code. The server always sets suite.state, and the
//  server's own worst() only knows failed/unrunnable/passed/not run — so
//  'changed', 'draft', 'needs you', 'carried', 'running' and 'interrupted'
//  could never reach a suite or test badge and collapsed to "not run". Live,
//  "what this host has" reads NOT RUN while its checks read passed, passed,
//  passed, changed. Here the badge is the WORSE of what the server says and
//  what the checks say, so the server's own stronger verdicts (a suite
//  contradicted by somebody else's check) still win and the states it cannot
//  express stop disappearing.
//
//  its suite count badges were computed from TEST states, so drafts and
//  needs-you were invisible one level up: "a worker credential" holds 18 drafts
//  and its card showed none. Counted from checks here.
//
//  suite.ranWhole was on the wire and drawn nowhere, so now that results outlive
//  the window a suite that passed four days ago and one that passed four minutes
//  ago looked identical.
//
//  check.note was on the wire and drawn nowhere. For a draft the note IS the
//  check — 800 to 1,600 characters of "WHAT IT WOULD BUY / THE STICKING POINT /
//  THE CHECK", kept up to date as reality moves ahead of the draft — and it was
//  reachable only by unfolding something labelled "the code it runs".

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono, Button, Skeleton} = theme;

    //RUNNING THE DRILLS IS A PERSON'S PRESS, and every button here starts one.
    //
    //A drill is an ATTEMPT TO DO THE WRONG THING — it writes a task on a branch
    //cut, takes the worker credential off a machine, proves a signed-out machine
    //is refused work, and puts it back. It drives real machines with real
    //credentials, and if a guard has already stopped working then the thing that
    //guard was stopping happens for real, in this workspace.
    //
    //So these are proposed as guarded: visible from the command line, refused
    //from it. The person who wants to spend that time is the person who presses
    //it. Turn any of them off in Settings -> Guards.

    //WHERE A PERSON WAS LOOKING lives in ../remember now, and this pane is why
    //that plugin has a test guarding it. This file had grown its own copy of the
    //old window's `been` -- same idea, same `okc.` prefix, written in good faith
    //for something small -- which is a second place for the rule about what may
    //be kept in browser storage to be broken. The rule is only worth having if
    //there is one.

    //Local rather than imported: over in ui/ this lived in machines.js and every
    //other pane reached across for it, which is what made the load order of a
    //fifteen-file directory load-bearing. A tab here declares three services and
    //carries its own six lines.
    function ago(when) {
        var secs = Math.max(0, Math.round((Date.now() - Date.parse(when)) / 1000));
        var n, unit;
        if (secs < 90) { n = secs; unit = 'second'; }
        else if (secs < 5400) { n = Math.round(secs / 60); unit = 'minute'; }
        else if (secs < 172800) { n = Math.round(secs / 3600); unit = 'hour'; }
        else { n = Math.round(secs / 86400); unit = 'day'; }
        return n + ' ' + unit + (n === 1 ? '' : 's') + ' ago';
    }

    //---- what a state looks like, and what it is worth -----------------------
    //
    //TEN STATES, AND ONLY ONE OF THEM IS GREEN. Everything below `passed` is an
    //honest answer rather than a verdict, and the colours say which kind:
    //
    //  not tried    a precondition was missing. Amber, and worded as a fact
    //               about the moment rather than about the code.
    //  needs you    a job for a person. No amount of running changes it, so it
    //               reads the same on every run until somebody does it.
    //  changed      it passed once and the check has been EDITED since, so what
    //               it did then says nothing about what it does now.
    //  carried      not run this time; taken on trust so a resumed series could
    //               go on. Never green — nothing was proved.
    //  interrupted  it was running when the dashboard went away.
    //  draft        not an outcome at all. Something somebody meant to write,
    //               counted apart, and muted so it can never read as a fault.
    var LOOK = {
        passed: { kind: 'ok', word: 'passed' },
        failed: { kind: 'bad', word: 'failed' },
        unrunnable: { kind: 'warn', word: 'not tried' },
        'asks you': { kind: 'warn', word: 'needs you' },
        changed: { kind: 'warn', word: 'check changed' },
        interrupted: { kind: 'warn', word: 'interrupted' },
        //the app's existing blue for "in flight" — the same one the runners, the
        //PR cuts and the repositories use. A colour invented here would say the
        //same thing in a different language.
        running: { kind: 'run', word: 'running' },
        carried: { kind: 'muted', word: 'carried' },
        draft: { kind: 'muted', word: 'draft' },
        'not run': { kind: 'muted', word: 'not run' }
    };
    function look(s) { return LOOK[s] || { kind: 'muted', word: String(s || 'not run') }; }

    function State({ state }) {
        var l = look(state);
        return <Badge kind={l.kind}>{l.word}</Badge>;
    }

    //Worst first. An aggregate that averages away one failure hides the only
    //line worth reading — and `running` outranks everything but a failure so
    //that a suite halfway through actually says so instead of reading "not run"
    //because most of its checks have not been reached yet.
    var RANK = ['failed', 'running', 'interrupted', 'asks you', 'changed', 'unrunnable', 'carried', 'passed', 'not run', 'draft'];
    //everything before `passed` is a finding; the three after it are absences.
    var FINDINGS = RANK.indexOf('passed');
    function rank(s) { var i = RANK.indexOf(s); return i < 0 ? RANK.length : i; }
    function worse(a, b) { return rank(a) <= rank(b) ? a : b; }

    function worstOf(states) {
        var found = null;
        states.forEach(function (s) {
            if (rank(s) < FINDINGS && (found === null || rank(s) < rank(found))) found = s;
        });
        if (found) return found;
        //DRAFTS ARE SET ASIDE RATHER THAN COUNTED AGAINST, because a draft is a
        //to-do list entry and a series of eight checks with two drafts in it has
        //not half-failed. What is left decides: all passed is passed, anything
        //short of that is "not run" — a partly-run series must never read green.
        var real = states.filter(function (s) { return s !== 'draft'; });
        if (!real.length) return states.length ? 'draft' : 'not run';
        return real.every(function (s) { return s === 'passed'; }) ? 'passed' : 'not run';
    }

    //THE BADGE ON A CARD IS THE WORSE OF TWO CLAIMS, and both are needed. The
    //server's verdict is not the worst of its checks — a suite reads failed
    //because a check in ANOTHER suite contradicted it, and computing from the
    //checks alone would hide exactly the case that was added for. But the
    //server can only say failed/unrunnable/passed/not run, so computing nothing
    //loses six states. Taking the worse of the two keeps both.
    function verdict(serverState, states) { return worse(serverState || 'not run', worstOf(states)); }

    //Only the counts that are not zero. A row of three zeroes is three things to
    //read past on every suite that is simply fine.
    var COUNTED = ['failed', 'running', 'interrupted', 'asks you', 'changed', 'unrunnable', 'carried', 'passed', 'draft'];
    function Counts({ states }) {
        return (<>
            {COUNTED.map(function (k) {
                var n = states.filter(function (s) { return s === k; }).length;
                if (!n) return null;
                var l = look(k);
                return <Badge key={k} kind={l.kind}>{n + ' ' + l.word}</Badge>;
            })}
        </>);
    }

    function checksOf(suite) {
        return suite.tests.reduce(function (all, t) { return all.concat(t.checks || []); }, []);
    }
    function count(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

    //---- the left column: suites --------------------------------------------

    function Suite({ s, on, onPick, may, onRun }) {
        var checks = checksOf(s);
        var states = checks.map(function (c) { return c.state; });
        var d = s.disprovedBy;
        return (
            <div className={'card pick' + (on ? ' on' : '')} onClick={onPick}>
                <div className="card-title">
                    <span className="grow">{s.name}</span>
                    <State state={verdict(s.state, states)} />
                </div>
                <div className="badges">
                    <span className="muted">{count(s.tests.length, 'test') + ', ' + count(checks.length, 'check')}</span>
                    <Counts states={states} />
                    {/* CONTRADICTED IS STRONGER THAN DIRTY and reads as failed
                        even while every check inside says passed: a machine left
                        un-based by real work is harder evidence than the
                        rehearsal. It survives restarts and clears only by
                        running the suite and passing. Nothing carries it in
                        today's data, which is exactly why it is easy to drop in
                        a port and impossible to notice. */}
                    {d ? <Badge kind="bad">contradicted</Badge> : null}
                    {s.dirty && !d ? <Badge kind="warn">owes a run</Badge> : null}
                    {/* WHEN THE WHOLE THING LAST STOOD UP. Only worth saying
                        because results outlive the window now: a pass from four
                        days ago and one from four minutes ago are both green,
                        and the difference is most of what somebody wants. */}
                    {s.ranWhole ? <span className="muted">{'whole ' + ago(s.ranWhole)}</span> : null}
                    {s.requires && s.requires.length
                        ? <span className="muted">{'stands on ' + s.requires.join(' + ')}</span>
                        : null}
                    <Button kind="small" protect
                        disabled={!may.can}
                        title={may.why || ('Run every test in "' + s.name + '"')}
                        onClick={function (e) { e.stopPropagation(); onRun({ suite: s.name }); }}>Run it</Button>
                </div>
                {d
                    ? <div className="card-sub bad">
                        {'"' + d.check + '" in ' + d.suite + ' failed, which is evidence against this suite'
                            + (d.why ? ': ' + d.why : '') + '. Run this suite again to settle it.'}
                    </div>
                    : null}
                {/* DIRTY IS A DEBT, NOT A COLOUR — the results inside are
                    current and the claim about the whole is not — and it spreads
                    along `requires`. Naming who did it is the difference between
                    a badge and a sentence somebody can act on: "the guards owes
                    a run" says nothing, "because a worker credential was
                    disturbed" says what to run. */}
                {s.dirty && !d
                    ? <div className="card-sub">
                        {s.dirtyBecause && s.dirtyBecause.length
                            ? 'Something it stands on was disturbed: ' + s.dirtyBecause.join(', ') + '. These results were established on top of it.'
                            : 'Part of this suite was run on its own, so the results are current and the claim about the whole suite is not.'}
                    </div>
                    : null}
            </div>
        );
    }

    //---- the middle column: the tests in the picked suite ---------------------

    function TestCard({ t, on, onPick }) {
        var states = (t.checks || []).map(function (c) { return c.state; });
        return (
            <div className={'card pick' + (on ? ' on' : '')} onClick={onPick}>
                <div className="card-title">
                    <span className="grow">{t.name}</span>
                    <State state={verdict(t.state, states)} />
                </div>
                <div className="badges">
                    {/* "3 checks" IS A STATEMENT ABOUT HOW MUCH OF AN ORDER THIS
                        COVERS. A test here is a series: the checks run in the
                        order they are written, they hand things to each other,
                        and one that fails stops the rest. */}
                    <span className="muted">{count((t.checks || []).length, 'check')}</span>
                    <Counts states={states} />
                    {t.ms != null ? <span className="muted">{t.ms + 'ms'}</span> : null}
                    {t.ranWhole ? <span className="muted">{'whole ' + ago(t.ranWhole)}</span> : null}
                    {t.dirty ? <Badge kind="warn">owes a run</Badge> : null}
                </div>
                {t.dirty
                    ? <div className="card-sub">Part of this was run on its own, or a step was carried rather than run. The results are current; the claim about the whole series is not.</div>
                    : null}
            </div>
        );
    }

    //---- the right column: one check of the series ---------------------------

    function Check({ suiteName, testName, c, n, open, onFold, may, onRun }) {
        //THE ONE HAPPENING RIGHT NOW, marked on the card and not only in a
        //badge. A run of eighty checks scrolls, and "which step is it on" is the
        //question somebody has while watching one. `on` is the class this app
        //already uses for "this is the one you are looking at".
        var now = c.state === 'running';
        //A SERIES THAT STOPPED SAYS SO ONCE, AT THE TOP. Fifty of the seventy
        //four not-tried checks live are downstream of one earlier failure, and
        //repeating the paragraph under each of them buries the one that matters.
        var downstream = c.state === 'unrunnable' && /^an earlier step/.test(String(c.why || ''));
        //a draft's why IS its note; showing both would print the same 1,200
        //characters twice.
        var whySeparate = c.why && c.why !== c.note;
        var lines = String(c.source || '').split('\n').length;

        return (
            <div className={'card' + (now ? ' on' : '')} style={{ marginTop: '10px' }}>
                <div className="card-title">
                    {/* the ORDER, which is the thing this level exists to state.
                        Written 1, 2, 3 rather than the file's 00 — the file
                        numbers order the tests, these order the steps. */}
                    <span className="mono muted">{n + '.'}</span>
                    <span className="grow">{c.name}</span>
                    {c.ms != null ? <span className="muted">{c.ms + 'ms'}</span> : null}
                    <State state={c.state} />
                </div>

                {c.at
                    ? <div className="card-sub">
                        {'ran ' + ago(c.at) + (c.fromBefore ? ', before this window was opened' : '')}
                    </div>
                    : null}

                {/* THE DRAFT'S NOTE, ABOVE THE FOLD AND NOT BEHIND IT. This is
                    the most valuable prose in the pane — what the check would
                    buy, what the sticking point is, and what it would actually
                    assert — and in the old pane it was reachable only by
                    unfolding something labelled "the code it runs". */}
                {c.note
                    ? <div style={{ marginTop: '8px' }}>
                        <div className="dlg-heading">{c.draft ? 'what it would prove, and why it is not written yet' : 'what this check is for'}</div>
                        <p className="note" style={{ whiteSpace: 'pre-wrap' }}>{c.note}</p>
                    </div>
                    : null}

                {/* A PRECONDITION THAT WAS NOT MET IS A FACT ABOUT THE MOMENT —
                    nothing is wrong — and it must not be dressed as a failure. */}
                {c.state === 'unrunnable' && !downstream
                    ? <Note kind="warn">
                        <strong>Could not be tried. </strong>
                        {c.why + ' Nothing is wrong with the check or with the code — it asked for something this system does not have right now, which is the ordinary resting state here.'}
                    </Note>
                    : null}
                {downstream ? <p className="note muted">{c.why}</p> : null}

                {c.state === 'asks you' && whySeparate
                    ? <Note kind="warn">
                        <strong>This one is for a person. </strong>
                        {c.why + ' Running it again reports the same thing until somebody does it.'}
                    </Note>
                    : null}

                {c.state === 'changed' && whySeparate ? <Note kind="warn">{c.why}</Note> : null}
                {c.state === 'carried' && whySeparate ? <p className="note muted">{c.why}</p> : null}
                {c.state === 'interrupted' && whySeparate ? <Note kind="warn">{c.why}</Note> : null}

                {c.state === 'failed'
                    ? <div style={{ marginTop: '8px' }}>
                        <div className="dlg-heading">what went wrong</div>
                        <pre className="console short">{String(c.why || 'no message')}</pre>
                    </div>
                    : null}

                {/* THE CODE, FOLDED AWAY UNTIL IT IS WANTED.
                    Reading what a check does is the only way to know what its
                    tick means, which is why the source is carried on the wire at
                    all. But a series is eight or ten of them and a pane that
                    opens on two thousand lines is one nobody scrolls — the
                    result they came to read is below the horizon. So it is a
                    line you click, and it says how much is behind it. Not
                    remembered across windows: opening one is about the check
                    somebody is reading NOW. */}
                <div className="dlg-heading"
                    style={{ marginTop: '8px', cursor: 'pointer', userSelect: 'none' }}
                    title={open ? 'Hide it' : 'Read what this check actually does'}
                    onClick={onFold}>
                    {(open ? '▾ ' : '▸ ') + 'the code it runs — ' + count(lines, 'line')}
                </div>
                {open ? <pre className="console short">{String(c.source || '')}</pre> : null}

                {/* WHAT IT SAID WHILE IT RAN. Half these drills log what they
                    ARRANGED — "taking runner1's credential for the duration, and
                    putting it back afterwards" — and that is most of what a
                    result means: the same green tick is worth different things
                    depending on what the step had to set up to earn it.
                    Absent rather than empty when there has not been a run: an
                    empty box under a heading claims the check said nothing,
                    which is a different claim from "it has not run". */}
                {(c.log || []).length
                    ? <div style={{ marginTop: '8px' }}>
                        <div className="dlg-heading">
                            {/* A CHANGED CHECK'S STORED LOG STILL READS "FAIL
                                ..." while its badge is amber, which is the most
                                confusing pair in the pane unless the heading
                                says whose run it was. */}
                            {c.state === 'changed' ? 'the log from the run that no longer applies' : 'the log'}
                        </div>
                        <pre className="console short">{(c.log || []).join('\n')}</pre>
                    </div>
                    : null}

                <div className="row" style={{ marginTop: '8px' }}>
                    {/* WHAT THE RESULT IS ABOUT, as a number. A remembered
                        result cannot outlive the code it is a statement about,
                        and this is how that is known. */}
                    <span className="muted grow"><Mono>{c.fingerprint}</Mono></span>
                    <Button kind="small" protect
                        disabled={!may.can}
                        //A STEP LIFTED OUT OF ITS SERIES IS NOT THE SERIES. It
                        //runs with nothing the earlier steps arranged, which is
                        //what makes it useful for working on one and what makes
                        //its answer weaker than the test's.
                        title={may.why || 'Runs this step on its own, without the steps before it'}
                        onClick={function () { onRun({ suite: suiteName, test: testName, check: c.name }); }}>
                        Run this check
                    </Button>
                </div>
            </div>
        );
    }

    function Detail({ suite, test, open, onFold, may, onRun }) {
        if (!suite) return <Empty>Pick a suite on the left.</Empty>;
        if (!test) return <Empty>Pick a test.</Empty>;

        var checks = test.checks || [];
        var states = checks.map(function (c) { return c.state; });
        var whole = verdict(test.state, states);
        var stopped = checks.some(function (c) {
            return c.state === 'unrunnable' && /^an earlier step/.test(String(c.why || ''));
        });

        return (<>
            <div className="card-title">
                <span className="grow">{test.name}</span>
                <State state={whole} />
            </div>

            <table className="kv" style={{ marginTop: '8px' }}>
                <tbody>
                    <tr><th>suite</th><td>{suite.name}</td></tr>
                    <tr><th>checks</th><td className="muted">{checks.length + ', in the order below'}</td></tr>
                    <tr><th>took</th><td className="muted">{test.ms != null ? test.ms + 'ms' : 'it has not been run'}</td></tr>
                    <tr><th>whole series</th><td className="muted">{test.ranWhole ? ago(test.ranWhole) : 'never, end to end'}</td></tr>
                </tbody>
            </table>

            {/* SAID ONCE, HERE. The steps below each say "an earlier step did
                not pass", and that is not a sentence somebody needs to read
                three times to learn one thing. */}
            {stopped
                ? <Note kind="warn">
                    <strong>The series stopped. </strong>
                    A check that fails stops the ones after it — the world is in a state nobody described, and a step run against that proves nothing. Read the failure, not the ones below it.
                </Note>
                : null}

            {/* THE GREEN IS A BADGE RATHER THAN A GREEN <strong>, because a
                bare `ok` here would be the quietest failure this stylesheet
                allows: `ok` exists only as a modifier of badge, btn, chip and a
                cell in table.kv, so `<strong class="ok">` inside a paragraph
                matches a class that is real and a rule that draws nothing. The
                pane this is a port of does exactly that, and the sentence it
                means to colour has been plain grey all along. */}
            {whole === 'passed'
                ? <Note>
                    <Badge kind="ok">every check passed</Badge>
                    {' Which means what the code below does, in this order, and nothing more — read it before trusting the tick.'}
                </Note>
                : null}

            {/* RESULTS OUTLIVE THE WINDOW NOW, so the old wording — "none is
                kept across a restart" — was a promise this app stopped keeping.
                What is below may be older than this window, and each check says
                when it ran. */}
            {whole === 'not run'
                ? <p className="note muted">Not run end to end. Anything below with a result is from an earlier run; each check says when.</p>
                : null}

            {whole === 'draft'
                ? <p className="note muted">Every check here is a draft. Nothing has been claimed about this yet — the notes below are what somebody meant to check.</p>
                : null}

            <div className="row" style={{ marginTop: '10px' }}>
                <Button kind="ok" protect
                    disabled={!may.can}
                    title={may.why || 'Runs every check in this test, in order'}
                    onClick={function () { onRun({ suite: suite.name, test: test.name }); }}>Run this test</Button>
                <Button protect
                    disabled={!may.can}
                    title={may.why || ('Runs every test in "' + suite.name + '"')}
                    onClick={function () { onRun({ suite: suite.name }); }}>Run the suite</Button>
            </div>
            <div className="badges">
                <Counts states={states} />
            </div>

            {checks.map(function (c, i) {
                //all three, because a check's name is only unique inside its file
                var key = suite.name + ' / ' + test.name + ' / ' + c.name;
                return <Check key={key}
                    suiteName={suite.name} testName={test.name}
                    c={c} n={i + 1}
                    open={!!open[key]}
                    onFold={function () { onFold(key); }}
                    may={may} onRun={onRun} />;
            })}
        </>);
    }

    //---- the tab -------------------------------------------------------------

    function Tests() {
        //POLLED, AND EXPENSIVE ON PURPOSE. The payload is 570 KB because every
        //check's source rides on it, and `suites` takes no arguments so there is
        //no lighter listing to ask for. What keeps that from being half a
        //megabyte forever is the shell: it mounts one tab at a time, so this
        //hook's interval exists only while somebody is looking at this tab. The
        //old pane needed a hand-written view guard at the top of every paint for
        //the same effect, and forgot it three times.
        //
        //AND LISTING RUNS NOTHING, which is what makes it safe to ask on a
        //cadence at all: some of these drills borrow a machine, and opening a
        //tab is not consent to do that. The action reads the register.
        var { state, error, reads } = okc.use('suites', {}, 5000);

        var [pickedSuite, setPickedSuite] = remember.use('tests', 'suite', null);
        var [pickedTest, setPickedTest] = remember.use('tests', 'test', null);
        var [open, setOpen] = useState({});
        var [busy, setBusy] = useState(false);
        var [said, setSaid] = useState(null);

        var suites = (state && state.suites) || [];

        //RECONCILED AGAINST WHAT IS REGISTERED, like every other selection in
        //this app: a suite renamed between one window and the next is a
        //selection pointing at nothing, which strands the panel exactly the way
        //never having chosen does.
        var suite = null;
        for (var i = 0; i < suites.length; i++) if (suites[i].name === pickedSuite) suite = suites[i];
        if (!suite && suites.length) suite = suites[0];
        var test = null;
        if (suite) {
            for (var j = 0; j < suite.tests.length; j++) if (suite.tests[j].name === pickedTest) test = suite.tests[j];
            if (!test && suite.tests.length) test = suite.tests[0];
        }

        //written back only once the answer has actually moved, so a name in
        //storage cannot outlive the suite it named.
        var suiteName = suite ? suite.name : null;
        var testName = test ? test.name : null;
        useEffect(function () {
            if (suiteName && suiteName !== pickedSuite) setPickedSuite(suiteName);
        }, [suiteName]);
        useEffect(function () {
            if (testName && testName !== pickedTest) setPickedTest(testName);
        }, [testName]);

        var everyCheck = suites.reduce(function (all, s) { return all.concat(checksOf(s)); }, []);
        var failed = everyCheck.filter(function (c) { return c.state === 'failed'; }).length;

        //THE TAB BADGE COUNTS FAILURES AND NOTHING ELSE. Not-tried is the
        //resting state of a quiet host, and a number on the bar that is high
        //when nothing is wrong is a number people stop reading. It lands at the
        //shell's next paint rather than instantly — the shell offers no way to
        //push one, and inventing a channel here for a digit is worse than the
        //lag.
        useEffect(function () { tab.badge = failed ? String(failed) : null; }, [failed]);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        //the server is the authority on whether a run is going; `busy` only
        //covers the seconds between pressing and the next read landing.
        var running = !!state.running || busy;
        var allowed = !!state.allowed;
        //REFUSED IN THE ACTION TOO — this only keeps somebody from having to
        //find that out by pressing, and puts the reason on screen instead of in
        //a complaint they have to trigger.
        var may = !allowed
            ? { can: false, why: state.why || 'The drills are switched off for this folder.' }
            : running
                ? { can: false, why: 'A run is already going' }
                : { can: true, why: null };

        function run(what) {
            setSaid(null);
            setBusy(true);
            okc.call('suiteRun', what).then(
                function (r) { setSaid({ text: r.note, kind: r.failed ? 'bad' : r.unrunnable ? 'warn' : null }); },
                function (e) { setSaid({ text: e.message, kind: 'bad' }); }
            ).then(function () { setBusy(false); });
        }

        //CALLING IT OFF, which had an action and, for a long time, no way to
        //reach it — so the only way out of a half-hour drill was the command
        //line, or killing the app and losing the record with it. It says what it
        //can do rather than implying more: the step in flight finishes on its
        //own clock, because that wait is inside somebody else's promise.
        function stop() {
            okc.call('suiteStop').then(
                function (r) { setSaid({ text: r.note, kind: r.stopping ? 'warn' : null }); },
                function (e) { setSaid({ text: e.message, kind: 'bad' }); }
            );
        }

        function foldCode(key) {
            setOpen(function (was) {
                var next = {};
                for (var k in was) next[k] = was[k];
                if (next[key]) delete next[key]; else next[key] = true;
                return next;
            });
        }

        return (
            <Pane>
                {/* the error above the last good answer, never in place of it */}
                {error ? <Note kind="bad">{error}</Note> : null}

                <div className="titlerow">
                    <div className="card-title grow">
                        {suites.length ? count(suites.length, 'suite') + ', ' + count(everyCheck.length, 'check') : 'no suites'}
                    </div>
                    <Button protect
                        disabled={!may.can}
                        title={may.why || 'Run every check in every suite'}
                        onClick={function () { run({}); }}>Run everything</Button>
                    {/* shown only while there is something to stop. A permanent
                        Stop on a quiet tab is a button that does nothing, which
                        teaches people that buttons here do nothing. */}
                    {running ? <button className="btn danger" onClick={stop}>Stop</button> : null}
                </div>

                {/* THE REASON GOES WHERE THE SUMMARY WOULD BE, not under the
                    board: a tab of greyed-out buttons with the explanation below
                    the results looks broken rather than switched off. Testing
                    mode is per-folder and off by default because these drills
                    write tasks, take credentials off machines and open pull
                    requests. */}
                {allowed
                    ? <p className="note muted">{state.note}</p>
                    : <Note kind="warn">{state.why}</Note>}

                {said ? <Note kind={said.kind || undefined}>{said.text}</Note> : null}

                <div className="cols">
                    <div className="col narrow">
                        <Panel>
                            <div className="card-title">Suites</div>
                            <div className="stack" style={{ marginTop: '8px' }}>
                                {suites.length
                                    ? suites.map(function (s) {
                                        return <Suite key={s.name} s={s}
                                            on={!!suite && s.name === suite.name}
                                            onPick={function () {
                                                setPickedSuite(s.name);
                                                //cleared rather than kept: a test name from
                                                //another folder is a selection pointing at nothing
                                                setPickedTest(null);
                                            }}
                                            may={may} onRun={run} />;
                                    })
                                    : <Empty>No suites are registered. A suite is a folder under test/suites, a test is a numbered file in it, and adding one is all there is to it.</Empty>}
                            </div>
                        </Panel>
                    </div>

                    <div className="col">
                        <Panel>
                            <div className="card-title">{suite ? suite.name : 'Tests'}</div>
                            <div className="stack" style={{ marginTop: '8px' }}>
                                {suite && suite.tests.length
                                    ? suite.tests.map(function (t) {
                                        return <TestCard key={t.name} t={t}
                                            on={!!test && t.name === test.name}
                                            onPick={function () { setPickedTest(t.name); }} />;
                                    })
                                    : <Empty>Pick a suite on the left.</Empty>}
                            </div>
                        </Panel>
                    </div>

                    {/* THE WIDEST COLUMN IS THE CODE. Everything about a step is
                        in one block — its order, its result, what it does and
                        what it said — because the alternative is reading a
                        result in one place and the check for it in another. */}
                    <div className="col wide">
                        <Panel>
                            <Detail suite={suite} test={test} open={open} onFold={foldCode} may={may} onRun={run} />
                        </Panel>
                    </div>
                </div>

                <Note>{'read ' + reads + ' time(s), every 5s · '
                    + count(everyCheck.length, 'check') + ', and every one of their sources arrives on each read, which is why this asks only while it is showing'}</Note>
            </Pane>
        );
    }

    //held rather than passed inline so the badge above has something to write
    //on. The shell reads it when it next paints the bar.
    var tab = { name: 'Test', order: 110, Component: Tests };
    shell.tab(tab);

    await register(null, {});
}
module.exports = plugin;
