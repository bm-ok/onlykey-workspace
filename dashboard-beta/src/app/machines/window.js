var makeMeter = require('./meter');
var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//the Machines tab — and the first pane built in the shape the app actually has.
//
//THREE COLUMNS, WHICH IS NOT A STYLE CHOICE. The list, then what can be done to
//whatever is picked in it, then what that thing is. One set of buttons serves
//every machine — put the dozen acts inside each card instead and a list of ten
//machines is a hundred and twenty buttons.
//
//The old window had this shape and it was invisible to the port, because it
//lived in index.html and the JavaScript only filled containers that were
//already there. See ../../THEME.md.
//
//EVERY ACT THAT CANNOT BE TAKEN BACK GOES THROUGH `ask`. Starting a machine is
//reversible and is a button. Stopping one with force, letting it off its branch,
//and changing whether the queue may use it are not, and each states its cost
//before it is agreed to. The person makes the press; nothing here presses on
//their behalf.
//
//WHAT IT SHOWS IS WHAT DECIDES SOMETHING. A machine list that prints every field
//is a list nobody reads: this answers the questions somebody actually has — is
//it up, can it be reached, what may it be given, is it holding a credential, is
//it claiming a branch, and is anything allowed to give it work.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./machines.scss.
    require('./machines.scss');
    var { shell, theme, okc, remember } = imports;
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, ask
    } = theme;

    var when = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : 'never'; };

    function state(v) {
        if (v.running) return { kind: 'ok', word: v.connected ? 'running' : 'running, not dialled in' };
        if (v.installing) return { kind: 'run', word: 'installing' + (v.stage ? ' — ' + v.stage : '') };
        return { kind: '', word: v.state || 'off' };
    }

    //---- the left column ---------------------------------------------------

    function Row({ v, on, onPick }) {
        var s = state(v);
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle><Mono>{v.name}</Mono> <Badge kind={s.kind}>{s.word}</Badge></CardTitle>
                <CardSub>
                    {/* WHAT IT MAY BE GIVEN, and "nothing" is a real answer
                        rather than a missing one. A machine with no role tag
                        gets no automatic work at all, because the queue picks
                        which sign-in to hand over from the role — so an
                        unlabelled machine means guessing whose identity to
                        send, and it does not guess. */}
                    {(v.kinds || []).length
                        ? (v.kinds || []).map(function (k) { return <span key={k}><Badge>{k}</Badge>{' '}</span>; })
                        : <Badge kind="warn">no role — the queue leaves it alone</Badge>}
                    {v.forTasks === false ? <span>{' '}<Badge kind="warn">kept back</Badge></span> : null}
                    {v.holdsCredential ? <span>{' '}<Badge kind="warn">holding a sign-in</Badge></span> : null}
                    {v.borrowed ? <span>{' '}<Badge kind="run">borrowed</Badge></span> : null}
                </CardSub>
                {v.branch ? <CardSub>claims <Mono>{v.branch}</Mono></CardSub> : null}
            </Card>
        );
    }

    //---- the middle column -------------------------------------------------

    function Acts({ v, again }) {
        if (!v) return <Panel><Empty>pick a machine on the left</Empty></Panel>;

        var run = async function (action, args) {
            await okc.call(action, args || { name: v.name });
            again();
        };

        return (
            <Panel>
                <div className="row">
                    {/* DISABLE WHAT MUST NOT BE PRESSED, AND SAY WHY. A button
                        that is there and does nothing is worse than one that is
                        absent — somebody presses it twice and then goes looking
                        for what they did wrong. */}
                    <Button kind="ok" disabled={v.running || !!v.installing}
                        title={v.running ? 'it is already running' : v.installing ? 'it is installing' : 'start it'}
                        onClick={function () { run('vmStart'); }}>Start</Button>

                    <Button disabled={!v.running}
                        title={v.running ? 'shut it down' : 'it is not running'}
                        onClick={function () {
                            ask({
                                title: 'Stop ' + v.name + '?',
                                plain: [
                                    'Asks the machine to shut down and waits for it.',
                                    v.branch ? 'It is claiming ' + v.branch + ' — stopping does not let it off that.' : null,
                                    v.holdsCredential ? 'It is holding a sign-in. That stays with it.' : null
                                ],
                                //PULLING THE POWER IS NOT THE SAME BUTTON. It is
                                //the same button with a tick, because the moment
                                //somebody wants it is the moment the polite ask
                                //did not work — and making them find a second
                                //control then is how a machine gets left half up.
                                fields: [{
                                    name: 'force', type: 'checkbox', label: 'Pull the power instead',
                                    hint: 'Does not ask the operating system. Anything it had not written is lost, and it will not have closed its connection — this host reads it as still there for about seventy seconds.'
                                }],
                                confirm: 'Stop it',
                                onYes: function (f) { return run('vmStop', { name: v.name, force: f.force || undefined }); }
                            });
                        }}>Stop</Button>

                    <Button disabled={!v.running}
                        title={v.running ? 'what it has on screen right now' : 'it is not running'}
                        onClick={function () { run('vmScreenshot'); }}>Screenshot</Button>
                </div>

                <div className="row" style={{ marginTop: '8px' }}>
                    <Button disabled={!v.branch}
                        title={v.branch ? 'let it off ' + v.branch : 'it is not claiming anything'}
                        onClick={function () {
                            ask({
                                title: 'Let ' + v.name + ' off ' + v.branch + '?',
                                plain: [
                                    'A machine claims a branch so nothing else is given work on it at the same time.',
                                    'It is refused while the machine still holds something — that is the check, not an obstacle to work around.'
                                ],
                                cost: 'The next task may be given this branch immediately.',
                                confirm: 'Release it',
                                onYes: function () { return run('vmRelease'); }
                            });
                        }}>Release</Button>

                    <Button kind={v.forTasks === false ? 'ok' : ''}
                        onClick={function () {
                            var giving = v.forTasks === false;
                            ask({
                                title: (giving ? 'Let the queue use ' : 'Keep back ') + v.name + '?',
                                plain: giving
                                    ? ['The queue may pick this machine for work that asks for a kind it is tagged with.',
                                        (v.kinds || []).length ? 'It is tagged ' + v.kinds.join(', ') + '.' : 'It has no role tag, so the queue will still leave it alone.']
                                    : ['The queue stops picking it. Work already running on it is not touched.',
                                        'Use this to take a machine for yourself without untagging it.'],
                                confirm: giving ? 'Let it be used' : 'Keep it back',
                                onYes: function () { return run('vmForTasks', { name: v.name, on: giving }); }
                            });
                        }}>
                        {v.forTasks === false ? 'Let the queue use it' : 'Keep it back'}
                    </Button>
                </div>

                {v.installing ? <Note kind="warn">It is installing. Nothing else comes up while it does, and a restart of this app at the wrong moment throws the install away.</Note> : null}
            </Panel>
        );
    }

    //---- the right column --------------------------------------------------

    function What({ v }) {
        if (!v) return <Panel><Empty>nothing picked</Empty></Panel>;
        var sp = v.spec || {};
        var snaps = Object.keys(v.snapshots || {});
        return (
            <Panel>
                <Kv>
                    <KvRow label="state">{state(v).word}</KvRow>
                    {/* WHERE IT SAYS IT IS, AND WHEN IT LAST SAID SO. An address
                        with no time beside it is the one somebody trusts after
                        the machine has been off for a day. */}
                    <KvRow label="address">
                        <Mono>{v.lastAddress || 'not known'}</Mono>
                        {v.lastUser ? <span className="muted">{' as ' + v.lastUser}</span> : null}
                    </KvRow>
                    <KvRow label="last heard from">{when(v.lastSeenAt)}</KvRow>
                    <KvRow label="tags">
                        {(v.tags || []).length
                            ? (v.tags || []).map(function (t) { return <span key={t}><Badge>{t}</Badge>{' '}</span>; })
                            : <span className="muted">none</span>}
                    </KvRow>
                    <KvRow label="claims">{v.branch ? <Mono>{v.branch}</Mono> : <span className="muted">nothing</span>}</KvRow>
                    <KvRow label="holds a sign-in">{v.holdsCredential ? 'yes' : 'no'}</KvRow>
                    <KvRow label="snapshots">
                        {snaps.length ? snaps.join(', ') : <span className="muted">none</span>}
                        {v.baseSnapshot ? <span className="muted">{' — base is ' + v.baseSnapshot}</span> : null}
                    </KvRow>
                    <KvRow label="made">{when(v.created)}</KvRow>
                    <KvRow label="size">{(sp.cpus || '?') + ' cpu, ' + (sp.memoryMB || '?') + ' MB, ' + Math.round((sp.diskMB || 0) / 1024) + ' GB'}</KvRow>
                </Kv>
                {v.description ? <Note>{v.description}</Note> : null}
                {v.borrowed && v.borrowed.why ? <Note kind="warn">{'borrowed: ' + v.borrowed.why}</Note> : null}
            </Panel>
        );
    }

    //---- the tab -----------------------------------------------------------

    function Machines() {
        var { state: got, error, reads, again } = okc.use('vmList', {}, 5000);
        var [find, setFind] = useState('');
        //THE FILTER AND THE SELECTION SURVIVE A RESTART; the search box does
        //not. A half-typed word is not a place, and coming back to a box
        //with something in it and a list that does not match what is on the
        //machines is worse than coming back to an empty one.
        var [only, setOnly] = remember.use('machines', 'only', null);
        var [picked, setPicked] = remember.use('machines', 'picked', null);

        if (!got && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!got) return <Pane><Skeleton rows={4} /></Pane>;

        var all = got.vms || [];
        var counts = {
            running: all.filter(function (v) { return v.running; }).length,
            off: all.filter(function (v) { return !v.running && !v.installing; }).length,
            installing: all.filter(function (v) { return v.installing; }).length,
            held: all.filter(function (v) { return v.holdsCredential; }).length
        };

        var rows = all.filter(function (v) {
            if (find && (v.name + ' ' + (v.tags || []).join(' ')).toLowerCase().indexOf(find.toLowerCase()) < 0) return false;
            if (only == 'running') return v.running;
            if (only == 'off') return !v.running && !v.installing;
            if (only == 'installing') return !!v.installing;
            if (only == 'held') return !!v.holdsCredential;
            return true;
        });

        //THE PICK IS BY NAME, NOT BY OBJECT. The list is re-read every five
        //seconds, so holding the record itself would show a machine's state as
        //it was when it was clicked and never move again.
        var on = all.filter(function (v) { return v.name == picked; })[0] || null;

        var chip = function (key, word) {
            return <Chip on={only == key} count={counts[key]}
                onClick={function () { setOnly(only == key ? null : key); }}>{word}</Chip>;
        };

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}
                <Cols>
                    <Col narrow>
                        <TitleRow>Machines<Grow /><span className="muted">{all.length}</span></TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a machine or tag" />
                        <Chips>
                            {chip('running', 'running')}
                            {chip('off', 'off')}
                            {chip('installing', 'installing')}
                            {chip('held', 'holding a sign-in')}
                        </Chips>
                        <Stack>
                            {rows.length
                                ? rows.map(function (v) {
                                    return <Row key={v.name} v={v} on={v.name == picked}
                                        onPick={function () { setPicked(v.name); }} />;
                                })
                                : <Empty>{all.length ? 'nothing matches' : 'this host has no machines yet'}</Empty>}
                        </Stack>
                    </Col>

                    <Col>
                        <h2>Actions <span className="muted">{on ? '— ' + on.name : '— nothing selected'}</span></h2>
                        <Acts v={on} again={again} />
                    </Col>

                    <Col wide>
                        <h2>What it is</h2>
                        <What v={on} />
                        <Note>{'read ' + reads + ' time(s), every 5s'}</Note>
                    </Col>
                </Cols>
            </Pane>
        );
    }

    //---- where this lives, and it is not a choice -------------------------
    //
    //THE TAB NAMES ARE THE STRUCTURE. This port had been inventing its own —
    //top-level tabs for Machines, Sessions, Sign-ins and Graph, none of which
    //exist in the app being ported from, and renamed panes elsewhere. An
    //information architecture that drifts is one that has to be re-learned by
    //anybody who knows the old window, which is everybody who would use this.
    //
    //The real map is in ui/index.html over there: twelve panes under
    //Repositories, six under Runners, and the tab names as written.
    shell.tab({ name: 'Runners', order: 60 });
    shell.pane({ tab: 'Runners', name: 'Virtual machines', order: 10, Component: Machines });
    //LAST UNDER Runners, because it is about what they have COST rather than
    //what any of them is doing. Nothing on it can be acted on.
    shell.pane({ tab: 'Runners', name: 'Meter', order: 60, Component: makeMeter(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
