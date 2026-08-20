var React = require('react');
var { useState, useEffect, useRef } = React;

module.exports = function chat(theme, okc) {
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Code, ask
    } = theme;

    var when = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; };

    //---- the conversation --------------------------------------------------

    function Chat() {
        var state = okc.use('supervisorState', {}, 10000);
        var talk = okc.use('chat', {}, 5000);
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

    return Chat;
};
