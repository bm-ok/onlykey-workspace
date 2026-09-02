var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//what the supervisor knows.
//
//THIS PANE IS THE HALF THAT WAS MISSING, and its absence is why the supervisor
//wrote its memory into the todo list. It already had `triage` — read, write and
//delete, all three on its allowed list — and nobody could look at it. The todo
//list was the store it could write freely AND a person could see, so that is
//where the notes went.
//
//SO WHAT IS HERE IS A WINDOW ONTO A MODEL'S OWN NOTES, and it is worth being
//clear that is all it is. Nothing here decides anything: the tasks are in the
//task store and the judgements in theirs, and what is TRUE about them is read
//from those. This is what a supervisor BELIEVES, which exists nowhere else
//because nothing else has an opinion about it.
//
//WHICH MEANS IT CAN BE WRONG, and reading it is how somebody finds that out.
//An entry saying "#131 is waiting on J7" beside a resolved line saying J7
//finished an hour ago is the pane doing its job.
//
//---- a person may write here too, and rarely should -----------------------
//
//THE BUTTONS ARE HERE BECAUSE THE STORE IS NOT A SECRET, not because this is
//how facts are meant to get in. A supervisor writes its own memory; a person
//correcting one is a person telling it something it got wrong, which is a real
//thing to want and not the ordinary path. The dialogs say so.
//
//AND FORGETTING IS ORDINARY HERE, unlike the todo list this replaces. That one
//refused deletion down the pipe on purpose — "a list the worker can empty is a
//list nobody can use to check up on the worker". A memory is the supervisor's
//own and it may empty it; what is left of that property is the record, since
//every write and every forget is an event.
//---------------------------------------------------------------------------

module.exports = function memoryPane(theme, okc, remember) {
    var {
        Pane, Panel, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Skeleton, Empty, Note, Mono, Notice, ago, ask
    } = theme;

    function Memory() {
        var { state, error, again } = okc.use('memory', {}, 15000);
        var [only, setOnly] = remember.use('memory', 'only', null);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.memory || [];
        var ready = state.ready || [];
        var rows = only ? all.filter(function (r) { return (r.state || '') == only; }) : all;

        function done(r) { setSaid({ text: r.note || 'Done.' }); again(); }
        function oops(e) { setSaid({ bad: true, text: e.message }); throw e; }

        function write() {
            ask({
                title: 'Write something down for the supervisor',
                plain: [
                    'This is the supervisor’s own memory. It writes here itself, reads it at the head of every '
                        + 'waking, and may change or forget anything in it.',
                    'Writing here is telling it something — which is a real thing to want, and not how most of '
                        + 'what is in here arrives.'
                ],
                fields: [
                    { name: 'name', label: 'Name — what it will look this up by', placeholder: '#131, J5, or a subject like "how the owner likes commits"' },
                    { name: 'note', label: 'What is known', multiline: true, rows: 8, placeholder: 'the thing itself, and why if the line is not enough on its own' },
                    { name: 'state', label: 'State (optional)', placeholder: 'waiting on a judge — only if it is waiting on something' }
                ],
                confirm: 'Write it down',
                onYes: function (f) {
                    if (!f.name) throw new Error('It needs a name to be looked up by.');
                    if (!f.note) throw new Error('It needs something to remember.');
                    return okc.call('memorySet', {
                        name: f.name, note: f.note, state: f.state || null
                    }).then(done, oops);
                }
            });
        }

        function edit(r) {
            ask({
                title: 'Change what it remembers about ' + r.name,
                plain: ['The supervisor may change this back. What you write is what it reads next waking.'],
                fields: [
                    { name: 'note', label: 'What is known', multiline: true, rows: 8, value: r.note || '' },
                    { name: 'state', label: 'State (optional)', value: r.state || '' }
                ],
                confirm: 'Save it',
                onYes: function (f) {
                    return okc.call('memorySet', { name: r.name, note: f.note, state: f.state || null })
                        .then(function () { setSaid({ text: r.name + ' saved.' }); again(); }, oops);
                }
            });
        }

        function drop(r) {
            ask({
                title: 'Make it forget ' + r.name + '?',
                danger: true,
                plain: [
                    r.note,
                    'The supervisor may forget this itself and often should. Doing it here is deciding on its '
                        + 'behalf that it is no longer true.'
                ],
                cost: 'Nothing about the task or judgement this names is touched. The note itself is gone.',
                confirm: 'Forget it',
                onYes: function () {
                    return okc.call('memoryForget', { name: r.name })
                        .then(function () { setSaid({ bad: true, text: r.name + ' forgotten.' }); again(); }, oops);
                }
            });
        }

        //STATES ARE A FILTER ONLY WHERE THERE ARE ANY. Most of what is
        //remembered is not in a state at all, and a row of chips over a list
        //where two entries have one is a filter that hides more than it finds.
        var states = {};
        all.forEach(function (r) { if (r.state) states[r.state] = (states[r.state] || 0) + 1; });

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                {/* WHAT FINISHED WHILE IT WAS AWAY, ABOVE EVERYTHING. This is
                    the one thing on the pane that is not simply a record of what
                    a model wrote: each entry is resolved against the real stores,
                    so a note saying "waiting on J7" beside a J7 that finished is
                    caught here rather than left to be spotted. */}
                {ready.length ? (
                    <Notice kind="ok">
                        {ready.length + ' of ' + all.length + ' finished since it wrote them down: '}
                        {ready.map(function (r) { return r.name; }).join(', ')}
                    </Notice>
                ) : null}

                <Panel>
                    <CardTitle>{'What it knows — ' + all.length}</CardTitle>
                    <div className="row">
                        <Button onClick={write}>Write something down</Button>
                    </div>
                    {Object.keys(states).length ? (
                        <Chips>
                            {Object.keys(states).map(function (k) {
                                return (
                                    <Chip key={k} on={only == k} count={states[k]}
                                        onClick={function () { setOnly(only == k ? null : k); }}>{k}</Chip>
                                );
                            })}
                        </Chips>
                    ) : null}
                </Panel>

                {/* THE EMPTY STATE IS THE ACTION'S, NOT THIS PANE'S — and this
                    drew both, one above the other, saying "Nothing remembered
                    yet" twice.

                    THE SAME STUTTER AS ../artifact/handedback.js, made the same
                    way and within hours of fixing it there: a sentence written
                    where the pane is, over an answer that already carries one.
                    `memory` says what nothing-remembered MEANS and where entries
                    come from; it is below as `state.note`, and it is the better
                    of the two because it names `memorySet`.

                    WHAT IS LEFT HERE IS THE ONE THE ACTION CANNOT WRITE: an
                    empty FILTER is a different answer from an empty memory, and
                    the action does not know a chip is pressed. */}
                {!rows.length && all.length
                    ? <Empty>Nothing in that state.</Empty>
                    : null}

                {rows.length ? (
                        <Stack>
                            {rows.map(function (r) {
                                return (
                                    <Card key={r.name}>
                                        <CardTitle>
                                            <Mono>{r.name}</Mono>
                                            {r.state ? <Badge kind={r.now && r.now.landed ? 'ok' : 'muted'}>{r.state}</Badge> : null}
                                        </CardTitle>

                                        {/* WHAT IS ACTUALLY TRUE OF IT, WHERE THE
                                            NAME RESOLVES TO SOMETHING. The note is
                                            what the supervisor believes; this is
                                            what the stores say. Where they
                                            disagree, this one is right. */}
                                        {r.now && r.now.how
                                            ? <CardSub>{r.now.how}</CardSub>
                                            : null}

                                        <div className="console short">{r.note}</div>

                                        <CardSub>
                                            {(r.by ? 'by ' + r.by : 'by nobody recorded')
                                                + (r.at ? ' · ' + ago(r.at) : '')}
                                        </CardSub>

                                        <div className="row" style={{ marginTop: '6px' }}>
                                            <Button kind="small" onClick={function () { edit(r); }}>Change it</Button>
                                            <Button kind="small danger" onClick={function () { drop(r); }}>Forget it</Button>
                                        </div>
                                    </Card>
                                );
                            })}
                        </Stack>
                ) : null}

                <Note>{state.note}</Note>
            </Pane>
        );
    }

    return Memory;
};
