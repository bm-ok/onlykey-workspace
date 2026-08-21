var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//the Board: every task, and what became of it.
//
//THE SAME THREE COLUMNS AS THE MACHINES: the list, what can be done to whatever
//is picked, and what that thing carries. One set of buttons serves every task.
//
//A TASK IS NOT A TICKET. It is a brief written under a job and a contract a
//person approved, given to a machine that claims a branch, which runs and hands
//something back. So the interesting columns are not "status" — they are WHAT IT
//WAS TOLD, WHAT IT RAN ON, and WHAT ARRIVED, and the last of those is the one
//that decides whether any of it was worth doing.
//
//"DONE" AND "DELIVERED" ARE DIFFERENT WORDS ON PURPOSE, and confusing them is
//the failure this pane exists to prevent. `state: done` means the run exited;
//`delivered` means something actually arrived on the branch. Three of the four
//most recent tasks here are done and undelivered, which is a real state and not
//a bug — a run can work for two minutes, exit 0, and commit nothing.
//
//AND EVERY ATTEMPT IS KEPT. A task that took four goes is a different thing
//from one that took one, and the timings say where the time went: bringing a
//machine up costs about thirty seconds before any work starts, every time.
//---------------------------------------------------------------------------

module.exports = function board(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Spec,
        Kv, KvRow, Notice, ask
    } = theme;

    var when = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : null; };
    var secs = function (ms) { return ms == null ? '' : (ms / 1000).toFixed(1) + 's'; };

    //`reads` IS THE FIELD TO TRUST, NOT `state`, and this pane nearly threw
    //that away by computing its own.
    //
    //The board works `reads` out from the BRANCH rather than from what somebody
    //last wrote down, and where the two disagree the branch wins. It exists
    //because of a specific incident: a run whose push was refused by the hook
    //was marked done, and the board called it delivered — with "1 commit(s)"
    //underneath, which was true of the branch and carried by the task BEFORE
    //it, and completely wrong about the run that had just lost its work.
    //
    //So the word comes from the action and only the colour is decided here.
    //Recomputing it from `state` and `delivered` would be a second opinion
    //about a question that was already settled the hard way.
    var LOOK = {
        'delivered': 'ok',
        'done, nothing arrived': 'warn',
        'done, nothing delivered': 'warn',
        'working': 'run',
        'running': 'run',
        'queued': '',
        'draft': 'muted'
    };
    function state(t) {
        var word = t.reads || t.state || 'written';
        return { kind: LOOK[word] === undefined ? '' : LOOK[word], word: word };
    }

    function Row({ t, on, onPick }) {
        var s = state(t);
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    <Mono>{'#' + t.number}</Mono>
                    <Badge kind={s.kind}>{s.word}</Badge>
                    {t.tag ? <Badge kind="muted">{t.tag}</Badge> : null}
                </CardTitle>
                <CardSub>{t.title}</CardSub>
                {t.branch ? <CardSub>{'on '}<Mono>{t.branch}</Mono></CardSub> : null}
                {/* HOW MANY GOES IT TOOK, on the card, because a task that was
                    tried four times is a different thing from one that worked
                    first time and the list is where you notice. */}
                {(t.attempts || []).length > 1
                    ? <CardSub>{t.attempts.length + ' attempts'}</CardSub>
                    : null}
            </Card>
        );
    }

    return function Board() {
        var { state: got, error, reads, again } = okc.use('tasks', {}, 10000);
        var [find, setFind] = useState('');
        var [only, setOnly] = remember.use('tasks', 'only', null);
        var [picked, setPicked] = remember.use('tasks', 'picked', null);
        var [said, setSaid] = useState(null);

        if (!got && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!got) return <Pane><Skeleton rows={5} /></Pane>;

        var all = got.tasks || [];
        var word = function (t) { return t.reads || t.state || ''; };
        var counts = {
            running: all.filter(function (t) { return word(t) == 'working' || word(t) == 'running'; }).length,
            queued: all.filter(function (t) { return word(t) == 'queued'; }).length,
            undelivered: all.filter(function (t) { return word(t).indexOf('nothing') >= 0; }).length,
            delivered: all.filter(function (t) { return word(t) == 'delivered'; }).length
        };

        var rows = all.filter(function (t) {
            var hay = ('#' + t.number + ' ' + (t.title || '') + ' ' + (t.branch || '')).toLowerCase();
            if (find && hay.indexOf(find.toLowerCase()) < 0) return false;
            //FILTERED ON THE SAME WORD THAT IS SHOWN. Filtering on `state`
            //while displaying `reads` is how a chip called "nothing delivered"
            //comes back with rows that say "delivered".
            var word = t.reads || t.state || '';
            if (only == 'running') return word == 'working' || word == 'running';
            if (only == 'queued') return word == 'queued';
            if (only == 'undelivered') return word.indexOf('nothing') >= 0;
            if (only == 'delivered') return word == 'delivered';
            return true;
        });

        var on = all.filter(function (t) { return String(t.number) == String(picked); })[0] || null;

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note || 'Done.' }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        function finish(t) {
            ask({
                title: 'Finish #' + t.number + ' by hand?',
                plain: [
                    'It comes off the board as done, without a run.',
                    'Nothing on the branch changes. This says a person dealt with it, which is a real ending — not every task is finished by a machine.',
                    t.machine ? 'It is on ' + t.machine + '. Finishing it here does not put that machine away.' : null
                ],
                confirm: 'Finish it',
                onYes: function () { return tell(okc.call('taskFinished', { id: t.id || t.number })); }
            });
        }

        function bin(t) {
            ask({
                title: 'Throw #' + t.number + ' away?',
                plain: [
                    'The task and its history go. Anything already committed on its branch stays.',
                    (t.attempts || []).length
                        ? 'It has ' + t.attempts.length + ' attempt(s) recorded — what those runs did is the only account of them, and it goes too.'
                        : null
                ],
                cost: 'The record of what was asked and what happened cannot be brought back.',
                confirm: 'Throw it away',
                danger: true,
                onYes: function () {
                    return tell(okc.call('taskForget', { id: t.id || t.number })).then(function () { setPicked(null); });
                }
            });
        }

        var chip = function (key, word) {
            return <Chip on={only == key} count={counts[key]}
                onClick={function () { setOnly(only == key ? null : key); }}>{word}</Chip>;
        };

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                {error ? <Note kind="bad">{error}</Note> : null}

                <Cols>
                    <Col narrow>
                        <TitleRow>Tasks<Grow /><span className="muted">{all.length}</span></TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a task" />
                        <Chips>
                            {chip('running', 'running')}
                            {chip('queued', 'queued')}
                            {/* THE CHIP WORTH HAVING. "Done" hides this; a run
                                that exited cleanly and committed nothing looks
                                finished on every other list in the app. */}
                            {chip('undelivered', 'nothing delivered')}
                            {chip('delivered', 'delivered')}
                        </Chips>
                        <Stack>
                            {rows.length
                                ? rows.map(function (t) {
                                    return <Row key={t.number} t={t} on={String(t.number) == String(picked)}
                                        onPick={function () { setPicked(String(t.number)); }} />;
                                })
                                : <Empty>{all.length ? 'nothing matches' : 'no task has been written yet'}</Empty>}
                        </Stack>
                    </Col>

                    <Col>
                        <h2>Task <span className="muted">{on ? '— #' + on.number : '— nothing selected'}</span></h2>
                        {!on ? <Panel><Empty>pick a task on the left</Empty></Panel> : (
                            <div>
                                <Panel>
                                    <div className="row">
                                        <Button
                                            disabled={String(on.state) == 'done'}
                                            title={String(on.state) == 'done' ? 'it is already finished' : 'take it off the board by hand'}
                                            onClick={function () { finish(on); }}>Finish it</Button>
                                        <Button kind="danger" onClick={function () { bin(on); }}>Throw it away</Button>
                                    </div>
                                    {/* NOT PORTED, AND NAMED. Over there these open
                                        an editor and a shell against the task's
                                        branch — both are nw affordances tied to
                                        the terminal pane, which is not here yet. */}
                                    <Note>
                                        &ldquo;Work on it in VS Code&rdquo; and &ldquo;in a terminal&rdquo; are not built
                                        here yet — they need the Terminal tab.
                                    </Note>
                                </Panel>

                                <Panel>
                                    <CardTitle>{on.title}</CardTitle>
                                    <Kv>
                                        <KvRow label="state">{state(on).word}</KvRow>
                                        <KvRow label="on"><Mono>{on.branch || 'no branch'}</Mono></KvRow>
                                        {/* WHAT IT WAS TOLD, AND UNDER WHAT. A task
                                            exists under a job and a contract a
                                            person approved; without those named
                                            here, "who allowed this" has no answer
                                            on the screen it happened on. */}
                                        <KvRow label="job">{on.jobName || on.job || <span className="muted">none</span>}</KvRow>
                                        <KvRow label="told">{on.promptName || on.promptId || <span className="muted">none</span>}</KvRow>
                                        <KvRow label="under">{on.contractName || on.contractId || <span className="muted">no contract</span>}</KvRow>
                                        {on.becauseOf
                                            ? <KvRow label="because of"><Mono>{on.becauseOf}</Mono></KvRow>
                                            : null}
                                        <KvRow label="for">{on.tag ? <Badge kind="muted">{on.tag}</Badge> : <span className="muted">any machine</span>}</KvRow>
                                        <KvRow label="written">{when(on.created) || 'unknown'}</KvRow>
                                        {on.machine ? <KvRow label="last machine"><Mono>{on.machine}</Mono></KvRow> : null}
                                    </Kv>
                                    {on.brief
                                        ? <Spec summary="the brief it was given"><div className="console short">{on.brief}</div></Spec>
                                        : null}
                                </Panel>

                                <Panel>
                                    <CardTitle>{'Attempts — ' + (on.attempts || []).length}</CardTitle>
                                    {(on.attempts || []).length ? (
                                        <Kv>
                                            {on.attempts.map(function (a, i) {
                                                var sp = a.spent || {};
                                                return (
                                                    <KvRow key={i} label={when(a.at) || ('#' + (i + 1))}>
                                                        <div><Mono>{a.machine || '?'}</Mono></div>
                                                        {/* WHERE THE TIME WENT, and the
                                                            answer is usually "bringing a
                                                            machine up" — about thirty
                                                            seconds before any work starts,
                                                            every single time. */}
                                                        <div className="muted">
                                                            {'up ' + secs(sp.bringUp) + ' · key ' + secs(sp.credential)
                                                                + ' · folder ' + secs(sp.workspace) + ' · work ' + secs(sp.work)
                                                                + ' · ' + secs(sp.total) + ' total'}
                                                        </div>
                                                    </KvRow>
                                                );
                                            })}
                                        </Kv>
                                    ) : <Empty>it has not been run</Empty>}
                                </Panel>
                            </div>
                        )}
                    </Col>

                    <Col wide>
                        <h2>What arrived</h2>
                        {!on ? <Panel><Empty>nothing picked</Empty></Panel> : (
                            <div>
                                <Panel>
                                    <CardTitle>
                                        {state(on).word}
                                        <Badge kind={state(on).kind}>
                                            {(on.commits || 0) + ' commit(s)'}
                                        </Badge>
                                    </CardTitle>
                                    {/* THE DISTINCTION THE WHOLE PANE IS FOR. A run
                                        that exits 0 having committed nothing is
                                        "done" everywhere else in this app. */}
                                    <CardSub>
                                        {/* AND THE COUNT IS ABOUT THE BRANCH, NOT
                                            THE RUN. That is exactly how "1
                                            commit(s)" once appeared under a run
                                            that had lost its work — the commit
                                            belonged to the task before it. */}
                                        {state(on).word == 'delivered'
                                            ? 'Something arrived on the branch.'
                                            : 'Nothing arrived on the branch — which is a real answer, not a missing one. The commit count is about the BRANCH, so it can be more than zero while this run delivered nothing.'}
                                    </CardSub>
                                    {typeof on.artifact == 'string'
                                        ? <Note>{on.artifact}</Note>
                                        : null}
                                </Panel>

                                {on.session
                                    ? <Panel>
                                        <CardTitle>The session</CardTitle>
                                        <CardSub><Mono>{String(on.session)}</Mono></CardSub>
                                        <Note>What it was actually asked and what it said is on Runners → Claude Sessions.</Note>
                                    </Panel>
                                    : null}

                                {on.verdict
                                    ? <Panel>
                                        <CardTitle>Judged</CardTitle>
                                        <CardSub>{String(on.verdict)}</CardSub>
                                    </Panel>
                                    : null}
                            </div>
                        )}
                        <Note>{'read ' + reads + ' time(s), every 10s'}</Note>
                    </Col>
                </Cols>
            </Pane>
        );
    };
};
