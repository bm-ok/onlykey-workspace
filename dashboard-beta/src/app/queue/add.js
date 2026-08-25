var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//Add task: the same form the supervisor fills in, with a person at it.
//
//THE BRANCH IS THE ARTIFACT. It is what comes back and what gets judged, so it
//is not an afterthought on this form — a task without one has nowhere to put
//what it makes. Nothing is given out by writing a task: it touches no machine.
//
//---- what this form IS, and it is not a design decision -------------------
//
//IT IS WHATEVER THE SUPERVISOR HAS TO PROVIDE, field for field. That is the
//whole rule, and everything below follows from it rather than from anybody's
//taste about forms.
//
//The supervisor is the other thing that writes tasks here, and it is held to
//`taskCreate` over the wire — see ../vms/provision/scripts/supervisor-skill.md
//and ./doors.js. So the person at the window is asked for exactly what a model
//is asked for, and the two cannot drift: a field that appears here and not
//there is a field the supervisor would be refused for omitting, and a field
//there and not here is a rule a person can walk past.
//
//    branch      the cut it delivers on
//    becauseOf   the FINISHED judgement that established the work is real
//    job         a script a person approved
//    contract    the rules a person approved
//    tag         which KIND of machine, never which machine
//    title       so the board is readable at a glance
//    brief       what the worker is actually told
//
//`becauseOf` IS THE ONE THIS FORM DID NOT HAVE, and it is the app's central
//rule: nothing becomes work until a judge has said it is real. The supervisor
//is refused outright without it — "you were handed a rumour" — and a person at
//the window was never asked at all. That asymmetry made the strictest rule in
//the app look like a quirk of the API.
//
//AND THE PROMPT SELECT IS GONE, which is the other half of the same argument. A
//supervisor does not fill a brief from the library: it WRITES one, quoting what
//the judge found and naming the file it pointed at, because the worker cannot
//see the judgement. That is why `do-the-work` names no prompt on purpose — see
//../library/chains.js: "the brief IS the prompt, written per task rather than
//kept in the library." A prompt picker here offered a shortcut the thing this
//form mirrors does not have.
//
//SO IS THE FOLDER FIELD. The supervisor cannot say where on a machine work
//happens — it does not see machines at all beyond what KIND there are — and a
//field only a person can reach is a way for two callers of one action to mean
//different things.
//
//---- one form, two kinds of work ------------------------------------------
//
//A JUDGE CANNOT BE GIVEN A TASK. The libraries are separated by `kind` and the
//two creating actions are different — `taskCreate` writes work, `judgementCreate`
//asks for a reading — so the first choice on the form is which of the two this
//is, and everything under it changes with it.
//
//WHICH IS ALSO THE SUPERVISOR'S SHAPE. Its flow starts with a judgement of a
//claim and only reaches a task if that judgement comes back true; both halves
//are things it commissions, from two libraries it may not mix.
//
//A JUDGEMENT IS ASKED A QUESTION, NOT GIVEN A BRIEF, and it needs no
//`becauseOf` — it is the thing that establishes what is real, so requiring one
//would be asking what established the thing that establishes things.
//
//THE FORM GETS THE WIDTH AND THE PREVIEW SITS NARROW BESIDE IT. The preview is
//the point — a brief is read once, by something that cannot ask a question.
//---------------------------------------------------------------------------

//THE TWO KINDS, AND THE WORDS EACH USES. Keyed by the `kind` value the
//libraries are keyed by on the server, so this file invents no third spelling —
//the same rule ../library/chains.js keeps for the same reason.
var WORK = {
    task: {
        who: 'a worker',
        job: 'Which job runs it',
        //NOT "none — set the machine up and leave it running for me", which is
        //what this offered and then refused. That is a person-only convenience
        //and the supervisor has no such option: it is told to read `jobs` and
        //pick one a person approved. Offering it here put a refusal after the
        //press, which is the one fault this pane's whole design is against.
        none: 'pick the job that runs it',
        words: 'The brief — what the worker is actually told',
        hint: 'Write it as instructions to somebody who cannot ask you a question.'
    },
    judge: {
        who: 'a judge',
        job: 'Which job reads it',
        none: 'pick the judging chain that reads this',
        words: 'The question — what it is being asked to find out',
        hint: 'Say what would settle it. A judgement answers CLAIM: true, false or unclear.'
    }
};

module.exports = function add(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, CardTitle, CardSub, Badge, Button,
        Skeleton, Empty, Note, Mono, Form, Field, Notice, Code
    } = theme;

    return function AddTask() {
        //EVERYTHING THIS FORM MAY OFFER, ASKED FOR TOGETHER. Each of these
        //narrows the list to what could actually be chosen, which is the whole
        //argument of the pane.
        //
        //THE LIBRARIES ARE ASKED FOR WHOLE AND SPLIT HERE. Every row carries its
        //own `kind`, so one read covers both halves of the form and switching
        //between them costs nothing — see ../library/chain.js, which says a
        //plain listing never hides half of what exists.
        var board = okc.use('branchBoard', {}, 0);
        var jobs = okc.use('jobs', {}, 0);
        var contracts = okc.use('contracts', {}, 0);
        var machines = okc.use('vmList', {}, 0);
        var judging = okc.use('judging', {}, 0);

        //WHAT IS TYPED IS KEPT. Writing a brief is not something somebody
        //finishes in one sitting, and this window restarts constantly — see
        //../remember, and the rule about what may be kept there. A brief is
        //what a worker is told, which is already going to a machine; it is not
        //a secret.
        var [draft, setDraft] = remember.use('addtask', 'draft', {});
        var [said, setSaid] = useState(null);
        var [busy, setBusy] = useState(false);

        var set = function (k, v) {
            setDraft(function (was) {
                var next = Object.assign({}, was);
                next[k] = v;
                return next;
            });
        };
        var val = function (k) { return draft && draft[k] != null ? draft[k] : ''; };

        //AN ERROR BEFORE THE SPINNER, or a call that failed is indistinguishable
        //from one still on its way and the pane sits on a skeleton for ever.
        //`okc.use` hands back both; reading only `state` throws half of it away.
        if (!board.state && board.error) return <Pane><Note kind="bad">{board.error}</Note></Pane>;
        if (!board.state) return <Pane><Skeleton rows={4} /></Pane>;

        //WORKER UNLESS SOMEBODY SAYS OTHERWISE, because it is the ordinary case
        //— but it is a CHOICE on the form rather than an assumption, since the
        //two go to different actions and are held to different libraries.
        var kind = val('kind') === 'judge' ? 'judge' : 'task';
        var words = WORK[kind];

        //A CUT, AND NOT A LINE. `protected` wins over `cut`: making a branch a
        //line is exactly the act that says work does not go on it directly.
        var cuts = (board.state.branches || [])
            .filter(function (b) { return b.cut && !b.protected; })
            .map(function (b) { return b.name; });

        var ofKind = function (rows) {
            return (rows || []).filter(function (r) { return String(r.kind || 'task') === kind; });
        };

        var jobList = ofKind((jobs.state && jobs.state.jobs) || []);
        var contractList = ofKind((contracts.state && contracts.state.contracts) || [])
            .filter(function (c) { return c.approved; });

        //---- WHAT MAY BE NAMED AS THE REASON THIS IS WORK -------------------
        //
        //ONLY THE ONES THAT HAVE FINISHED READING. ./doors.js refuses anything
        //else in as many words — a judgement still running "has established
        //nothing" — so offering one here would be a refusal moved from before
        //the press to after it, which is the fault this pane's whole design is
        //against.
        var reasons = ((judging.state && (judging.state.judgements || judging.state.judging)) || [])
            .filter(function (j) { return j.state === 'done'; });

        //THE TAGS THAT EXIST ARE THE TAGS ON THE MACHINES, with who carries
        //each — so the dropdown says what choosing one would MEAN rather than
        //offering a bare word.
        var byTag = {};
        ((machines.state && machines.state.vms) || []).forEach(function (v) {
            (v.tags || []).forEach(function (t) { (byTag[t] = byTag[t] || []).push(v.name); });
        });
        var tags = Object.keys(byTag).sort();

        function stop(text) { setSaid({ bad: true, text: text }); }

        function write(andQueue) {
            if (!val('branch')) {
                return stop('It needs a branch cut. That branch is what comes back and what gets judged.');
            }
            if (!val('job')) {
                return stop(kind === 'judge'
                    ? 'Say which judging chain reads it. A judgement without a chain is an opinion with nothing behind it.'
                    : 'Say which job runs it. The supervisor may only use a job a person approved, and so may you.');
            }
            if (!val('words')) {
                return stop(kind === 'judge'
                    ? 'Say what it is being asked to find out. A judge cannot see the issue unless you hand it over.'
                    : 'It needs a brief. That is what the worker is actually told, and it cannot ask you a question.');
            }

            setBusy(true);
            var done = function (r, queued) {
                setSaid({ text: (queued ? (r.note || 'Queued.') : (r.note || 'Written.')) });
                setBusy(false);
            };
            var failed = function (e) { stop(e.message); setBusy(false); };

            if (kind === 'judge') {
                //A BRANCH CUT IS THE ONLY SUBJECT THIS FORM OFFERS. The other
                //two — a PR cut, and a pull request that arrived — are asked for
                //where they are read, on Repositories and on the Judge tab, and
                //each carries a gate this form does not.
                return okc.call('judgementCreate', {
                    kind: 'branch',
                    branch: val('branch'),
                    job: val('job'),
                    question: val('words'),
                    tag: val('tag') || undefined
                }).then(function (r) {
                    setDraft({ kind: 'judge' });
                    if (!andQueue || !r.ref) return done(r, false);
                    return okc.call('judgementQueue', { ref: r.ref }).then(
                        function (q) { done(q, true); },
                        function (e) { stop('Asked for, but not queued: ' + e.message); setBusy(false); }
                    );
                }, failed);
            }

            if (!val('title')) { setBusy(false); return stop('It needs a title, so the board is readable at a glance.'); }
            if (!val('becauseOf')) {
                setBusy(false);
                return stop('Say which judgement established this work is real. The supervisor is refused without '
                    + 'one — read what a judgement handed back, and write the task from that.');
            }

            okc.call('taskCreate', {
                becauseOf: val('becauseOf'),
                task: {
                    title: val('title'),
                    branch: val('branch'),
                    brief: val('words'),
                    job: val('job'),
                    contractId: val('contractId') || undefined,
                    tag: val('tag') || undefined
                }
            }).then(function (r) {
                setDraft({});
                if (!andQueue || !r.id) return done(r, false);
                return okc.call('taskQueue', { id: r.id }).then(
                    function (q) { done(q, true); },
                    function (e) { stop('Written, but not queued: ' + e.message); setBusy(false); }
                );
            }, failed);
        }

        var chosenJob = jobList.filter(function (j) { return j.id == val('job'); })[0];
        var chosenContract = contractList.filter(function (c) { return c.id == val('contractId'); })[0];
        var chosenReason = reasons.filter(function (j) { return j.ref == val('becauseOf'); })[0];

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Cols>
                    <Col narrow>
                        <h2>It will carry</h2>
                        {/* THE PREVIEW IS THE POINT. A brief is read once, by
                            something that cannot ask a question, so seeing the
                            words in the shape they arrive in is the only check
                            there is before a machine spends two minutes on
                            them. */}
                        <Panel>
                            <CardTitle>
                                {kind === 'judge'
                                    ? (val('branch') ? <span>{'a reading of '}<Mono>{val('branch')}</Mono></span> : <span className="muted">nothing to read yet</span>)
                                    : (val('title') || <span className="muted">no title yet</span>)}
                            </CardTitle>
                            <CardSub>
                                {val('branch')
                                    ? <span>{kind === 'judge' ? 'reads ' : 'delivers on '}<Mono>{val('branch')}</Mono></span>
                                    : <span className="muted">{kind === 'judge'
                                        ? 'no branch yet — there is nothing for it to read'
                                        : 'no branch yet — there is nowhere for it to deliver'}</span>}
                                {val('tag') ? <span>{' · '}<Badge kind="muted">{val('tag')}</Badge></span> : null}
                            </CardSub>

                            {val('words')
                                ? <Code text={val('words')} tall />
                                : <Empty>{kind === 'judge'
                                    ? 'no question yet — a judge cannot see the claim unless you hand it over'
                                    : 'the brief is empty — that is what the worker is actually told'}</Empty>}
                        </Panel>

                        <Panel>
                            <CardTitle>Under</CardTitle>
                            {/* WHO ALLOWED THIS, on the same screen it is being
                                written on. A job and a contract are things a
                                person approved, and a task carries a COPY of the
                                contract's rules rather than a reference — so
                                what is chosen here is what the worker is held
                                to, not what the contract says next week. */}
                            <CardSub>
                                {chosenJob
                                    ? <span>{'the job '}<Mono>{chosenJob.name}</Mono>{chosenJob.approved ? '' : ' — NOT APPROVED'}</span>
                                    : <span className="muted">no job chosen — nothing can run without one</span>}
                            </CardSub>
                            {kind === 'judge' ? null : (
                                <CardSub>
                                    {chosenContract
                                        ? <span>{'the contract '}<Mono>{chosenContract.name}</Mono></span>
                                        : <span className="muted">no contract — the worker gets no rules</span>}
                                </CardSub>
                            )}
                            {chosenContract && chosenContract.text
                                ? <Code text={chosenContract.text} />
                                : null}
                        </Panel>

                        {/* WHY THIS IS WORK AT ALL, kept beside what it will
                            carry rather than buried in the form. Six weeks
                            later "why was this done" is answerable by reading
                            the judgement it came from. */}
                        {kind === 'judge' ? null : (
                            <Panel>
                                <CardTitle>Because of</CardTitle>
                                <CardSub>
                                    {chosenReason
                                        ? <span><Mono>{chosenReason.ref}</Mono>{' — ' + (chosenReason.title || chosenReason.question || 'a finished judgement')}</span>
                                        : <span className="muted">nothing yet — a task is not written from a rumour</span>}
                                </CardSub>
                            </Panel>
                        )}
                    </Col>

                    <Col wide>
                        <h2>The task</h2>
                        <Panel>
                            {/* NOTHING IS GIVEN OUT BY WRITING ONE, said before
                                the form rather than discovered after it. */}
                            <Note>
                                This is what the supervisor is asked for, field for field — so a person at the
                                window and a model over the wire write the same thing under the same rules.
                                Nothing is given out yet: writing one touches no machine.
                            </Note>
                            <Form>
                                <Field f={{
                                    name: 'kind', label: 'Who does it',
                                    hint: 'the two libraries do not mix — a judge cannot be given a task, and a working job cannot read one',
                                    options: [
                                        { value: 'task', label: 'a worker — it writes the change' },
                                        { value: 'judge', label: 'a judge — it reads what is there and answers a question' }
                                    ]
                                }} value={kind} onChange={function (v) {
                                    //THE CHAIN GOES WITH THE KIND. A job picked
                                    //from the working library is refused by
                                    //`judgementCreate` and the other way round,
                                    //so keeping it across the switch would offer
                                    //a choice that cannot be pressed.
                                    setDraft(function (was) {
                                        return Object.assign({}, was, { kind: v, job: '', contractId: '' });
                                    });
                                }} />

                                <Field f={{
                                    name: 'branch', label: 'Work in this Branch Cut',
                                    hint: 'a cut is a branch made here with a reason. A line is not offered: making one is what says work does not go on it directly',
                                    options: [{ value: '', label: cuts.length ? 'pick the cut this work belongs to' : 'there are no cuts yet — make one on Repositories → Branches Cut' }]
                                        .concat(cuts.map(function (b) { return { value: b, label: b }; }))
                                }} value={val('branch')} onChange={function (v) { set('branch', v); }} />

                                {kind === 'judge' ? null : (
                                    <Field f={{
                                        name: 'becauseOf', label: 'Because of — the judgement that established this is real',
                                        hint: 'only judgements that have finished reading are offered. The supervisor is refused without one, and so is this',
                                        options: [{
                                            value: '', label: reasons.length
                                                ? 'pick the judgement this work comes from'
                                                : 'nothing has finished reading yet — ask for a judgement first'
                                        }].concat(reasons.map(function (j) {
                                            return {
                                                value: j.ref,
                                                label: j.ref + ' — ' + (j.title || j.question || 'a judgement')
                                                    + (j.verdict ? ' [' + j.verdict + ']' : '')
                                            };
                                        }))
                                    }} value={val('becauseOf')} onChange={function (v) { set('becauseOf', v); }} />
                                )}

                                <Field f={{
                                    name: 'job', label: words.job,
                                    hint: 'you may only use a job a person approved — the same rule the supervisor is held to',
                                    options: [{ value: '', label: jobList.length ? words.none : 'nothing approved in this library yet — see the Library' }]
                                        .concat(jobList.map(function (x) {
                                            return { value: x.id, label: x.name + (x.runnable ? '' : ' — ' + (x.whyNot || 'not runnable')) };
                                        }))
                                }} value={val('job')} onChange={function (v) { set('job', v); }} />

                                {kind === 'judge' ? null : (
                                    <Field f={{
                                        name: 'contractId', label: 'Under which contract',
                                        hint: 'only approved contracts are offered — an unapproved one cannot govern a run',
                                        options: [{ value: '', label: 'none — the worker gets no rules' }]
                                            .concat(contractList.map(function (c) { return { value: c.id, label: c.name }; }))
                                    }} value={val('contractId')} onChange={function (v) { set('contractId', v); }} />
                                )}

                                {/* SHOWN DISABLED RATHER THAN HIDDEN when no
                                    machine is tagged: a field that appears the
                                    day somebody tags a machine is a feature
                                    nobody knew they had. */}
                                <Field f={{
                                    name: 'tag',
                                    label: tags.length ? 'On which kind of machine' : 'On which kind of machine — no machine is tagged yet',
                                    hint: 'which KIND, never which machine — the queue decides that, and a tag no machine carries makes it wait rather than fall back',
                                    disabled: !tags.length,
                                    options: [{ value: '', label: tags.length ? 'any free machine' : 'any free machine — tag one with vmTags to group them' }]
                                        .concat(tags.map(function (t) { return { value: t, label: t + ' — ' + byTag[t].join(', ') }; }))
                                }} value={val('tag')} onChange={function (v) { set('tag', v); }} />

                                {kind === 'judge' ? null : (
                                    <Field f={{ name: 'title', label: 'Title', placeholder: 'Short enough to read in a list' }}
                                        value={val('title')} onChange={function (v) { set('title', v); }} />
                                )}

                                <Field f={{
                                    name: 'words', label: words.words,
                                    multiline: true, rows: 8,
                                    placeholder: words.hint
                                }} value={val('words')} onChange={function (v) { set('words', v); }} />
                            </Form>

                            <div className="row">
                                <Button kind="ok" disabled={busy} onClick={function () { write(false); }}>
                                    {busy ? 'writing…' : (kind === 'judge' ? 'Ask for it' : 'Write it')}
                                </Button>
                                {/* WRITING AND QUEUEING ARE TWO ACTS. A task
                                    written is a task nobody has spent a machine
                                    on; queueing is the moment that changes, so
                                    it is its own press. */}
                                <Button disabled={busy} onClick={function () { write(true); }}>
                                    {kind === 'judge' ? 'Ask for it and queue it' : 'Write it and queue it'}
                                </Button>
                                <Button disabled={busy} onClick={function () { setDraft({ kind: kind }); }}>Clear</Button>
                            </div>
                        </Panel>
                    </Col>
                </Cols>
            </Pane>
        );
    };
};
