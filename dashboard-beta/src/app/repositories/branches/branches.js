var React = require('react');
var { useState } = React;

module.exports = function branches(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Plus, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Spec,
        Kv, KvRow, Notice, ask
    } = theme;

    function Row({ b, on, onPick }) {
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    <Mono>{b.name}</Mono>
                    {/* PROTECTED IS NOT A WARNING, IT IS A FACT ABOUT WHAT MAY
                        HAPPEN NEXT. A branch in a line is refused pushes from
                        machines — that is the whole point of making it one, and
                        somebody looking at a stalled task needs to see it here
                        rather than in the refusal that stopped them. */}
                    {b.protected ? <Badge kind="run">protected</Badge> : null}
                    {/* AN EMPTY ARRAY IS TRUTHY, and this drew a red "gone" on
                        every branch on the pane including ones plainly present
                        in three of three. `gone` is the LIST of repositories it
                        has disappeared from, so the test is its length — and the
                        badge should say which, because "gone from local-repo-b"
                        is actionable and "gone" is alarming and useless.

                        Second time today: the same shape caught `e.stdout ||
                        e.stderr` in tools/walk.js, where an empty Buffer won the
                        `||` and the real message on stderr was never read. */}
                    {(b.gone || []).length
                        ? <Badge kind="bad" title={'gone from ' + b.gone.join(', ')}>
                            {'gone from ' + b.gone.length}
                        </Badge>
                        : null}
                    {b.orphaned ? <Badge kind="warn">orphaned</Badge> : null}
                    {b.spare ? <Badge kind="muted">spare</Badge> : null}
                </CardTitle>

                {/* IN HOW MANY, AND WHICH. A branch that is in two of three
                    repositories is an ordinary state and also the one that
                    surprises people — so the count leads and the names follow. */}
                <CardSub>
                    {(b.in || []).length + ' of ' + ((b.in || []).length + (b.missing || []).length) + ' repositories'}
                    {b.group ? <span>{' · cut from '}<Mono>{b.group}</Mono></span> : null}
                </CardSub>

                {b.heldBy
                    ? <CardSub>{'held by '}<Mono>{b.heldBy}</Mono>{b.heldRunning ? ', running' : ''}</CardSub>
                    : null}

                {/* THE SUMMARY IS ABOUT THE BRANCH AND NOT ABOUT A RUN, which is
                    a distinction this app has already paid for once: "1 commit
                    in local-repo-b" was read as "the run did something" when the
                    run had been refused and the commit was three days old. */}
                {b.summary ? <CardSub>{b.summary}</CardSub> : null}
            </Card>
        );
    }

    //---- the right column --------------------------------------------------

    function Carries({ branch }) {
        var { state, error } = okc.use('branchArtifacts', { branch: branch }, 0);

        if (!state && error) return <Panel><Note kind="bad">{error}</Note></Panel>;
        if (!state) return <Panel><Skeleton rows={2} /></Panel>;

        var git = state.git || {};
        var repos = (git.repos || []).filter(function (r) { return !r.missing; });
        var tasks = state.tasks || [];
        var files = state.files || [];
        var session = state.session || {};

        return (
            <div>
                <Panel>
                    <CardTitle>Commits</CardTitle>
                    <CardSub>{git.summary || 'nothing has arrived on this branch yet'}</CardSub>
                    {repos.length ? (
                        <Kv>
                            {repos.map(function (r) {
                                return (
                                    <KvRow key={r.repo} label={r.repo}>
                                        {r.ahead
                                            ? r.ahead + ' commit' + (r.ahead == 1 ? '' : 's') + ' past ' + r.base
                                            : <span className="muted">{'level with ' + r.base}</span>}
                                    </KvRow>
                                );
                            })}
                        </Kv>
                    ) : <Empty>this branch is not in any repository here</Empty>}

                    {(git.commits || []).length ? (
                        <Spec summary={(git.commits || []).length + ' commit(s)'}>
                            <Kv>
                                {git.commits.map(function (c, i) {
                                    return <KvRow key={i} label={(c.sha || '').slice(0, 7)}>{c.subject || c.message || ''}</KvRow>;
                                })}
                            </Kv>
                        </Spec>
                    ) : null}
                </Panel>

                <Panel>
                    <CardTitle>Tasks on it</CardTitle>
                    {tasks.length ? (
                        <Stack>
                            {tasks.map(function (t) {
                                return (
                                    <Card key={t.task || t.number}>
                                        <CardTitle>
                                            <Mono>{'#' + t.number}</Mono>
                                            <Badge kind={t.state == 'done' ? 'ok' : t.state == 'failed' ? 'bad' : ''}>{t.state}</Badge>
                                        </CardTitle>
                                        <CardSub>{t.title}</CardSub>
                                        {t.machine ? <CardSub>{'on '}<Mono>{t.machine}</Mono></CardSub> : null}
                                    </Card>
                                );
                            })}
                        </Stack>
                    ) : <Empty>no task has been given this branch</Empty>}
                </Panel>

                {/* A FILE A BRANCH CANNOT HOLD. A run can hand back a report, a
                    screenshot, a diff it was asked not to commit — and none of
                    that is in git. Left off this pane it is work that exists and
                    cannot be found, which is the same as work thrown away. */}
                <Panel>
                    <CardTitle>Files handed back</CardTitle>
                    {files.length ? (
                        <Kv>
                            {files.map(function (f, i) {
                                return <KvRow key={i} label={f.name || f.path || 'a file'}>{f.about || f.bytes || ''}</KvRow>;
                            })}
                        </Kv>
                    ) : <Empty>nothing was handed back outside git</Empty>}
                </Panel>

                <Panel>
                    <CardTitle>The session that made it</CardTitle>
                    {session.kept
                        ? <CardSub>{session.about || 'kept'}</CardSub>
                        : <Empty>{session.why || 'no session was kept for this branch'}</Empty>}
                </Panel>
            </div>
        );
    }

    //---- the pane ----------------------------------------------------------

    function Branches() {
        var { state, error, reads, again } = okc.use('branchBoard', {}, 10000);
        var [find, setFind] = useState('');
        var [only, setOnly] = remember.use('branches', 'only', null);
        var [picked, setPicked] = remember.use('branches', 'picked', null);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={5} /></Pane>;

        var all = state.branches || [];
        var counts = state.counts || {};

        var rows = all.filter(function (b) {
            if (find && b.name.toLowerCase().indexOf(find.toLowerCase()) < 0) return false;
            if (only == 'protected') return !!b.protected;
            if (only == 'claimed') return !!b.heldBy;
            if (only == 'orphaned') return !!b.orphaned;
            if (only == 'spare') return !!b.spare;
            return true;
        });

        var on = all.filter(function (b) { return b.name == picked; })[0] || null;

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note || 'Done.' }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        //CUTTING ONE ASKS FOR A REASON, and the reason is not decoration: it is
        //what somebody reads in six weeks when they find the branch and have to
        //decide whether it can go.
        function cut() {
            ask({
                title: 'Cut a branch',
                plain: [
                    'The same branch name in every repository, made from a line so every half starts level.',
                    'It is made here and pushed nowhere. Nothing on GitHub changes.'
                ],
                fields: [
                    { name: 'branch', label: 'Name', placeholder: 'fix/the-thing', hint: 'the same name in every repository — that is what makes it one change' },
                    { name: 'reason', label: 'Why', placeholder: 'what this is for', hint: 'read by whoever finds this branch later and has to decide whether it can go' },
                    {
                        name: 'group', label: 'Cut from', value: 'default',
                        options: (state.baselines || []).map(function (g) { return { value: g.branch, label: g.branch }; }),
                        hint: 'the line every half starts level with'
                    }
                ],
                confirm: 'Cut it',
                onYes: function (f) {
                    if (!f.branch) throw new Error('It needs a name.');
                    if (!f.reason) throw new Error('It needs a reason — that is the whole point of cutting one deliberately.');
                    return tell(okc.call('branchCreate', { branch: f.branch, reason: f.reason, group: f.group }))
                        .then(function () { setPicked(f.branch); });
                }
            });
        }

        function asLine(b) {
            ask({
                title: 'Make "' + b.name + '" a line?',
                plain: [
                    'A line is one branch per repository, moved and compared as one thing. This moves nothing — it names what is already there.',
                    //THE PROTECTION IS THE POINT AND IT IS EASY TO MISS. This
                    //was once described as only a naming act, and somebody then
                    //could not work out why their worker was being refused.
                    'AND IT PROTECTS THE BRANCH: no machine may push to it afterwards. Work goes onto its own branch and is merged here, which is what makes chaining safe.',
                    'The exception is while it is out as an unmerged pull request, so a change can still be revised after review.'
                ],
                fields: [
                    { name: 'name', label: 'Call the line', value: b.name, hint: 'what it will be known as when comparing and sending' },
                    { name: 'why', label: 'Why', placeholder: 'what this line is for' }
                ],
                cost: 'Machines stop being able to push to ' + b.name + '.',
                confirm: 'Make it a line',
                onYes: function (f) {
                    return tell(okc.call('branchAsLine', { branch: b.name, name: f.name || b.name, why: f.why || undefined }));
                }
            });
        }

        function remove(b) {
            ask({
                title: 'Delete "' + b.name + '"?',
                plain: [
                    'From every repository that has it, here on this host.',
                    b.summary || null,
                    //REFUSED IS A REAL ANSWER AND IT IS SHOWN BEFORE THE PRESS,
                    //not after. Half of what this app does is refuse, and a
                    //dialog that hides the refusal until you confirm teaches
                    //people to confirm and read afterwards.
                    b.removable ? null : (b.whyNot || 'Something is holding it.')
                ],
                cost: 'Anything on it that was never merged or handed back is gone.',
                confirm: 'Delete it',
                danger: true,
                onYes: function () {
                    return tell(okc.call('branchDelete', { branch: b.name })).then(function () { setPicked(null); });
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
                        <TitleRow>
                            Branch cuts<Grow />
                            <Plus title="Cut a branch, with a reason" onClick={cut} />
                        </TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a branch" />
                        <Chips>
                            {chip('protected', 'protected')}
                            {chip('claimed', 'claimed')}
                            {chip('orphaned', 'orphaned')}
                            {chip('spare', 'spare')}
                        </Chips>
                        <Stack>
                            {rows.length
                                ? rows.map(function (b) {
                                    return <Row key={b.name} b={b} on={b.name == picked}
                                        onPick={function () { setPicked(b.name); }} />;
                                })
                                : <Empty>{all.length ? 'nothing matches' : 'no branch has been cut yet'}</Empty>}
                        </Stack>
                    </Col>

                    <Col>
                        <h2>Actions <span className="muted">{on ? '— ' + on.name : '— nothing selected'}</span></h2>
                        <Panel>
                            {!on ? <Empty>pick a branch on the left</Empty> : (
                                <div>
                                    <div className="row">
                                        <Button
                                            disabled={!!on.protected}
                                            title={on.protected ? 'it is already a line' : 'name it, so it can be compared and sent'}
                                            onClick={function () { asLine(on); }}>Make it a line</Button>

                                        {/* DISABLED WITH THE REASON IN THE TITLE,
                                            rather than absent. A person who
                                            cannot delete a branch wants to know
                                            what is holding it, and that sentence
                                            already exists. */}
                                        <Button kind="danger"
                                            disabled={!on.removable}
                                            title={on.removable ? 'delete it from every repository here' : (on.whyNot || 'something is holding it')}
                                            onClick={function () { remove(on); }}>Delete it</Button>
                                    </div>

                                    {on.why ? <Note kind="warn">{on.why}</Note> : null}
                                    {on.heldBy
                                        ? <Note kind="warn">{'Held by ' + on.heldBy + (on.heldRunning ? ', which is running.' : '.')}</Note>
                                        : null}
                                </div>
                            )}
                        </Panel>

                        {on ? (
                            <Panel>
                                <CardTitle>What it is</CardTitle>
                                <Kv>
                                    <KvRow label="in">{(on.in || []).join(', ') || 'nowhere'}</KvRow>
                                    {(on.missing || []).length
                                        ? <KvRow label="not in">{on.missing.join(', ')}</KvRow>
                                        : null}
                                    <KvRow label="cut from">{on.group ? <Mono>{on.group}</Mono> : <span className="muted">not recorded</span>}</KvRow>
                                    {(on.asDefault || []).length
                                        ? <KvRow label="is the default in">{on.asDefault.join(', ')}</KvRow>
                                        : null}
                                </Kv>
                                {on.note ? <Note>{on.note}</Note> : null}
                            </Panel>
                        ) : null}
                    </Col>

                    <Col wide>
                        <h2>What it carries</h2>
                        {on
                            ? <Carries key={on.name} branch={on.name} />
                            : <Panel><Empty>nothing picked</Empty></Panel>}
                        <Note>{'read ' + reads + ' time(s), every 10s'}</Note>
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Branches;
};
