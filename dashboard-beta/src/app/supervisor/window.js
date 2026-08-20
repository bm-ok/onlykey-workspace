var React = require('react');
var { useState, useEffect, useRef } = React;
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//the Supervisor: the conversation with it, and what it is allowed to do.
//
//A SUPERVISOR IS A CLAUDE RUNNING ON ITS OWN MACHINE, signed in as its own
//identity, that watches this workspace and proposes work. It is not a chat
//window with a model behind it — it wakes, reads what changed since its
//bookmark, decides, and goes back to sleep.
//
//WHICH IS WHY THERE IS NOWHERE TO TYPE WHEN IT IS DOWN. Anything said while the
//machine is off would sit unread until one is up, so the pane says so and offers
//to start it instead of taking a message it cannot deliver. A composer that
//accepts text nothing will read is a lie with a send button.
//
//AND WHAT IT MAY DO IS READ ONLY, which is the strongest thing on this tab. The
//permission list is not a setting — it changes in a checkout, in a commit, with
//a message. A permission list that anything reaching this app could edit is not
//a permission list, and a supervisor that could widen its own is not supervised.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Code, ask
    } = theme;

    var when = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; };

    //---- the conversation --------------------------------------------------

    function Chat() {
        var state = useAsk(okc, 'supervisorState', {}, 10000);
        var talk = useAsk(okc, 'chat', {}, 5000);
        var [text, setText] = useState('');
        var [said, setSaid] = useState(null);
        var [sending, setSending] = useState(false);
        var bottom = useRef(null);

        //THE LAST THING SAID IS THE ONE BEING READ. A conversation that opens at
        //the top is one somebody scrolls every time they look at it.
        var count = talk.state ? (talk.state.messages || []).length : 0;
        useEffect(function () {
            if (bottom.current) bottom.current.scrollIntoView({ block: 'end' });
        }, [count]);

        if (!state.state && state.error) return <Pane><Note kind="bad">{state.error}</Note></Pane>;
        if (!state.state) return <Pane><Skeleton rows={3} /></Pane>;

        var sup = state.state;
        var msgs = (talk.state && talk.state.messages) || [];

        function send() {
            var t = text.trim();
            if (!t) return;
            setSending(true);
            okc.call('chatSay', { text: t }).then(
                function () { setText(''); setSending(false); talk.again(); },
                function (e) { setSaid({ bad: true, text: e.message }); setSending(false); }
            );
        }

        //NOT RUNNING IS A WHOLE STATE, not a disabled button.
        if (!sup.ready) {
            return (
                <Pane>
                    {said ? <Notice kind="bad" onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                    <Panel>
                        <CardTitle>{(sup.name || 'the supervisor') + ' is not running.'}</CardTitle>
                        <CardSub>{sup.why || sup.note || 'it is not ready'}</CardSub>
                        <div className="row" style={{ marginTop: '10px' }}>
                            <Button kind="ok"
                                onClick={function () {
                                    ask({
                                        title: 'Start ' + sup.name + '?',
                                        plain: [
                                            'It boots the machine and waits for it to dial in. Nothing is asked of the model by starting it.',
                                            'It is a whole machine, so this takes a minute or two.'
                                        ],
                                        confirm: 'Start it',
                                        onYes: function () {
                                            return okc.call('vmStart', { name: sup.name }).then(
                                                function (r) { setSaid({ text: r.note || 'Starting.' }); state.again(); },
                                                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                                            );
                                        }
                                    });
                                }}>{'Start ' + sup.name}</Button>
                        </div>
                        {/* THE REASON THERE IS NO BOX TO TYPE IN, said rather
                            than left as an absence somebody reads as a bug. */}
                        <Note>
                            Anything said while it is down would wait unread until one is up, so there is
                            nowhere to type until then.
                        </Note>
                    </Panel>

                    <Panel>
                        <CardTitle>{'What was said — ' + msgs.length}</CardTitle>
                        <Messages msgs={msgs} bottom={bottom} />
                    </Panel>
                </Pane>
            );
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Panel>
                    <CardTitle>
                        <Mono>{sup.name}</Mono>
                        <Badge kind="ok">running</Badge>
                        {sup.thinking ? <Badge kind="run">thinking</Badge> : null}
                        {talk.state && talk.state.missed ? <Badge kind="warn">{talk.state.missed + ' unread by it'}</Badge> : null}
                    </CardTitle>
                    <Messages msgs={msgs} bottom={bottom} />
                </Panel>

                <Panel>
                    <div className="writer">
                        <textarea rows={3} value={text} placeholder="say something to the supervisor"
                            onChange={function (e) { setText(e.target.value); }} />
                    </div>
                    <div className="row">
                        {/* IT READS THIS WHEN IT NEXT WAKES, which is not the
                            same as now. Said on the button rather than found out
                            by watching nothing happen. */}
                        <Button kind="ok" disabled={sending || !text.trim()}
                            title="it reads this when it next asks what is new"
                            onClick={send}>{sending ? 'sending…' : 'Say it'}</Button>
                        <Button
                            title="wake it now instead of waiting for its own turn"
                            onClick={function () {
                                ask({
                                    title: 'Wake ' + sup.name + ' now?',
                                    plain: [
                                        'One turn of its model: it reads what changed since its bookmark, decides, and answers.',
                                        'It would do this on its own eventually. Waking it is asking for that turn now.'
                                    ],
                                    cost: 'One turn against its account.',
                                    fields: [{ name: 'why', label: 'Why', placeholder: 'what you want it to look at' }],
                                    confirm: 'Wake it',
                                    onYes: function (f) {
                                        return okc.call('supervisorWake', { name: sup.name, why: f.why || undefined }).then(
                                            function (r) { setSaid({ text: r.note || 'Woken.' }); },
                                            function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                                        );
                                    }
                                });
                            }}>Wake it</Button>
                    </div>
                </Panel>
            </Pane>
        );
    }

    //A MESSAGE SAYS WHO AND HOW IT ARRIVED. `via` is the difference between a
    //person typing and something on the wire, and it is the whole reason a
    //conversation is worth keeping rather than just the answers.
    function Messages({ msgs, bottom }) {
        if (!msgs.length) return <Empty>nothing has been said yet</Empty>;
        return (
            <div className="console tall">
                {msgs.map(function (m) {
                    var mine = m.who == 'you' || m.who == 'the person';
                    return (
                        <div className={'msg ' + (mine ? 'mine' : 'theirs')} key={m.n}>
                            <div className="msg-who">
                                {m.who}
                                {m.via ? <span className="muted">{' · ' + m.via}</span> : null}
                                {m.about ? <span className="muted">{' · ' + m.about}</span> : null}
                                <span className="muted">{' · ' + when(m.at)}</span>
                            </div>
                            <div className="msg-body">{m.text}</div>
                        </div>
                    );
                })}
                <div ref={bottom} />
            </div>
        );
    }

    //---- what it may do ----------------------------------------------------

    function May() {
        var { state, error } = useAsk(okc, 'supervisorMay', {}, 0);
        var [find, setFind] = useState('');

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.may || [];
        var rows = all.filter(function (a) {
            if (!find) return true;
            return ((a.action || '') + ' ' + (a.why || '')).toLowerCase().indexOf(find.toLowerCase()) >= 0;
        });

        return (
            <Pane>
                {/* THE STRONGEST SENTENCE ON THIS TAB, and it is why there are no
                    buttons here at all. A permission list that anything reaching
                    this app could edit is not a permission list — and a
                    supervisor able to widen its own is not supervised. This
                    changes in a checkout, in a commit, with a message. */}
                <Note kind="warn">
                    <strong>Read only. </strong>
                    A permission list that anything reaching this app could edit is not a permission
                    list — this changes in a checkout, in a commit, with a message. The reasons below
                    are what the supervisor is shown when it asks what it may do.
                </Note>

                <Panel>
                    <CardTitle>{'What it may do — ' + all.length + ' action(s)'}</CardTitle>
                    <Finder value={find} onChange={setFind} placeholder="find an action" />
                    {rows.length ? (
                        <Kv>
                            {rows.map(function (a) {
                                return <KvRow key={a.action} label={a.action}>{a.why}</KvRow>;
                            })}
                        </Kv>
                    ) : <Empty>nothing matches</Empty>}
                </Panel>
                {state.note ? <Note>{state.note}</Note> : null}
            </Pane>
        );
    }

    //---- the list ----------------------------------------------------------

    function Todo() {
        var { state, error, again } = useAsk(okc, 'todos', {}, 15000);
        var [only, setOnly] = remember.use('todo', 'only', null);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.todos || state.list || [];
        var rows = only ? all.filter(function (t) { return t.state == only; }) : all;

        function add() {
            ask({
                title: 'Put something on the list',
                plain: ['What is to be done, and why. The supervisor reads this list when it wakes.'],
                fields: [
                    { name: 'what', label: 'What', placeholder: 'what is to be done' },
                    { name: 'why', label: 'Why', placeholder: 'why it matters', multiline: true, rows: 3 }
                ],
                confirm: 'Put it on',
                onYes: function (f) {
                    if (!f.what) throw new Error('It needs a description.');
                    return okc.call('todoAdd', { what: f.what, why: f.why || undefined }).then(
                        function (r) { setSaid({ text: r.note || 'Added.' }); again(); },
                        function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                    );
                }
            });
        }

        var states = {};
        all.forEach(function (t) { states[t.state] = (states[t.state] || 0) + 1; });

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Panel>
                    <CardTitle>{'The list — ' + all.length}</CardTitle>
                    <div className="row">
                        <Button onClick={add}>Put something on the list</Button>
                    </div>
                    <Chips>
                        {Object.keys(states).map(function (k) {
                            return (
                                <Chip key={k} on={only == k} count={states[k]}
                                    onClick={function () { setOnly(only == k ? null : k); }}>{k}</Chip>
                            );
                        })}
                    </Chips>
                </Panel>
                <Stack>
                    {rows.length ? rows.map(function (t) {
                        return (
                            <Card key={t.id}>
                                <CardTitle>
                                    <span>{t.what}</span>
                                    <Badge kind={t.state == 'done' ? 'ok' : t.state == 'doing' ? 'run' : ''}>{t.state}</Badge>
                                </CardTitle>
                                {t.why ? <CardSub>{t.why}</CardSub> : null}
                                <CardSub><Mono>{t.id}</Mono></CardSub>
                            </Card>
                        );
                    }) : <Empty>nothing on the list</Empty>}
                </Stack>
                {/* TAKING SOMETHING OFF FOR GOOD IS A PERSON IN THE WINDOW — the
                    action says so itself, and a supervisor marks things done
                    instead. Not ported here, and saying so beats a button that
                    would be refused. */}
                <Note>
                    Taking something off the list for good is a person in the window; a supervisor
                    marks things done instead. That is not built here yet — use `todoRemove`.
                </Note>
            </Pane>
        );
    }

    //---- the skill ---------------------------------------------------------

    function Skill() {
        var [which, setWhich] = remember.use('skill', 'which', 'supervisor');
        var { state, error, again } = useAsk(okc, 'skills', { which: which }, 0);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var text = state.text || state.skill || '';

        return (
            <Pane>
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
                    <Code text={text} tall />
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
            </Pane>
        );
    }

    shell.tab({ name: 'Supervisor', order: 70 });
    shell.pane({ tab: 'Supervisor', name: 'Chat', order: 10, Component: Chat });
    shell.pane({ tab: 'Supervisor', name: 'Todo', order: 20, Component: Todo });
    shell.pane({ tab: 'Supervisor', name: 'Skill', order: 30, Component: Skill });
    shell.pane({ tab: 'Supervisor', name: 'What it may do', order: 40, Component: May });

    await register(null, {});
}
module.exports = plugin;
