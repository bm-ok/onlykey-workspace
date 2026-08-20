var React = require('react');
var { useState } = React;
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//Actions: the jobs, prompts and contracts a worker may be given.
//
//THIS IS THE APPROVAL SURFACE, and it is the one the operator's rule is about:
//a person approves prompts, jobs and contracts. Nothing else on this pane
//matters as much as that sentence.
//
//WHAT THE THREE ARE, and they stack:
//
//  contract  the rules a worker is given. What it may and may not do.
//  prompt    what a worker is told. Points at a contract.
//  job       a script that takes a prompt and does something with it.
//
//So withdrawing a contract's approval stops the prompts that name it, and
//withdrawing a prompt's stops the jobs that use it. The chain is the point:
//approving a job is not approving it in isolation, it is approving what it will
//be told and what it will be allowed to do.
//
//WRITTEN AT THE WINDOW IT IS APPROVED BY WHOEVER WROTE IT; WRITTEN OVER THE WIRE
//IT WAITS. That is the actions' own rule, not this pane's, and it is the same
//shape as the guards: being at the window IS the approval, because somebody was
//there and read it. Anything arriving down the pipe queues up to be read.
//
//AND APPROVAL LAPSES WHEN THE THING CHANGES. `hash` is what was read; edit it
//and the approval is `lapsed` — still recorded, no longer standing. An approval
//that survived an edit would be an approval of something nobody read.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Plus, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Code,
        Kv, KvRow, Notice, ask
    } = theme;

    var day = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : null; };

    //THE THREE KINDS DIFFER IN FOUR PLACES AND NOWHERE ELSE, so they are one
    //painter told which it is. Two copies would be two copies that drift.
    var KINDS = {
        job: {
            title: 'Jobs', list: 'jobs', one: 'job', body: 'code',
            about: 'a script that takes a prompt and does something with it',
            read: 'Say a job is fit to run, having read its script.',
            approve: 'jobApprove', withdraw: 'jobWithdraw', forget: 'jobForget', use: 'jobUse'
        },
        prompt: {
            title: 'Prompts', list: 'prompts', one: 'prompt', body: 'text',
            about: 'what a worker is told, written once and kept',
            read: 'Say a prompt is fit to be sent to a worker, having read it.',
            approve: 'promptApprove', withdraw: 'promptWithdraw', forget: 'promptForget', use: 'promptUse'
        },
        contract: {
            title: 'Contracts', list: 'contracts', one: 'contract', body: 'text',
            about: 'the rules a worker is given, written once and kept',
            read: 'Say a contract is fit to govern a run, having read it.',
            approve: 'contractApprove', withdraw: 'contractWithdraw', forget: null, use: 'contractUse'
        }
    };

    //APPROVED, LAPSED, OR WAITING — three states and not two, because "was
    //approved and has since been edited" is the one that matters most and reads
    //as approved if it is folded in.
    function stand(x) {
        if (x.lapsed) return { kind: 'warn', word: 'edited since it was read' };
        if (x.approved) return { kind: 'ok', word: 'approved' };
        return { kind: 'bad', word: 'waiting to be read' };
    }

    function Row({ x, on, onPick }) {
        var s = stand(x);
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    <span>{x.name || x.id}</span>
                    <Badge kind={s.kind}>{s.word}</Badge>
                </CardTitle>
                {x.about ? <CardSub>{x.about}</CardSub> : null}
                <CardSub>
                    <Mono>{x.id}</Mono>
                    {x.kind ? <span>{' · ' + x.kind}</span> : null}
                    {(x.tags || []).map(function (t) { return <span key={t}>{' '}<Badge kind="muted">{t}</Badge></span>; })}
                </CardSub>
            </Card>
        );
    }

    function LibraryFor(which) {
        var K = KINDS[which];

        return function Library() {
            var { state, error, reads, again } = useAsk(okc, K.list, {}, 20000);
            var [find, setFind] = useState('');
            var [only, setOnly] = remember.use('library-' + which, 'only', null);
            var [picked, setPicked] = remember.use('library-' + which, 'picked', null);
            var [said, setSaid] = useState(null);

            if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
            if (!state) return <Pane><Skeleton rows={4} /></Pane>;

            var all = state[K.list] || [];
            var counts = {
                waiting: all.filter(function (x) { return !x.approved && !x.lapsed; }).length,
                lapsed: all.filter(function (x) { return x.lapsed; }).length,
                task: all.filter(function (x) { return x.kind == 'task'; }).length,
                judge: all.filter(function (x) { return x.kind == 'judge'; }).length
            };

            var rows = all.filter(function (x) {
                var hay = ((x.name || '') + ' ' + (x.id || '') + ' ' + (x.about || '')).toLowerCase();
                if (find && hay.indexOf(find.toLowerCase()) < 0) return false;
                if (only == 'waiting') return !x.approved && !x.lapsed;
                if (only == 'lapsed') return !!x.lapsed;
                if (only == 'task' || only == 'judge') return x.kind == only;
                return true;
            });

            var on = all.filter(function (x) { return x.id == picked; })[0] || null;

            function tell(p) {
                return p.then(
                    function (r) { setSaid({ text: r.note || 'Done.' }); again(); },
                    function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                );
            }

            //---- approving ---------------------------------------------------
            //
            //THE DIALOG SHOWS WHAT IS BEING APPROVED. That sounds obvious and is
            //the entire feature: "having read its script" is the wording of the
            //action itself, and a confirmation that does not put the thing in
            //front of the person is a confirmation that they read the title.
            function approve(x) {
                var body = x[K.body];
                ask({
                    title: 'Approve "' + (x.name || x.id) + '"?',
                    plain: [
                        K.read,
                        which == 'job'
                            ? 'It runs on a machine, as a worker, with whatever the prompt tells it.'
                            : which == 'prompt'
                                ? 'It is what a worker is told, word for word.'
                                : 'It is the rules a worker is given — what it may do and what it may not.',
                        x.lapsed ? 'It was approved before and has been edited since. What follows is the version as it stands now.' : null,
                        //THE THING ITSELF, IN THE DIALOG.
                        body ? <Code key="body" text={body} mode={which == 'job' ? 'javascript' : undefined} /> : null
                    ],
                    fields: [{ name: 'note', label: 'A note, if it needs one', placeholder: 'what you checked' }],
                    cost: which == 'job'
                        ? 'Approved, it can be sent to a machine and run.'
                        : 'Approved, it can be handed to a worker.',
                    confirm: 'It is fit',
                    protect: true,
                    onYes: function (f) { return tell(okc.call(K.approve, { id: x.id, note: f.note || undefined })); }
                });
            }

            function withdraw(x) {
                ask({
                    title: 'Take the approval back on "' + (x.name || x.id) + '"?',
                    plain: [
                        'Nothing is deleted. It stops being usable until somebody reads it again.',
                        //THE CHAIN, SAID WHERE IT BITES. Withdrawing a contract
                        //quietly stops jobs two steps away, and finding that out
                        //by watching a run fail is the wrong way round.
                        which == 'contract' ? 'Prompts that name this contract stop being usable, and jobs that use those prompts stop being runnable.' : null,
                        which == 'prompt' ? 'Jobs that use this prompt stop being runnable.' : null
                    ],
                    confirm: 'Take it back',
                    onYes: function () { return tell(okc.call(K.withdraw, { id: x.id })); }
                });
            }

            function aside(x, on2) {
                ask({
                    title: (on2 ? 'Offer "' : 'Set aside "') + (x.name || x.id) + '"?',
                    plain: on2
                        ? ['It goes back into what a supervisor may pick from.',
                            //THE RULE THE ACTION ITSELF STATES, repeated here
                            //because it is the interesting half: coming back is
                            //not free.
                            'Brought back over the wire it would wait to be read again. Brought back here, by you, it does not.']
                        : ['It is kept, and stops being offered to a supervisor.',
                            'Nothing that already uses it is changed.'],
                    confirm: on2 ? 'Offer it again' : 'Set it aside',
                    onYes: function () { return tell(okc.call(K.use, { id: x.id, use: on2 })); }
                });
            }

            function forget(x) {
                ask({
                    title: 'Throw "' + (x.name || x.id) + '" away?',
                    plain: [
                        which == 'job' ? 'The job and its script, gone.' : 'It is gone from the library.',
                        which == 'prompt' ? 'Tasks already written from it are untouched — they carry their own copy.' : null
                    ],
                    cost: 'It cannot be brought back.',
                    confirm: 'Throw it away',
                    danger: true,
                    protect: true,
                    onYes: function () { return tell(okc.call(K.forget, { id: x.id })).then(function () { setPicked(null); }); }
                });
            }

            var chip = function (key, word) {
                return <Chip on={only == key} count={counts[key]}
                    onClick={function () { setOnly(only == key ? null : key); }}>{word}</Chip>;
            };

            var s = on ? stand(on) : null;

            return (
                <Pane>
                    {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                    {error ? <Note kind="bad">{error}</Note> : null}

                    <Cols>
                        <Col narrow>
                            <TitleRow>
                                {K.title}<Grow />
                                <span className="muted">{all.length}</span>
                                <Plus title={'Writing one here is approving it — see the note'} onClick={function () {
                                    ask({
                                        title: 'Writing a ' + K.one + ' here',
                                        plain: [
                                            'Written at the window it is approved by whoever wrote it. Written over the wire it waits to be read.',
                                            'That is not this pane being lenient — being here IS the reading, because somebody is.',
                                            'The editor for this is not ported yet, so use the command line: ' + (which == 'job' ? 'jobSave' : which == 'prompt' ? 'promptSave' : 'contractSave') + '. Anything written that way waits here to be read.'
                                        ],
                                        confirm: 'I see'
                                    });
                                }} />
                            </TitleRow>
                            <Finder value={find} onChange={setFind} placeholder={'find a ' + K.one} />
                            <Chips>
                                {chip('waiting', 'waiting to be read')}
                                {chip('lapsed', 'edited since')}
                                {chip('task', 'task')}
                                {chip('judge', 'judge')}
                            </Chips>
                            <Stack>
                                {rows.length
                                    ? rows.map(function (x) {
                                        return <Row key={x.id} x={x} on={x.id == picked}
                                            onPick={function () { setPicked(x.id); }} />;
                                    })
                                    : <Empty>{all.length ? 'nothing matches' : 'nothing here yet'}</Empty>}
                            </Stack>
                        </Col>

                        <Col wide>
                            <h2>{on ? (on.name || on.id) : K.title} <span className="muted">{on ? '' : '— ' + K.about}</span></h2>

                            {!on ? <Panel><Empty>{'pick a ' + K.one + ' on the left'}</Empty></Panel> : (
                                <div>
                                    <Panel>
                                        <div className="row">
                                            {/* APPROVING IS THE PERSON'S PRESS, and
                                                the one the whole pane is for. */}
                                            <Button kind="ok" protect
                                                disabled={on.approved && !on.lapsed}
                                                title={on.approved && !on.lapsed ? 'it is already approved' : K.read}
                                                onClick={function () { approve(on); }}>
                                                {on.lapsed ? 'Read it again' : 'Approve it'}
                                            </Button>

                                            {/* WITHDRAWING IS NOT GUARDED, and that
                                                asymmetry is deliberate: it makes
                                                things LESS usable. The direction
                                                that needs a person is the one that
                                                lets something run. */}
                                            <Button
                                                disabled={!on.approved}
                                                title={on.approved ? 'stop it being usable until it is read again' : 'it is not approved'}
                                                onClick={function () { withdraw(on); }}>Withdraw approval</Button>

                                            <Button
                                                title={on.use === false ? 'offer it to a supervisor again' : 'keep it, and stop offering it'}
                                                onClick={function () { aside(on, on.use === false); }}>
                                                {on.use === false ? 'Offer it again' : 'Set it aside'}
                                            </Button>

                                            {K.forget
                                                ? <Button kind="danger" protect
                                                    onClick={function () { forget(on); }}>Throw it away</Button>
                                                : null}
                                        </div>

                                        {on.whyNot ? <Note kind="warn">{on.whyNot}</Note> : null}
                                    </Panel>

                                    <Panel>
                                        <Kv>
                                            <KvRow label="id"><Mono>{on.id}</Mono></KvRow>
                                            <KvRow label="for">{on.kind || 'any'}</KvRow>
                                            <KvRow label="state">{s.word}</KvRow>
                                            {on.approvedAt
                                                ? <KvRow label="read by">{(on.approvedBy || 'somebody') + ', ' + day(on.approvedAt)}</KvRow>
                                                : null}
                                            {/* WHAT WAS READ, AS A NUMBER. The
                                                approval is against this; a
                                                different hash is a different
                                                thing, which is what `lapsed`
                                                means. */}
                                            <KvRow label="what was read"><Mono>{on.hash || 'not recorded'}</Mono></KvRow>
                                            <KvRow label="written">{day(on.written) || 'unknown'}</KvRow>
                                            {on.edited ? <KvRow label="edited">{day(on.edited)}</KvRow> : null}
                                            {on.promptId
                                                ? <KvRow label="uses the prompt">
                                                    <Mono>{on.promptId}</Mono>
                                                    {on.missingPrompt ? <span>{' '}<Badge kind="bad">not here</Badge></span> : null}
                                                </KvRow>
                                                : null}
                                            {on.contractId
                                                ? <KvRow label="under the contract">
                                                    <Mono>{on.contractId}</Mono>
                                                    {on.missingContract ? <span>{' '}<Badge kind="bad">not here</Badge></span> : null}
                                                </KvRow>
                                                : null}
                                        </Kv>
                                        {on.about ? <Note>{on.about}</Note> : null}
                                    </Panel>

                                    <Panel>
                                        <CardTitle>{which == 'job' ? 'The script' : 'What it says'}</CardTitle>
                                        <CardSub>
                                            {'This is what approving it is about. '
                                                + (on.lines ? on.lines + ' line(s).' : '')}
                                        </CardSub>
                                        {on[K.body]
                                            ? <Code text={on[K.body]} mode={which == 'job' ? 'javascript' : undefined} />
                                            : <Empty>{'the ' + K.one + ' list does not carry the text — ask for it by id on the command line'}</Empty>}
                                    </Panel>
                                </div>
                            )}

                            <Note>{(state.note || '') + ' · read ' + reads + ' time(s), every 20s'}</Note>
                        </Col>
                    </Cols>
                </Pane>
            );
        };
    }

    shell.tab({ name: 'Actions', order: 50 });
    shell.pane({ tab: 'Actions', name: 'Jobs', order: 10, Component: LibraryFor('job') });
    shell.pane({ tab: 'Actions', name: 'Prompts', order: 20, Component: LibraryFor('prompt') });
    shell.pane({ tab: 'Actions', name: 'Contracts', order: 30, Component: LibraryFor('contract') });

    await register(null, {});
}
module.exports = plugin;
