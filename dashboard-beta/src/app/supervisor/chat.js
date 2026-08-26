var React = require('react');
var { useState, useEffect, useRef } = React;

module.exports = function chat(theme, okc, markdown) {
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Code, ask, ago
    } = theme;

    //HOW LONG AGO, WITH THE STAMP ON THE HOVER. A conversation is read as "that
    //was this morning" and never as a date — and the exact moment still matters
    //when a message is being lined up against the log, so it is the title rather
    //than gone.
    var when = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; };

    //---- A MESSAGE IS WRITTEN AS MARKDOWN AND WAS READ AS SOURCE ------------
    //
    //A supervisor answers in prose most of the time, and sometimes in a list of
    //three tasks with their branches, or a fenced block of what a job would run.
    //As source that second kind is a wall of dashes and backticks, and the
    //formatting it was written with is the thing that does not happen.
    //
    //IN A FRAME THAT CAN DO NOTHING, which is not a styling convenience. This
    //text came from a model; markdown carries raw HTML through by design and
    //marked does not sanitise it. Rendered into THIS document it would run inside
    //an app page that has node and require(). ../ui/markdown is that frame, and
    //it already exists here — the chat pane simply never used it.
    //
    //ONLY WHEN IT IS ACTUALLY MARKDOWN. A frame per bubble is a document per
    //bubble, and a one-line answer does not need one — worse, a frame cannot be
    //measured from out here without same-origin, so its height is an estimate and
    //an estimate around one sentence looks like a bug. Prose stays text; anything
    //with structure gets the viewer.
    var LOOKS_MARKDOWN = /(^|\n)\s*(#{1,6} |[-*+] |\d+\. |> |\|)|```|`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/;

    //HOW TALL, ESTIMATED, BECAUSE THE FRAME CANNOT BE ASKED. Reading its height
    //needs same-origin, which is exactly what must not be granted to text off a
    //machine, and letting it measure itself and report back needs scripts — which
    //would mean a <script> in the markdown running too. The trade is a hostile
    //script for a tidier bottom margin.
    //
    //IT ERRS GENEROUS ON PURPOSE. Blank space under a message reads as spacing; a
    //scrollbar inside a chat bubble reads as broken.
    function guessHeight(text) {
        var lines = String(text).split('\n');
        var rows = lines.reduce(function (n, line) {
            return n + Math.max(1, Math.ceil(line.length / 120));
        }, 0);
        var blocks = (String(text).match(/(^|\n)\s*(#{1,6} |```|\|)/g) || []).length;
        return Math.min(560, Math.max(58, rows * 22 + blocks * 10 + 30));
    }

    function Body({ text }) {
        var t = String(text == null ? '' : text);
        if (!markdown || !markdown.Frame || !LOOKS_MARKDOWN.test(t)) return t;
        return <markdown.Frame text={t} height={guessHeight(t) + 'px'} />;
    }

    //---- the conversation --------------------------------------------------

    function Chat() {
        var state = okc.use('supervisorState', {}, 10000);
        var talk = okc.use('chat', {}, 5000);
        //`supervisorWakes` — WHETHER SAYING SOMETHING WAKES IT BY ITSELF. A
        //machine starting and a model spending, on its own initiative, because
        //somebody typed a sentence: that is the point of it and it is not a thing
        //to switch on by accident, so it is a switch rather than a default. It
        //was kept only as a line of text on Settings → General.
        var conf = okc.use('settings', {}, 0);
        var [text, setText] = useState('');
        var [said, setSaid] = useState(null);
        var [sending, setSending] = useState(false);
        var bottom = useRef(null);

        //---- READING THE THREAD WHILE NOTHING IS UP ------------------------
        //
        //UP HERE WITH THE OTHER HOOKS, AND NOT BESIDE THE THING IT IS ABOUT.
        //These were written next to the layout that uses them, which reads far
        //better and is a rules-of-hooks violation: the two `return`s below are
        //early exits, so on the draw where state has not arrived React saw fewer
        //hooks than on the draw where it had — "Rendered more hooks than during
        //the previous render", and the pane drew its own error instead.
        //
        //RESET THE MOMENT ONE IS UP, so putting the next one away starts on the
        //decision again rather than wherever this was left. Keyed on `ready`
        //rather than on the whole state object, which changes on every poll.
        var [reading, setReading] = useState(false);
        //WHICH ONE TO START, when there is more than one to pick from. Held here
        //with the other hooks for the same reason `reading` is.
        var choice = useState('');
        var ready = !!(state.state && state.state.ready);
        useEffect(function () { if (ready) setReading(false); }, [ready]);

        //THE LAST THING SAID IS THE ONE BEING READ. A conversation that opens at
        //the top is one somebody scrolls every time they look at it.
        var count = talk.state ? (talk.state.messages || []).length : 0;
        useEffect(function () {
            if (bottom.current) bottom.current.scrollIntoView({ block: 'end' });
        }, [count]);

        if (!state.state && state.error) return <Pane><Note kind="bad">{state.error}</Note></Pane>;
        if (!state.state) return <Pane><Skeleton rows={3} /></Pane>;

        var sup = state.state;

        //EVERYTHING IS HANDED OVER AND THE HIDING HAPPENS HERE, which is the
        //point of a bookmark rather than a delete: `chatFrom` moved a pointer on
        //the host and nothing was thrown away, so the way back is a button and
        //not a backup.
        var everything = (talk.state && talk.state.messages) || [];
        var startAt = Number((talk.state && talk.state.from && talk.state.from.n) || 0);
        var msgs = startAt ? everything.filter(function (m) { return Number(m.n) > startAt; }) : everything;
        var buried = everything.length - msgs.length;

        //HOW FAR THE FAR END HAS ACTUALLY READ. "Written down" and "delivered"
        //are hours apart here — a supervisor is switched off most of the time —
        //and from this side they look identical unless something says otherwise.
        var readTo = (talk.state && talk.state.read && talk.state.read.n) || 0;

        //ONE FUNCTION, TWO PLACES. The state line offers it while reading and the
        //body offers it while choosing — same act, same sentence, and two copies
        //of a confirm dialog is two places for the wording to drift.
        //WHICH ONE, PASSED IN RATHER THAN ASSUMED. The state line's button is
        //about the one it is describing; the body's is about whichever was
        //picked, and with several machines those are not the same name.
        function startIt(which) {
            var name = which || (state.state || {}).name;
            ask({
                title: 'Start ' + name + '?',
                plain: [
                    'It starts the machine, waits for it to dial in, and signs it in with the supervisor credential this host holds.',
                    'It is a whole machine, so this takes a minute or two. Nothing is asked of the model by starting it.'
                ],
                confirm: 'Start it',
                onYes: function () {
                    return okc.call('supervisorUp', { name: name }).then(
                        function (r) { setSaid({ text: r.note || 'Started.' }); state.again(); },
                        function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                    );
                }
            });
        }

        function send() {
            var t = text.trim();
            if (!t) return;
            setSending(true);
            okc.call('chatSay', { text: t }).then(
                function () { setText(''); setSending(false); talk.again(); },
                function (e) { setSaid({ bad: true, text: e.message }); setSending(false); }
            );
        }

        //---- THREE STATES, AND THE BODY IS WHICHEVER ONE IT IS -------------
        //
        //WHETHER IT CAN RUN GOES IN THE HEADER ROW, not in a card above the
        //conversation. That part is right and stays: a card took the top third of
        //the tab to say three short things, on a screen whose subject is the
        //thread underneath it.
        //
        //WHAT WAS WRONG WAS SHOWING EVERYTHING AT ONCE. This pane said "the state
        //never swaps the screen", and the cost of that is a conversation nothing
        //can answer sitting above a composer nobody will read, with a Start button
        //underneath it — three things competing on one screen while only one of
        //them does anything.
        //
        //    running    the thread, and a composer under your hands
        //    reading    the thread, and no composer. What was said outlives any
        //               one supervisor — machines get swapped — so reading it
        //               with nothing up is useful. Typing is not: the message IS
        //               kept and IS delivered eventually, so it looks like it
        //               worked and then nothing answers.
        //    choosing   neither. The one useful thing while it is down is the way
        //               to bring it up, so that is the only thing on the screen.
        //
        //AND THE PAGE DOES NOT REARRANGE UNDER SOMEBODY WHO IS READING. That was
        //this pane's objection to the old layout and it is a fair one, so the
        //header row keeps its shape in all three and only its controls change —
        //and reading resets the moment one is up, so putting the next one away
        //starts on the decision again rather than wherever this was left.
        var offline = !sup.ready;
        var showThread = !offline || reading;

        //WHICH OF THE THREE IT IS, NAMED ONCE. Everything on this pane that
        //swaps — the state line, the control row, the body, the composer —
        //swaps on this and nothing else, which is how the app being ported from
        //keeps them from disagreeing with each other.
        var showing = sup.ready ? 'running' : reading ? 'reading' : 'choosing';

        //EVERY SUPERVISOR THIS HOST HAS, because starting one is picking WHICH
        //when there is more than one. The flattened fields above are the first
        //of these; `supervisors` is the list itself.
        var rows = sup.supervisors || [];
        var [chose, setChose] = choice;

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
                    {/* HOW MUCH CONVERSATION THERE IS, beside the title where a
                        count belongs — and "N of M" the moment a bookmark is
                        hiding some of it, so a thread that suddenly got short is
                        never mistaken for one that got emptied. */}
                    <CardTitle>Supervisor{everything.length
                        ? <span className="muted">{buried
                            ? ' — ' + msgs.length + ' of ' + everything.length
                            : ' — ' + msgs.length}</span>
                        : null}</CardTitle>
                    {/* INLINE, AND IT IS THE WHOLE STATE. A machine's name, what
                        it is doing, and the badges that qualify it. */}
                    {/* ONE LINE, AND ONLY WHAT DECIDES SOMETHING: the name,
                        whether it can run, what it is signed in as, and the one
                        button that changes that. Everything else this knows — the
                        machine's state, the reason it cannot run — is on the
                        hover, because it is what somebody wants only once it is
                        wrong.

                        THIS DREW TWO OF THE FIVE. The name and a badge, and then
                        nothing: no sign-in, no way to start it from here, no way
                        to watch it think. All of it is already in
                        `supervisorState` — `connected`, `signedInAs`,
                        `fingerprint`, `why` — and none of it was on the screen. */}
                    {/* AND IT GOES WHILE CHOOSING, because the body is saying the
                        same three things in the middle of the screen: which
                        machine, why it cannot run, and the button that fixes it.
                        Two copies of one sentence, one of them in small type at
                        the top, is a screen asking somebody to work out whether
                        they are two different facts.

                        IT STAYS WHILE READING. There the body IS the
                        conversation, so this line is the only thing saying why
                        there is nowhere to type. */}
                    {showing === 'choosing' ? null : (
                    <div className="head-state">
                        {/* NO MACHINE IS ONE MUTED PHRASE AND NOTHING ELSE. A
                            name, a badge and a start button describing a machine
                            that does not exist is four controls about nothing;
                            what to do about it is on the Runners tab, and the
                            body says so. */}
                        {sup.there
                            ? <Mono>{sup.name}</Mono>
                            : <span className="muted" title={sup.note || ''}>no supervisor machine</span>}
                        {/* `cannot run` RATHER THAN `not running`, and they are
                            different facts. A machine can be running and still
                            unable to work — holding no credential is the usual
                            way — so the badge answers "would waking it do
                            anything", which is the question. The machine's own
                            state is on the hover. */}
                        {sup.there
                            ? <Badge kind={sup.thinking ? 'run' : sup.ready ? 'ok' : 'warn'}
                                title={sup.why || sup.note || ''}>
                                {sup.thinking ? 'thinking' : sup.ready ? 'ready' : 'cannot run'}
                            </Badge>
                            : null}

                        {/* WHAT IT IS SIGNED IN AS, which was invisible
                            everywhere else and cost an afternoon over there. A
                            name and a fingerprint, never a value — and the
                            absence is the louder half, because a supervisor with
                            no credential wakes, finds a sign-in menu, and exits
                            in three seconds having asked this host for nothing. */}
                        {sup.there ? (
                            sup.signedInAs
                                ? <span className="muted" title={'fingerprint ' + (sup.fingerprint || '')}>
                                    {sup.signedInAs}
                                </span>
                                : <span className="warn"
                                    title="A worker on it cannot authenticate, so waking it does nothing.">
                                    no credential
                                </span>
                        ) : null}

                        {/* THE ONE BUTTON THAT CHANGES WHAT THE BADGE SAYS, in
                            the state line rather than in the control row — it is
                            about the MACHINE, and the row to the right is about
                            the conversation.

                            `supervisorUp` AND `supervisorDown`, NOT `vmStart`.
                            Both already exist here and neither was called from
                            anywhere: starting it is "start it AND sign it in",
                            and a machine started without its credential wakes,
                            finds a sign-in menu and exits in three seconds having
                            asked this host for nothing. Putting it away takes the
                            credential back FIRST and then stops it — in that
                            order, or whatever the worker refreshed is lost with
                            the machine. */}
                        {sup.there ? (
                            sup.ready
                                ? <Button
                                    title="Takes its credential back first, then stops it"
                                    onClick={function () {
                                        ask({
                                            title: 'Put ' + sup.name + ' away?',
                                            plain: [
                                                'Its credential comes back here first — whatever the worker refreshed comes with it — and then the machine is stopped.',
                                                'Anything said to it while it is down waits until one is up again.'
                                            ],
                                            confirm: 'Put it away',
                                            onYes: function () {
                                                return okc.call('supervisorDown', { name: sup.name }).then(
                                                    function (r) { setSaid({ text: r.note || 'Put away.' }); state.again(); },
                                                    function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                                                );
                                            }
                                        });
                                    }}>Put it away</Button>
                                : <Button kind="ok"
                                    title="Starts the machine, waits for it to dial in, and signs it in"
                                    onClick={function () { startIt(); }}>Start it</Button>
                        ) : null}
                        {/* `missed` WAS A BADGE HERE AND COULD NEVER FIRE. The
                            window asks `chat` with no bookmark and is handed
                            everything, so that field is always zero — it
                            describes the WINDOW's reading rather than anybody's
                            problem. The number worth showing is the other end's,
                            and that is `beyondReach`, in the note. */}
                    </div>
                    )}
                    <div className="head-controls">
                        {/* THREE STATES, ONE ROW, and what belongs here depends
                            entirely on which it is:

                              running    Wake it
                              reading    one way out: Close
                              choosing   NOTHING. The decision is in the middle
                                         of the body and this row would only
                                         compete with it.

                            That last one is the app being ported from's own
                            arrangement, checked against a capture of it rather
                            than remembered: every control in that row carries
                            `hidden` while it is choosing. Putting Start up here
                            instead — which is what this pane did first — leaves
                            two places offering the same decision. */}
                        {offline && reading ? (
                            <Button
                                title="Back to the reason it cannot run"
                                onClick={function () { setReading(false); }}>Close</Button>
                        ) : null}

                        {/* ANSWERING BY ITSELF IS A MACHINE STARTING AND A MODEL
                            SPENDING, on its own initiative, because somebody
                            typed a sentence. That is the point of it and it is
                            not a thing to switch on by accident, so it is a
                            switch rather than a default — and it is here rather
                            than buried in Settings, where it was a line of text
                            saying `supervisorWakes (off)` and nothing to press. */}
                        {offline ? null : (
                            <label className="inline" title={
                                (conf.state && conf.state.supervisorWakes)
                                    ? 'It wakes and answers when you say something — a machine starts and a model thinks, each time'
                                    : 'It will not wake by itself. What you say waits until you press Wake it.'}>
                                <input type="checkbox"
                                    checked={!!(conf.state && conf.state.supervisorWakes)}
                                    onChange={function (e) {
                                        var on = !!e.target.checked;
                                        okc.call('settingSet', { name: 'supervisorWakes', value: on }).then(
                                            function () {
                                                conf.again();
                                                setSaid({ text: on
                                                    ? 'It will wake and answer when you say something — a machine starts and a model thinks, each time.'
                                                    : 'It will not wake by itself. What you say here waits until you press Wake it.' });
                                            },
                                            function (err) { setSaid({ bad: true, text: err.message }); conf.again(); }
                                        );
                                    }} />
                                <span>Answers by itself</span>
                            </label>
                        )}

                        {offline ? null : (
                            <Button
                                title="One turn: it reads what changed and answers"
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
                        )}

                        {/* TIDYING THE SCREEN, AND NOTHING MORE.
                            A conversation with a supervisor is the record of why
                            work exists — what was asked for, what it decided,
                            what it was told. So Clear moves a bookmark: what came
                            before stops being drawn and stays exactly where it
                            is, and "Show all of it" in the note brings it back.

                            THIS CALLED `chatClear`, WHICH IS NOT DEFINED HERE.
                            An action this app does not have is not refused — it
                            is relayed to the app being ported from, so the one
                            thing that press could reach was the real
                            conversation, in the one app nothing here may write
                            to. Neither the danger styling nor the confirm box
                            said anything about that, because both were about the
                            act rather than about where it landed. */}
                        {offline ? null : (
                            <Button
                                title="Hides what came before. Nothing is deleted."
                                onClick={function () {
                                    ask({
                                        title: 'Start reading from here?',
                                        plain: [
                                            'Everything above stays exactly where it is and stops being shown.',
                                            'Nothing is deleted, and "Show all of it" brings the whole conversation back.'
                                        ],
                                        confirm: 'Start from here',
                                        onYes: function () {
                                            return okc.call('chatFrom', {}).then(
                                                function (r) { setSaid({ text: r.note || 'Done.' }); talk.again(); },
                                                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                                            );
                                        }
                                    });
                                }}>Clear</Button>
                        )}
                    </div>
                </div>

                {/* WHAT IS TRUE ABOUT THE CONVERSATION, under the header and
                    above the thread — one line, because everything below it is
                    the thing being read. It goes with the thread: while choosing,
                    the body already says the one thing worth saying.

                    IT SAID "6 message(s)." That is the `chat` action's own note,
                    written for the command line where the count IS the answer;
                    on a screen already showing the messages it is a number
                    beside the thing it counts. The sentences below are the ones
                    a person needs here, and the count moved to the title. */}
                {showThread ? (
                    <Note>
                        {/* THE WAY BACK, and only when there is something to come
                            back to. It sits here rather than in the header
                            because it is about what is being SHOWN rather than
                            about the supervisor — and the header row already
                            swaps between three states without needing a fourth. */}
                        {buried ? (
                            <span>
                                <span className="muted">
                                    {buried + ' earlier message' + (buried === 1 ? '' : 's') + ' hidden. '}
                                </span>
                                <Button onClick={function () {
                                    okc.call('chatFrom', { n: 0 }).then(
                                        function (r) { setSaid({ text: r.note || 'Showing all of it.' }); talk.again(); },
                                        function (e) { setSaid({ bad: true, text: e.message }); }
                                    );
                                }}>Show all of it</Button>
                            </span>
                        ) : (
                            <span>{msgs.length
                                ? 'The supervisor reads this when it next wakes, not this second — it is a note left '
                                    + 'for it, and it is switched off most of the time.'
                                : 'Nothing said yet. What you type here is what the supervisor is asked to do; it '
                                    + 'reads it when it next looks, and answers here.'}</span>
                        )}

                        {/* AND HOW MUCH OF IT IS PAST WHAT THE FAR END CAN REACH.
                            Not unread — unreadABLE. A supervisor reads with a
                            bookmark and is handed the most recent 200; past that
                            the beginning of the conversation silently stops being
                            something it can see, and nothing else on this screen
                            would ever say so. Said here rather than in a banner:
                            it is a fact about this conversation and it is not
                            urgent — it only has to be visible before somebody
                            wonders why the far end forgot something. */}
                        {talk.state && talk.state.beyondReach ? (
                            <span className="bad">
                                {' ' + talk.state.beyondReach + ' earlier message'
                                    + (talk.state.beyondReach === 1 ? ' is' : 's are')
                                    + ' past what the supervisor can read back.'}
                            </span>
                        ) : null}
                    </Note>
                ) : null}

                {showThread ? <Messages msgs={msgs} bottom={bottom} readTo={readTo} /> : null}

                {offline ? (
                    //THE WHOLE BODY GOES, NOT ONLY THE COMPOSER.
                    //
                    //A thread nothing can answer is not useful context — it is a
                    //record of a conversation with something that is not there,
                    //sitting above a box that accepts messages nobody will read.
                    //The one useful thing on this tab while the machine is down is
                    //the way to bring it up, so that is the only thing on it.
                    //
                    //AND WHILE READING, NOTHING IS DRAWN HERE AT ALL: the body IS
                    //the thread, and the way out is Close in the header. One
                    //control at a time, always in the same place.
                    reading ? null : (
                        <div className="chat-offline">
                            {/* THE NAME AND THE STATE FIRST, THEN WHY. Two lines
                                rather than one: "it is not running" is what
                                somebody came here to find out, and the reason it
                                cannot run is what they do next about it. */}
                            <p className="why">
                                {!sup.there ? 'This host has no supervisor machine.'
                                    : rows.length === 1 ? rows[0].name + ' is not running.'
                                        : 'No supervisor is running.'}
                            </p>
                            {/* THE REASON ONLY WHEN THERE IS ONE OF THEM. With
                                several, "why" belongs to whichever is picked and
                                a single line under a list of machines reads as
                                being about all of them. */}
                            {sup.there && rows.length === 1 && rows[0].why
                                ? <p className="why muted">{rows[0].why}</p>
                                : null}
                            {!sup.there
                                ? <p className="why muted">
                                    Make one on the Runners tab — tick "supervisor machine?" when you create it.
                                </p>
                                : null}

                            {/* THE DECISION, IN THE MIDDLE OF THE SCREEN, which
                                is where the app being ported from puts it and why
                                its header row is empty here. One row, centred,
                                and nothing else on the screen competing. */}
                            {sup.there ? (
                                <div className="row">
                                    {/* ONE IS THE ORDINARY CASE, and a picker
                                        with one entry asks a question with one
                                        answer. Shown only when there is a real
                                        choice — and only one may run at a time
                                        anyway, so picking is picking WHICH. */}
                                    {rows.length > 1 ? (
                                        <select value={chose || rows[0].name}
                                            onChange={function (e) { setChose(e.target.value); }}>
                                            {rows.map(function (r) {
                                                return <option key={r.name} value={r.name}>{r.name + ' — ' + r.state}</option>;
                                            })}
                                        </select>
                                    ) : null}
                                    <Button kind="ok"
                                        title="Starts the machine, waits for it to dial in, and signs it in"
                                        onClick={function () { startIt(rows.length > 1 ? (chose || rows[0].name) : rows[0].name); }}>
                                        {rows.length > 1 ? 'Start the one you picked' : 'Start ' + (rows[0] ? rows[0].name : 'it')}
                                    </Button>

                                    {/* THE CONVERSATION OUTLIVES ANY ONE
                                        SUPERVISOR, which is the whole reason this
                                        is offered while nothing is up: swapping
                                        machines is expected, and what was said
                                        belongs to the host rather than to the
                                        machine that happened to say it. Every
                                        message already records which one did. */}
                                    <Button
                                        title="The conversation so far, including anything an earlier supervisor said"
                                        onClick={function () { setReading(true); }}>Read what was said</Button>
                                </div>
                            ) : null}

                            {/* AND NOT WHEN THERE IS NO MACHINE AT ALL. "there is
                                nowhere to type until then" is about a machine
                                that is down and could come up; with none made it
                                answers a question nobody asked, under two lines
                                that already said what to do. */}
                            {sup.there ? (
                                <p className="why muted">
                                    Anything said while it is down would wait unread until one is up, so there is
                                    nowhere to type until then.
                                </p>
                            ) : null}
                        </div>
                    )
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
                                {/* "you" AND "the supervisor", not `person` and
                                    `supervisor`. The row above a bubble is read
                                    at a glance and the raw field names read as
                                    data rather than as a conversation. */}
                                <span>{mine ? 'you' : 'the supervisor'}</span>

                                {/* WHERE IT CAME FROM, when it was not somebody
                                    typing here. A line written by a drill or from
                                    the command line is not a person asking for
                                    something and should not look like one — so
                                    `window` and `wire`, which are the ordinary
                                    two, say nothing. */}
                                {m.via && m.via !== 'window' && m.via !== 'wire'
                                    ? <span className="badge muted">{m.via}</span>
                                    : null}

                                {/* WHICH MACHINE SAID IT. Two supervisors are not
                                    supposed to run at once, and this is where it
                                    would show. */}
                                {!mine && m.from ? <span className="mono">{m.from}</span> : null}

                                {/* WHEN, THEN THE RECEIPT, THEN WHAT IT WAS
                                    ABOUT — the order the app being ported from
                                    uses, and `.msg-who` is a flex row with a
                                    6px gap, so these are spans rather than
                                    strings with separators glued on. A dot
                                    typed into the text is a separator the
                                    layout cannot take back out. */}
                                <span title={when(m.at)}>{ago(m.at)}</span>

                                {/* DELIVERED, WHICH IS NOT THE SAME AS SENT.
                                    A supervisor is switched off most of the time,
                                    so a message waiting for a machine to boot
                                    looks exactly like a message being ignored.
                                    The bubble already fades; this says which it
                                    is in words. Only YOUR messages: its own are
                                    read by definition, being on your screen. */}
                                {mine
                                    ? <span>{waiting ? 'not read yet' : 'read'}</span>
                                    : null}

                                {m.about ? <span>{'about ' + m.about}</span> : null}
                            </div>
                            <div className="msg-body"><Body text={m.text} /></div>
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
