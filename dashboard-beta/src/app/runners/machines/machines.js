var React = require('react');
var { useState } = React;

module.exports = function machines(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Notice, Mono, Kv, KvRow, Plus, ask
    } = theme;

    var when = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : 'never'; };

    function state(v) {
        if (v.running) return { kind: 'ok', word: v.connected ? 'running' : 'running, not dialled in' };
        //`said` IS THE GUEST'S OWN WORD, and `stage` is this app's — see
        //../../vms/ours/store.js, which derives `stage` on every read. This line
        //asked for `stage` and got "installing — installing"; the step the
        //installer is actually on only exists in what the machine reported.
        if (v.installing) return { kind: 'run', word: 'installing' + (v.said ? ' — ' + v.said : '') };
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
        var [said, setSaid] = useState(null);

        //---- MAKING ONE, WHICH THIS PANE COULD NOT DO ----------------------
        //
        //THE LIST CAME ACROSS AND THE WAY TO ADD TO IT DID NOT. Every act this
        //pane offers reads. `vmCreate` has been answerable the whole time with
        //nothing anywhere to press it, so a workspace with no machines had a
        //Runners tab that could only describe an empty list \u2014 and thirty-two
        //of the thirty-four vm actions were in the same position.
        //
        //THE TWO LISTS ARE FETCHED FIRST, because a dialog cannot wait on a read
        //and both decide what its fields OFFER: which installer images this
        //computer already has, and which public keys could be authorised.
        //Typing an absolute path from memory is how a machine gets made with no
        //installer on it.
        //
        //MAKE, THEN INSTALL \u2014 TWO ACTS, NOT ONE. They fail differently and the
        //second takes about twenty-five minutes: if the install will not start,
        //the machine still exists and can be told to try again. The app being
        //ported from does the same, for the same reason.
        function makeOne() {
            Promise.all([okc.call('vmIsos', {}), okc.call('hostKeys', {})]).then(function (answers) {
                var isos = (answers[0] && answers[0].isos) || [];
                var keys = (answers[1] && answers[1].keys) || [];

                ask({
                    title: 'Make a virtual machine',
                    plain: [
                        'It makes the machine and its disk, then starts it and installs the operating system on its own.',
                        'As that finishes it fetches its own setup scripts from here and runs them, reporting into the live log.',
                        'It takes a long while \u2014 watch it on Live, or with a screenshot from its card.',
                        'Only machines made here ever appear in this list, and nothing else on this computer is touched.'
                    ],
                    fields: [
                        {
                            name: 'name', label: 'Name', needed: true, placeholder: 'dev1',
                            hint: 'letters, numbers, dots or dashes \u2014 no spaces'
                        },
                        {
                            name: 'iso',
                            label: isos.length ? 'Installer image' : 'Installer image \u2014 VirtualBox knows of none, so type a path',
                            value: isos.length ? isos[0].location : '',
                            options: isos.length
                                ? [{ value: '', label: 'none for now' }].concat(isos.map(function (i) {
                                    return { value: i.location, label: i.name };
                                }))
                                : undefined,
                            placeholder: 'a path to an .iso on this computer',
                            //THE SERVER IMAGE IS THE ONE TO USE. A desktop image is
                            //not wrong, it is redundant: the box below installs a
                            //small desktop onto a server machine, and a desktop
                            //image arrives with a large one on it already.
                            hint: 'Ubuntu server, downloaded once and kept \u2014 it installs in about twelve minutes, against twenty-five for a desktop image.'
                        },
                        { name: 'memoryMB', label: 'Memory, in MB', value: '8192', type: 'number' },
                        { name: 'cpus', label: 'Processors', value: '4', type: 'number' },
                        { name: 'diskMB', label: 'Disk, in MB', value: '61440', type: 'number' },
                        {
                            name: 'network', label: 'Network', value: 'bridged',
                            options: [
                                { value: 'bridged', label: 'bridged \u2014 it can reach this app' },
                                { value: 'nat', label: 'nat \u2014 private, with a forwarded ssh port' }
                            ]
                        },
                        {
                            name: 'desktop', label: 'Give it a desktop', type: 'checkbox', value: false,
                            hint: 'Off is a terminal-only runner: no display manager, no session, a fraction of the memory. On installs a small desktop that logs itself in, for a machine somebody is going to sit at. This cannot be changed later.'
                        },
                        {
                            name: 'supervisor', label: 'Supervisor machine', type: 'checkbox', value: false,
                            hint: 'Off is an ordinary runner that takes tasks. On makes a machine that decides what work to give instead of doing any: permanently out of the queue, holding no repositories, with a slim setup. This cannot be changed later.'
                        },
                        {
                            name: 'tags', label: 'Tags (optional, comma separated)', value: '',
                            placeholder: 'test, judge, on-the-bench',
                            hint: 'What kind of machine this is, so work can ask for a kind rather than a name. Changeable later.'
                        },
                        { name: 'user', label: 'User to create', value: 'okc' },
                        { name: 'password', label: 'Its password', value: 'okc' },
                        {
                            name: 'sshKey',
                            label: keys.length ? 'Authorise one of your ssh keys on it' : 'Your public ssh key \u2014 none found, so paste one',
                            value: keys.length ? keys[0].key : '',
                            options: keys.length
                                ? keys.map(function (k) { return { value: k.key, label: k.file + ' \u2014 ' + k.comment }; })
                                    .concat([{ value: '', label: 'none, use the password' }])
                                : undefined,
                            placeholder: 'ssh-ed25519 AAAA...'
                        }
                    ],
                    cost: 'It builds a disk and installs an operating system, which takes about twenty-five minutes and holds this host while it starts.',
                    confirm: 'Make it',
                    onYes: function (f) {
                        var vm = Object.assign({}, f, {
                            memoryMB: Number(f.memoryMB),
                            cpus: Number(f.cpus),
                            diskMB: Number(f.diskMB)
                        });

                        return okc.call('vmCreate', { vm: vm }).then(function () {
                            setPicked(f.name);
                            again();

                            //NOTHING TO INSTALL IS NOT A FAILURE. A machine can be
                            //made now and given an image later.
                            if (!f.iso) {
                                setSaid({ text: f.name + ' made. It has no installer image, so there is nothing to install yet.' });
                                return;
                            }

                            return okc.call('vmInstall', { name: f.name }).then(function () {
                                setSaid({ text: f.name + ' is installing and will set itself up. Watch it on Live.' });
                                again();
                            }, function (e) {
                                //THE MACHINE EXISTS EITHER WAY, which is the whole
                                //reason these are two acts and not one.
                                setSaid({ bad: true, text: f.name + ' was made, but the install would not start: ' + e.message });
                            });
                        }, function (e) { setSaid({ bad: true, text: e.message }); throw e; });
                    }
                });
            }, function (e) {
                setSaid({ bad: true, text: 'Could not read what this computer has to build from: ' + e.message });
            });
        }

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
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Cols>
                    <Col narrow>
                        <TitleRow>
                            Machines<Grow />
                            <span className="muted">{all.length}</span>
                            <Plus title="Make a virtual machine, and install an operating system on it" onClick={makeOne} />
                        </TitleRow>
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

    return Machines;
};
