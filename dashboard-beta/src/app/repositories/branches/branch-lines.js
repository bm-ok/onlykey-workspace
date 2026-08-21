var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//THE LINES PANE: every named line, and why it exists.
//
//A LIST AND A DETAIL, not six expanded cards. Six lines with three repositories
//each is eighteen rows of mostly-identical branch names, and the reason a line
//exists — which is a paragraph somebody wrote at the time — is the thing worth
//reading and the thing that gets scrolled past. One at a time, with its reason
//in full.
//
//THE DEFAULT BRANCHES CARD IS FIRST AND IS NOT A LINE. It is what each
//repository counts from right now, read from git, and it is here because it is
//the answer to "what would a new line be made of" — and because a repository's
//own default is always protected whether or not any line names it.
//
//`marked` AND NOT `proposed`. The first version of this file read `g.proposed`,
//which the action has never returned, so the badge could not render and a line
//that WAS up for landing looked like any other. A field name that is nearly
//right is invisible: React renders `undefined` as nothing at all.
//---------------------------------------------------------------------------

module.exports = function lines(theme, okc, shell, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Plus, Card, CardTitle,
        Badge, Button, Empty, Note, Notice, Mono, Kv, KvRow, Skeleton, ask
    } = theme;

    var short = function (s) { return s ? String(s).slice(0, 7) : null; };
    var day = function (s) { return s ? String(s).slice(0, 10) : null; };

    //WHERE THE LINE AS A WHOLE STANDS, said as a word. `null` is not unknown: it
    //is a line origin has never seen any part of, which is ordinary for work
    //that has not gone anywhere yet.
    function Sync({ g }) {
        if (g.sync === 'conflict') return <Badge kind="bad">a part moved on both sides</Badge>;
        if (g.sync === 'behind') return <Badge kind="warn">a part is behind</Badge>;
        if (g.sync === 'ok') return <Badge kind="ok">in step</Badge>;
        return <Badge>never pushed</Badge>;
    }

    return function Lines() {
        var { state, error, reads, again } = okc.use('lines', {}, 10000);
        var [picked, setPicked] = remember.use('lines', 'line', null);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.lines || state.groups || [];
        var repos = state.repos || [];
        var on = all.filter(function (g) { return g.name === picked; })[0] || null;

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); }
            );
        }

        //NAMED FROM WHAT EACH REPOSITORY IS ON NOW, which is what `lineSave`
        //defaults to. A line is usually something somebody has just finished
        //arranging one repository at a time, and asking them to type it all
        //again is how the two drift apart.
        function name() {
            ask({
                title: 'Name a line',
                plain: [
                    'It names whatever branch each repository is on right now, so arrange them first and then name the arrangement.',
                    'Nothing is created and nothing is pushed — a line is a name for branches that already exist.',
                    'Its branches become protected: work is merged into a line and never done on one.'
                ],
                fields: [
                    { name: 'name', label: 'Name', placeholder: 'what this change is' },
                    { name: 'why', label: 'Why it exists', placeholder: 'what it is for, read six weeks from now' }
                ],
                confirm: 'Name it',
                onYes: function (f) {
                    if (!f.name) throw new Error('Give the line a name — it is what a task will be based on.');
                    return tell(okc.call('lineSave', { name: f.name, why: f.why })).then(function () { setPicked(f.name); });
                }
            });
        }

        function propose(g) {
            ask({
                title: 'Propose "' + g.name + '" for landing?',
                plain: [
                    'It appears on the left of a comparison, as the thing being proposed rather than the thing being worked on.',
                    'Nothing is pushed and nothing is merged. Its branches stay exactly as they are, and stay protected.',
                    'Withdraw it to carry on working.'
                ],
                fields: [{ name: 'why', label: 'Why it is ready', placeholder: 'what was done, and what says it is finished' }],
                confirm: 'Propose it',
                onYes: function (f) { return tell(okc.call('linePropose', { name: g.name, why: f.why })); }
            });
        }

        function forget(g) {
            ask({
                title: 'Forget the line "' + g.name + '"?',
                danger: true,
                plain: [
                    'The line is gone from this list. Its branches are untouched — nothing is deleted and nothing is pushed.',
                    //BOTH HALVES, because the second is not obvious from the word
                    //"forget" and is the one with a consequence.
                    'They also stop being protected by it, so work can be done directly on them again.'
                ],
                cost: 'Whatever this line was measured against goes with it, and a change made from it is no longer named.',
                confirm: 'Forget it',
                //A PERSON'S PRESS. It is not undoable from here — the name, the
                //reason and the arrangement are gone.
                protect: true,
                onYes: function () {
                    return tell(okc.call('lineForget', { name: g.name })).then(function () { setPicked(null); });
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                {error ? <Note kind="bad">{error}</Note> : null}

                <Note>
                    A line names one branch per repository, so work can be cut from a point rather
                    than from a branch at a time. A line is protected: work is merged into one and
                    never done on one, which is what keeps it clean enough to open pull requests from.
                </Note>

                <Cols>
                    <Col narrow>
                        {/* `Grow` IS A SPACER, NOT A WRAPPER — it renders an
                            empty span and takes no children. This read
                            `<Grow>Lines</Grow>` and the heading came out blank
                            in both columns, which looks exactly like a heading
                            somebody chose not to have. Same shape as the
                            `proposed` badge above: a name that is nearly right
                            renders as nothing at all. */}
                        <TitleRow>
                            Lines<Grow />
                            <Plus title="Name a line from what each repository is on now" onClick={name} />
                        </TitleRow>
                        <Stack>
                            {/* WHAT EACH REPOSITORY COUNTS FROM RIGHT NOW, read from
                                git rather than stored. Not a line, and first,
                                because it is what a new one would be made of. */}
                            <Card>
                                <CardTitle>Default branches</CardTitle>
                                <Kv>
                                    {repos.map(function (r) {
                                        return <KvRow key={r.repo} label={r.repo}><Mono>{r.on || '(none)'}</Mono></KvRow>;
                                    })}
                                </Kv>
                                <Note>
                                    A repository's own default, read from git and always protected. A branch is
                                    measured against the line it was cut from, not against these — except when it
                                    was cut before lines existed.
                                </Note>
                            </Card>

                            {all.map(function (g) {
                                return (
                                    <Card key={g.name} pick on={g.name === picked} onClick={function () { setPicked(g.name); }}>
                                        <CardTitle>
                                            <Mono>{g.name}</Mono>
                                            {g.marked ? <span>{' '}<Badge kind="run">proposed</Badge></span> : null}
                                        </CardTitle>
                                        <div className="muted">
                                            {(g.on || []).length + ' repositor' + ((g.on || []).length === 1 ? 'y' : 'ies')}
                                        </div>
                                    </Card>
                                );
                            })}
                        </Stack>
                        {!all.length ? <Empty>no lines yet — a line is what a change has to be before it can be compared or sent out</Empty> : null}
                    </Col>

                    <Col>
                        <TitleRow>{'What a line is — ' + all.length}<Grow /></TitleRow>
                        {!on ? <Panel><Empty>nothing picked</Empty></Panel> : (
                            <Panel>
                                <CardTitle>
                                    <Mono>{on.name}</Mono>{' '}
                                    <Sync g={on} />
                                    {on.marked ? <span>{' '}<Badge kind="run">proposed</Badge></span> : null}
                                </CardTitle>
                                {on.why ? <div className="muted">{on.why}</div> : null}

                                <Kv>
                                    {(on.on || []).map(function (p) {
                                        return (
                                            <KvRow key={p.repo} label={p.repo}>
                                                <Mono>{p.branch}</Mono>
                                                {/* WHERE IT IS, AND WHERE ORIGIN HAS IT. A
                                                    branch that is gone reads differently from
                                                    one that is there and has never moved. */}
                                                <span className="muted">{p.at ? '  ' + short(p.at) : ''}</span>
                                                {!p.there ? <span>{' '}<Badge kind="bad">gone</Badge></span> : null}
                                                {p.there && p.state && p.state !== 'same'
                                                    ? <span>{' '}<Badge kind={p.state === 'diverged' ? 'bad' : 'warn'}>{p.state}</Badge></span>
                                                    : null}
                                            </KvRow>
                                        );
                                    })}
                                </Kv>

                                {on.broken.length ? <Note kind="bad">{on.broken.join('; ')}</Note> : null}
                                {on.missing.length ? (
                                    //NOT A FAULT, and the wording says so.
                                    <Note>{'Not named in ' + on.missing.join(', ') + ' — a line made when there were fewer repositories still describes those.'}</Note>
                                ) : null}
                                {on.marked ? (
                                    <Note kind="warn">
                                        {'Proposed ' + (day(on.marked.at) || '') + (on.marked.by ? ' by ' + on.marked.by : '')
                                            + (on.marked.why ? ' — ' + on.marked.why : '')}
                                    </Note>
                                ) : null}

                                <div className="row">
                                    {on.marked
                                        ? <Button onClick={function () { return tell(okc.call('lineWithdraw', { name: on.name })); }}>
                                            Withdraw it
                                        </Button>
                                        : <Button kind="ok" onClick={function () { propose(on); }}>
                                            Propose it for landing
                                        </Button>}
                                    <Button kind="danger" protect onClick={function () { forget(on); }}>Forget it</Button>
                                </div>
                            </Panel>
                        )}
                    </Col>
                </Cols>

                <Note>{'read ' + reads + ' time(s), every 10s'}</Note>
            </Pane>
        );
    };
};
