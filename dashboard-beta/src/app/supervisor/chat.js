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

        //HOW FAR THE FAR END HAS ACTUALLY READ. "Written down" and "delivered"
        //are hours apart here — a supervisor is switched off most of the time —
        //and from this side they look identical unless something says otherwise.
        var readTo = (talk.state && talk.state.read && talk.state.read.n) || 0;

        function send() {
            var t = text.trim();
            if (!t) return;
            setSending(true);
            okc.call('chatSay', { text: t }).then(
                function () { setText(''); setSending(false); talk.again(); },
                function (e) { setSaid({ bad: true, text: e.message }); setSending(false); }
            );
        }

        //---- ONE SCREEN, AND THE THREAD IS THE SUBJECT OF IT ---------------
        //
        //WHETHER IT CAN RUN GOES IN THE HEADER ROW, not in a card above the
        //conversation. This pane had the card, and the app being ported from had
        //it too and moved away from it, writing down why: it took the top third
        //of the tab to say three short things, on a screen whose subject is the
        //thread underneath it.
        //
        //AND THE STATE NEVER SWAPS THE SCREEN. There was a whole second layout
        //for "not running", which meant the page rearranged itself when a
        //machine came up — the header moved, the thread moved, and whatever
        //somebody was reading went somewhere else. Now one layout, and only the
        //thing under the thread changes.
        var offline = !sup.ready;

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                {/* A COLUMN THE HEIGHT OF THE WINDOW. Every other panel in this
                    app is a list of records and reads top-down; a conversation
                    reads bottom-up, keeps its composer under your hands, and says
                    who is speaking by WHERE a line sits. So the thread takes what
                    is left and scrolls inside itself, and what is under it is
                    pinned — see `.chat-view` in the theme for what happens
                    without this. */}
                <div className="chat-view">
                <div className="head-row">
                    <CardTitle>Supervisor</CardTitle>
                    {/* INLINE, AND IT IS THE WHOLE STATE. A machine's name, what
                        it is doing, and the badges that qualify it. */}
                    <div className="head-state">
                        <Mono>{sup.name || 'none'}</Mono>
                        {sup.there
                            ? <Badge kind={sup.ready ? 'ok' : 'warn'}>{sup.ready ? 'running' : 'not running'}</Badge>
                            : <Badge kind="warn">none made</Badge>}
                        {sup.thinking ? <Badge kind="run">thinking</Badge> : null}
                        {talk.state && talk.state.missed ? <Badge kind="warn">{talk.state.missed + ' not shown'}</Badge> : null}
                        {talk.state && talk.state.beyondReach
                            ? <Badge kind="warn">{talk.state.beyondReach + ' out of its reach'}</Badge>
                            : null}
                    </div>
                    <div className="head-controls">
                        {/* THE CONTROLS THAT ONLY MEAN SOMETHING WHILE IT RUNS
                            are disabled with the reason in the title, rather
                            than removed — a row that loses its buttons reads as
                            a broken window instead of as a state. */}
                        <Button disabled={offline}
                            title={offline
                                ? 'It cannot run yet — start it first'
                                : 'One turn: it reads what changed and answers'}
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
                </div>

                {/* WHAT IS TRUE ABOUT THE CONVERSATION, under the header and
                    above the thread — one line, because everything below it is
                    the thing being read. */}
                <Note>{(talk.state && talk.state.note) || sup.note}</Note>

                <Messages msgs={msgs} bottom={bottom} readTo={readTo} />

                {offline ? (
                    //IN THE COMPOSER'S PLACE, NOT INSTEAD OF THE SCREEN. Typing
                    //into a box that goes nowhere is worse than having no box:
                    //the message IS kept and IS delivered eventually, so it looks
                    //like it worked and then nothing answers. So the box is
                    //replaced, where it was, by the one thing that would help.
                    <div className="chat-offline">
                        <p className="why">{sup.there ? (sup.why || sup.note) : sup.note}</p>
                        <p className="why muted">
                            Anything said now would wait unread until one is up.
                        </p>
                        {sup.there ? (
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
                        ) : null}
                    </div>
                ) : (
                    //PINNED UNDER THE THREAD, never scrolling with it. A composer
                    //that walks off the bottom as a conversation grows is the one
                    //thing a chat window must not do.
                    //
                    //A textarea rather than an input: a brief for a supervisor is
                    //often a paragraph, and Enter sends while Shift+Enter makes a
                    //line.
                    <div className="chat-composer">
                        <textarea rows={1} value={text}
                            placeholder="say something to the supervisor — Enter to send, Shift+Enter for a new line"
                            onChange={function (e) { setText(e.target.value); }}
                            onKeyDown={function (e) {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                            }} />
                        {/* IT READS THIS WHEN IT NEXT WAKES, which is not the
                            same as now. Said on the button rather than found out
                            by watching nothing happen. */}
                        <Button kind="ok" disabled={sending || !text.trim()}
                            title="it reads this when it next asks what is new"
                            onClick={send}>{sending ? 'sending…' : 'Say it'}</Button>
                    </div>
                )}
                </div>
            </Pane>
        );
    }


    //A MESSAGE SAYS WHO AND HOW IT ARRIVED. `via` is the difference between a
    //person typing and something on the wire, and it is the whole reason a
    //conversation is worth keeping rather than just the answers.
    function Messages({ msgs, bottom, readTo }) {
        //`.chat-thread`, NOT `.console tall`. The console is a fixed-height box —
        //`calc(100vh - 220px)` — which is right for a log that is the whole pane
        //and wrong for anything with something under it: it took the viewport and
        //put the composer below the fold. The thread takes what is LEFT of the
        //column and scrolls inside itself.
        //
        //AND IT IS THERE WHEN IT IS EMPTY, so the composer does not jump up the
        //screen on the first message.
        return (
            <div className="chat-thread">
                {msgs.length ? null : <Empty>nothing has been said yet</Empty>}
                {msgs.map(function (m) {
                    var mine = m.who == 'person' || m.who == 'you' || m.who == 'the person';

                    //FADED UNTIL THE SUPERVISOR HAS ACTUALLY BEEN HANDED IT.
                    //It is switched off most of the time, so "written down" and
                    //"delivered" are hours apart and look identical from here —
                    //which is what made this tab read as a chat where the other
                    //end is ignoring you. Only YOUR messages: the supervisor's
                    //own are read by definition, being on your screen.
                    var waiting = mine && Number(m.n) > Number(readTo || 0);

                    return (
                        <div className={'msg ' + (mine ? 'mine' : 'theirs') + (waiting ? ' waiting' : '')} key={m.n}>
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
