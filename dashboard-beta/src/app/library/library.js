var React = require('react');
var { useState, useEffect } = React;

module.exports = function library(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Plus, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Code, Diff,
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
            approve: 'jobApprove', withdraw: 'jobWithdraw', forget: 'jobForget', use: 'jobUse',
            versions: 'jobVersions', version: 'jobVersion'
        },
        prompt: {
            title: 'Prompts', list: 'prompts', one: 'prompt', body: 'text',
            about: 'what a worker is told, written once and kept',
            read: 'Say a prompt is fit to be sent to a worker, having read it.',
            approve: 'promptApprove', withdraw: 'promptWithdraw', forget: 'promptForget', use: 'promptUse',
            versions: 'promptVersions', version: 'promptVersion'
        },
        contract: {
            title: 'Contracts', list: 'contracts', one: 'contract', body: 'text',
            about: 'the rules a worker is given, written once and kept',
            read: 'Say a contract is fit to govern a run, having read it.',
            approve: 'contractApprove', withdraw: 'contractWithdraw', forget: null, use: 'contractUse',
            versions: 'contractVersions', version: 'contractVersion'
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

    //---- TWO AXES, AND THEY ARE DIFFERENT QUESTIONS -------------------------
    //
    //`which` is WHAT THIS IS — a job, a prompt, a contract. `forWhom` is WHO IT
    //IS FOR — a worker doing work, or a judge reading it.
    //
    //THEY WERE ONE PANE WITH A FILTER, and the filter is what made it wrong.
    //The worker and the judge are two libraries, not one list with a chip
    //pressed: a judge's contract governs READING and a worker's governs WRITING,
    //and the whole reason they are kept apart is that the account which says
    //whether work holds must not be the account that wrote it. A chip is a thing
    //somebody forgets is pressed.
    //
    //`forWhom` NULL IS EVERYTHING, which is what the chips were for and is kept
    //for a pane that genuinely wants the lot.
    function LibraryFor(which, forWhom) {
        var K = KINDS[which];
        var mine = forWhom === 'task' || forWhom === 'judge' ? forWhom : null;

        return function Library() {
            var { state, error, reads, again } = okc.use(K.list, {}, 20000);

            //---- AND IT IS TOLD WHEN SOMETHING IS WRITTEN --------------------
            //
            //THE POLL ABOVE IS TWENTY SECONDS, which is right for a list that
            //rarely moves and wrong for the moment it does. A job written from
            //the command line was not on this pane -- or clickable -- until the
            //next read, and a person watching for their own save has no way to
            //tell a slow pane from one that did not happen.
            //
            //THE EVENT CARRIES ONLY WHAT CHANGED, so this asks again rather than
            //being handed rows: the fetch above already knows which half of the
            //library this pane is about, and a payload would mean the server
            //deciding that instead.
            //
            //AND THE POLL IS LEFT ALONE. A write that never came through the
            //actions -- a job's script edited on disk -- still arrives within
            //twenty seconds. This makes the common case immediate; it is not the
            //only way a list can change.
            useEffect(function () {
                var alive = true;
                function heard(said) {
                    if (!alive) return;
                    //ONLY THIS SHELF. Three panes are mounted from this same
                    //factory, and a save on one redrawing all three is three
                    //reads for one change.
                    if (said && said.what && said.what !== which) return;
                    again();
                }
                okc.io.on('library:changed', heard);
                return function () { alive = false; okc.io.off('library:changed', heard); };
            }, []);

            var [find, setFind] = useState('');
            //SCOPED PER SET, so picking a job on one tab does not move the
            //selection on the other. They are two libraries; a shared memory
            //would make them one list again in the only way that matters.
            var where = 'library-' + which + (mine ? '-' + mine : '');
            var [only, setOnly] = remember.use(where, 'only', null);
            var [picked, setPicked] = remember.use(where, 'picked', null);
            var [said, setSaid] = useState(null);

            //---- WHAT WAS APPROVED BEFORE, FOR THE ONE THAT IS PICKED --------
            //
            //ASKED SEPARATELY RATHER THAN CARRIED ON THE LIST. Twenty contracts
            //with every version of each is a listing nobody reads, paid for on
            //every poll, so that one of them can be looked at.
            //
            //NOT ASKED AT ALL WITH NOTHING PICKED. See ../core/okc/ask.js: a
            //falsy action is "not yet", because a door asked for an entry with
            //no id rightly refuses and the pane would hold that refusal.
            var [atVer, setAtVer] = useState(null);
            var kept = okc.use(picked ? K.versions : null, { id: picked }, 0);

            //AND ONE OLDER ONE, ONLY WHEN SOMEBODY ASKS FOR IT. The newest comes
            //down with the listing because it is the one a lapsed entry is a
            //change FROM; the rest are read one at a time, when picked.
            var older = okc.use(picked && atVer ? K.version : null, { id: picked, at: atVer }, 0);

            //A VERSION BELONGS TO THE THING IT IS OF. Kept across a change of
            //selection it is an `at` from one contract asked of another, which
            //is a door refusing rather than a panel showing the wrong history —
            //but only because the door checks. Do not rely on that.
            useEffect(function () { setAtVer(null); }, [picked]);

            if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
            if (!state) return <Pane><Skeleton rows={4} /></Pane>;

            //NARROWED BEFORE THE COUNTS, not after. Counted from the whole list
            //and shown from a filtered one, the number above a pane says how
            //many exist and the pane shows how many are yours — and the two
            //disagreeing on screen is the fault this port keeps finding.
            var everything = state[K.list] || [];
            var all = mine ? everything.filter(function (x) { return (x.kind || 'task') == mine; }) : everything;
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

            //WHICH KEPT VERSION IS BEING READ. Nothing picked means the newest,
            //which came down with the listing — so the ordinary case draws
            //without a second read and without a moment of empty panel.
            var showing = atVer ? older.state : ((kept.state && kept.state.newest) || null);

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

                //---- AND WHAT IT WAS WHEN THEY LAST READ IT ------------------
                //
                //"IT WAS APPROVED BEFORE AND HAS BEEN EDITED SINCE" WAS A
                //SENTENCE AND NOTHING ELSE. The dialog then showed the whole
                //document as it stands, which is the right thing to show and
                //answers the wrong question: somebody who read this a week ago
                //is not asking what it says, they are asking what is different
                //about it — and finding that by reading four pages and
                //remembering is how the edit nobody meant gets approved.
                //
                //ONLY WHEN THERE IS ONE TO COMPARE AGAINST. A copy is kept from
                //the first approval on, so anything approved before this app
                //could keep them is honestly lapsed with nothing behind it.
                var was = x.lapsed && kept.state && kept.state.newest ? kept.state.newest : null;

                ask({
                    title: 'Approve "' + (x.name || x.id) + '"?',
                    plain: [
                        K.read,
                        which == 'job'
                            ? 'It runs on a machine, as a worker, with whatever the prompt tells it.'
                            : which == 'prompt'
                                ? 'It is what a worker is told, word for word.'
                                : 'It is the rules a worker is given — what it may do and what it may not.',
                        x.lapsed
                            ? (was
                                ? 'It was approved before and has been edited since. On the left is what you read on '
                                    + day(was.at) + '; on the right is what you would be approving now.'
                                : 'It was approved before and has been edited since. No copy of what was read is '
                                    + 'kept — it was approved before this app kept them — so what follows is only '
                                    + 'the version as it stands now.')
                            : null,
                        //THE THING ITSELF, IN THE DIALOG — as a difference where
                        //there is something to differ from, and whole where
                        //there is not. A first approval is not a change to
                        //anything and drawing it as one would mark every line.
                        was
                            ? <Diff key="body" left={was.text} right={body || ''}
                                mode={which == 'job' ? 'javascript' : 'markdown'} height={300} />
                            : (body ? <Code key="body" text={body} mode={which == 'job' ? 'javascript' : undefined} /> : null)
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
                                            'The editor for this is not ported yet, so use the command line: '
                                                + (which == 'job' ? 'jobSave' : which == 'prompt' ? 'promptSave' : 'contractSave')
                                                + (mine ? ' --kind ' + mine : '')
                                                + '. Anything written that way waits here to be read.',
                                            //WITHOUT THE KIND IT LANDS IN THE OTHER LIBRARY, silently.
                                            //A job written from here and filed as a worker's is a job
                                            //that never appears on this pane again.
                                            mine ? 'The kind matters: written without it, it goes to the other library and does not appear here.' : null
                                        ],
                                        confirm: 'I see'
                                    });
                                }} />
                            </TitleRow>
                            <Finder value={find} onChange={setFind} placeholder={'find a ' + K.one} />
                            <Chips>
                                {chip('waiting', 'waiting to be read')}
                                {chip('lapsed', 'edited since')}
                                {mine ? null : chip('task', 'task')}
                                {mine ? null : chip('judge', 'judge')}
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

                                    {/*---- AND WHAT WAS APPROVED BEFORE ------

                                        A COPY HAS BEEN KEPT ON EVERY APPROVAL
                                        SINCE ../core/versions EXISTED, and until
                                        now nothing could look at one. The state
                                        this is for is `lapsed` — approved, then
                                        edited — where the app could say your
                                        agreement was stale and not what you had
                                        agreed TO.

                                        NOTHING HERE WHEN NOTHING IS KEPT, rather
                                        than an empty panel: the first approval is
                                        where a history starts, and a panel
                                        promising one before then is a promise
                                        about the past that cannot be kept. */}
                                    {kept.state && (kept.state.versions || []).length ? (
                                        <Panel>
                                            <CardTitle>
                                                {'Approved before'}{' '}
                                                <Badge kind="muted">{kept.state.versions.length + ' kept'}</Badge>
                                            </CardTitle>
                                            <CardSub>
                                                A copy is kept every time a person approves it — what they approved,
                                                and what changed to reach it.
                                            </CardSub>

                                            {/* NEWEST FIRST, AND THE FIRST CHIP
                                                IS THE ONE THAT STANDS. */}
                                            <Chips>
                                                {kept.state.versions.map(function (v, i) {
                                                    var mineNow = atVer ? atVer == v.at : i === 0;
                                                    return (
                                                        <Chip key={v.at} on={mineNow}
                                                            onClick={function () { setAtVer(i === 0 ? null : v.at); }}>
                                                            {day(v.at) + (v.first
                                                                ? ' · first'
                                                                : ' · +' + v.added + ' / -' + v.gone)}
                                                        </Chip>
                                                    );
                                                })}
                                            </Chips>

                                            {showing ? (
                                                <div>
                                                    <Kv>
                                                        <KvRow label="approved by">
                                                            {(showing.by || 'somebody') + ', ' + day(showing.at)}
                                                        </KvRow>
                                                        <KvRow label="what changed">{showing.note}</KvRow>
                                                        {/* WHY, WHERE THERE IS A REASON. A skill
                                                            carries the argument something made for
                                                            it; a contract edited at the window
                                                            carries nothing, and that is honest. */}
                                                        {showing.why ? <KvRow label="because">{showing.why}</KvRow> : null}
                                                    </Kv>

                                                    {/* THE FROZEN DIFF, NOT ONE WORKED OUT NOW.
                                                        It was computed against what was approved
                                                        BEFORE it and kept beside it, so what this
                                                        version was a change to cannot be quietly
                                                        rewritten by whatever is newest today.
                                                        `ace/mode/diff` is why that mode is
                                                        vendored. */}
                                                    {showing.first
                                                        ? <Code text={showing.text}
                                                            mode={which == 'job' ? 'javascript' : 'markdown'} tall />
                                                        : <Code text={showing.changed || ''} mode="diff" tall />}
                                                    {showing.first
                                                        ? <Note>
                                                            The first version kept of this, so it is not a change to
                                                            anything — what is above is the document as it was
                                                            approved.
                                                        </Note>
                                                        : null}

                                                    {/*---- AND WHAT HAS HAPPENED SINCE ------

                                                        THE ONE COMPARISON THAT IS NOT A RECORD.
                                                        Everything above is frozen; this is the
                                                        newest approved version against the
                                                        document as it stands, which is the
                                                        question somebody is actually asking when
                                                        the badge says "edited since it was
                                                        read". */}
                                                    {kept.state.lapsed && !atVer && on[K.body] ? (
                                                        <div>
                                                            <Note kind="warn">
                                                                And it has been edited since. What was approved is on
                                                                the left; what it says now is on the right, and only
                                                                that is what approving it again would agree to.
                                                            </Note>
                                                            <Diff left={showing.text} right={on[K.body]}
                                                                mode={which == 'job' ? 'javascript' : 'markdown'}
                                                                height={340} />
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : <Skeleton rows={3} />}
                                        </Panel>
                                    ) : null}
                                </div>
                            )}

                            <Note>{(state.note || '') + ' · read ' + reads + ' time(s), every 20s'}</Note>
                        </Col>
                    </Cols>
                </Pane>
            );
        };
    }

    return LibraryFor;
};
