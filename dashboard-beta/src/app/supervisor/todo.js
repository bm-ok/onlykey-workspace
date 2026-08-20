var React = require('react');
var { useState } = React;

module.exports = function todo(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Code, ask
    } = theme;

    function Todo() {
        var { state, error, again } = okc.use('todos', {}, 15000);
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

    return Todo;
};
