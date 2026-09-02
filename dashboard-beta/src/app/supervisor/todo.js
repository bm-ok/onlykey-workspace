var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//the list of things to do.
//
//THE LIST IS THIS APP'S OWN NOW. It used to be read over the relay from the
//dashboard; ./server.js keeps it here, so what is on this pane is what this app
//was told and it starts empty. The dashboard's list is still the dashboard's and
//still readable from `okc.js todos` over there — nothing was taken from it.
//
//THE NEXT STATE, AS ONE BUTTON. Three states in a row of three buttons means two
//of them are always the wrong thing to press. What somebody wants is to move this
//one along; the way back is the same button once it is done.
//---------------------------------------------------------------------------

module.exports = function todo(theme, okc, remember) {
    var {
        Pane, Panel, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Skeleton, Empty, Note, Mono, Notice, ago, ask
    } = theme;

    function Todo() {
        var { state, error, again } = okc.use('todos', {}, 15000);
        var [only, setOnly] = remember.use('todo', 'only', null);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.todos || state.list || [];
        var rows = only ? all.filter(function (t) { return t.state == only; }) : all;

        function done(r) { setSaid({ text: r.note || 'Done.' }); again(); }
        function oops(e) { setSaid({ bad: true, text: e.message }); throw e; }

        function add() {
            ask({
                title: 'Put something on the list',
                plain: [
                    'The supervisor reads this list and can change it, so write it as something anybody could pick up.',
                    'It is not a task: nothing boots a machine because this exists.'
                ],
                fields: [
                    { name: 'what', label: 'What is to be done', placeholder: 'one line — this is what shows in the list' },
                    { name: 'why', label: 'Why (optional)', multiline: true, rows: 6, placeholder: 'the paragraph that stops it being misread in a week' }
                ],
                confirm: 'Add it',
                onYes: function (f) {
                    if (!f.what) throw new Error('It needs a description.');
                    return okc.call('todoAdd', { what: f.what, why: f.why || null }).then(done, oops);
                }
            });
        }

        function move(t, to) {
            return okc.call('todoSet', { id: t.ref, state: to }).then(done, oops);
        }

        function edit(t) {
            ask({
                title: 'Edit ' + t.ref,
                fields: [
                    { name: 'what', label: 'What is to be done', value: t.what },
                    { name: 'why', label: 'Why', multiline: true, rows: 6, value: t.why || '' }
                ],
                confirm: 'Save it',
                onYes: function (f) {
                    return okc.call('todoSet', { id: t.ref, what: f.what, why: f.why || '' })
                        .then(function (r) { setSaid({ text: r.ref + ' saved.' }); again(); }, oops);
                }
            });
        }

        //A PERSON'S, AND ONLY HERE. The action refuses this down the pipe and the
        //button is `protect`ed, so the driver is refused the press as well — the
        //two halves of one rule rather than a refusal and a way around it.
        function drop(t) {
            ask({
                title: 'Remove ' + t.ref + '?',
                danger: true,
                plain: [
                    t.what,
                    'Marking it done keeps it on the list where it can be read. Removing it leaves no trace that it was ever there.'
                ],
                cost: 'The supervisor cannot do this and cannot undo it.',
                confirm: 'Remove it',
                onYes: function () {
                    return okc.call('todoRemove', { id: t.ref })
                        .then(function (r) { setSaid({ bad: true, text: r.note }); again(); }, oops);
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
                        var next = t.state == 'open' ? 'doing' : t.state == 'doing' ? 'done' : 'open';
                        var moveOn = t.state == 'open' ? 'Start it' : t.state == 'doing' ? 'Mark it done' : 'Put it back';

                        return (
                            <Card key={t.id} muted={t.state == 'done'}>
                                <CardTitle>
                                    <Mono>{t.ref}</Mono>
                                    <span className="grow">{t.what}</span>
                                    <Badge kind={t.state == 'done' ? 'ok' : t.state == 'doing' ? 'run' : ''}>{t.state}</Badge>
                                </CardTitle>

                                {/* WHO WROTE IT, because a list two things write
                                    to is one where that is the first question.
                                    Never guessed: whoever called the action said
                                    so. */}
                                <CardSub>{[
                                    t.by ? 'by ' + t.by : null,
                                    t.at ? ago(t.at) : null,
                                    t.done ? 'finished ' + ago(t.done) : null
                                ].filter(Boolean).join(' · ')}</CardSub>

                                {t.why ? <CardSub>{t.why}</CardSub> : null}

                                <div className="row">
                                    <Button kind={t.state == 'doing' ? 'ok' : ''}
                                        onClick={function () { move(t, next); }}>{moveOn}</Button>
                                    <Button onClick={function () { edit(t); }}>Edit</Button>
                                    <Button kind="danger" onClick={function () { drop(t); }}>Remove</Button>
                                </div>
                            </Card>
                        );
                    }) : <Empty>nothing on the list{only ? ' in ' + only : ''}</Empty>}
                </Stack>
                <Note>
                    A supervisor may add to this list, change it and mark something done. Only a person
                    may take something off it: done is kept and shown, gone leaves no trace it was ever there.
                </Note>
            </Pane>
        );
    }

    return Todo;
};
