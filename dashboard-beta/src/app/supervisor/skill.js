var React = require('react');

module.exports = function skill(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Code, ask
    } = theme;

    function Skill() {
        var [which, setWhich] = remember.use('skill', 'which', 'supervisor');
        var { state, error, again } = okc.use('skills', { which: which }, 0);

        //BEFORE THE EARLY RETURNS, WHICH IS NOT A STYLE CHOICE. A hook below one
        //is skipped on the renders that take it, and React counts hooks — the
        //pane came up with "Rendered more hooks than during the previous
        //render" the moment the first read landed. It said so on `broke`, which
        //is the one reason it was a minute's fault rather than a blank panel.
        var [said, setSaid] = React.useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var text = state.text || state.skill || '';

        //---- WHAT IS WAITING TO REPLACE IT ---------------------------------
        //
        //THE PANE HAD NOWHERE TO SHOW ONE. The supervisor can propose a change
        //to its own instructions — see ./server.js — and a proposal nobody can
        //see is one nobody answers, so it would sit in a drawer for ever while
        //the thing that asked went on being told no by silence.
        //
        //BELOW THE LIVE DOCUMENT, NEVER INSTEAD OF IT. What is served is what
        //this pane is for; a proposal is a second thing, read deliberately.
        var proposed = state.proposed || null;

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: (r && r.note) || 'Done.' }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        function approve() {
            ask({
                title: 'Make this the supervisor\u2019s skill?',
                plain: [
                    'It becomes the document fetched onto the machine at the head of the next waking, and every one after it.',
                    'The one it replaces is not kept — this pane shows what is served, and nothing else.',
                    'It asked for this because: ' + proposed.why
                ],
                cost: 'It changes what the supervisor believes it is, from its next waking on.',
                confirm: 'Approve it',
                protect: true,
                onYes: function () { return tell(okc.call('skillApprove', { which: which })); }
            });
        }

        function reject() {
            ask({
                title: 'Turn this down?',
                plain: [
                    'The proposal goes and the skill is unchanged.',
                    //THE REASON IS THE POINT, and the dialog says so rather than
                    //treating it as a form field: it is the only thing that
                    //changes what gets proposed next.
                    'Your reason is said into the conversation, which it reads at the head of every waking. It is the whole of what the next proposal has to go on \u2014 without it, the same one comes back.'
                ],
                fields: [
                    { name: 'why', label: 'Why not', needed: true, multiline: true, rows: 4,
                      placeholder: 'what is wrong with it, or what would have to be true for you to say yes' }
                ],
                confirm: 'Turn it down',
                danger: true,
                onYes: function (f) {
                    if (!(f.why || '').trim()) throw new Error('Say why. That sentence is the whole of what it learns.');
                    return tell(okc.call('skillReject', { which: which, why: f.why.trim() }));
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Panel>
                    <div className="head-row">
                        <CardTitle>{'Skill — ' + String(text).split('\n').length + ' lines'}</CardTitle>
                        <div className="head-controls">
                            {/* THE KIT'S `Chip`, NOT A HAND-ROLLED ONE. Writing
                                the class here put the literals "supervisor" and
                                "worker" inside a className={...}, where the guard
                                reads every string as a class name and rightly
                                reported two that do not exist. The rule it is
                                enforcing is the one that stops this: a pane does
                                not name classes. */}
                            <Chip on={which == 'supervisor'}
                                onClick={function () { setWhich('supervisor'); }}>the supervisor&apos;s skill</Chip>
                            <Chip on={which == 'worker'}
                                onClick={function () { setWhich('worker'); }}>a worker&apos;s skill</Chip>
                        </div>
                    </div>
                    <CardSub>
                        How it works: the loop, what it may propose, what it may never do. Fetched fresh
                        at the head of every turn, so a change here takes effect on the next waking.
                    </CardSub>
                    {/* A SKILL IS A MARKDOWN FILE, so it is read as one. */}
                    <Code text={text} mode="markdown" tall />
                    {/* EDITING IT IS NOT PORTED, and this is one to be careful
                        about rather than quick with: `skillSave` is refused while
                        the window holds unsaved edits, which is a whole
                        arrangement (`skillHolding`) that exists so two editors do
                        not overwrite each other. Half of it would be worse than
                        none. */}
                    <Note kind="warn">
                        Read only here. Saving is refused while a window holds unsaved edits — that
                        handshake is not ported, and half of it would be worse than none of it.
                    </Note>
                </Panel>

                {/*---- AND WHAT IT HAS ASKED FOR ---------------------------

                    A SEPARATE PANEL, BELOW. Reading what is served and deciding
                    on a change are two acts, and the second one is the only
                    thing on this tab that alters what a machine is given. */}
                {proposed ? (
                    <Panel>
                        <div className="head-row">
                            <CardTitle>
                                It has asked for a change{' '}
                                <Badge kind="warn">waiting on you</Badge>
                            </CardTitle>
                            <div className="head-controls">
                                <Button kind="ok" protect onClick={approve}>Approve it</Button>
                                <Button kind="danger" onClick={reject}>Turn it down</Button>
                            </div>
                        </div>

                        <Kv>
                            <KvRow label="because">{proposed.why}</KvRow>
                            <KvRow label="asked by">{proposed.by || 'not recorded'}</KvRow>
                            <KvRow label="asked at">{String(proposed.at || '').replace('T', ' ').slice(0, 16)}</KvRow>
                            {/* HOW MUCH BIGGER OR SMALLER, BEFORE READING EITHER.
                                A skill that halved is a different kind of
                                proposal from one that gained a paragraph. */}
                            <KvRow label="size">
                                {proposed.characters + ' characters, against ' + proposed.was}
                                <span className="muted">
                                    {' \u2014 ' + (proposed.characters >= proposed.was ? '+' : '')
                                        + (proposed.characters - proposed.was)}
                                </span>
                            </KvRow>
                            {proposed.replaced
                                ? <KvRow label="replaced">
                                    <span className="muted">{'an earlier proposal from '
                                        + String(proposed.replaced).replace('T', ' ').slice(0, 16)
                                        + ', which was never answered'}</span>
                                </KvRow>
                                : null}
                        </Kv>

                        <Note>
                            Nothing is served from this. The document above is what the next waking is
                            given, until this is approved.
                        </Note>
                        <Code text={proposed.text} mode="markdown" tall />
                    </Panel>
                ) : null}
            </Pane>
        );
    }

    return Skill;
};
