var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//THE MACHINES THAT ARE MINE.
//
//WHAT MAKES ONE MINE IS ALREADY IN THE REGISTER, and this pane invents nothing.
//`borrowed` is somebody using a machine right now — ../queue/policy.js checks it
//first, before every fact about the machine, because "a machine somebody is
//inside is the one the queue must not roll back". `forTasks: false` is the
//standing version of the same decision: leave this one out of the pool.
//
//SO THIS PANE IS A FILTER AND A SET OF PRESSES, and every press is an action
//that already existed. That is deliberate: a third flag meaning "mine" would
//have to be taught to the queue, the banner, the carryover and the sweep, and
//the two that exist are already understood by all four.
//
//AND IT IS WHY THE BANNER STOPS SHOUTING. ../ui/banners/trouble.js excludes a
//borrowed machine and a kept-back one from "on, doing nothing, and holding a
//worker credential" — the line that told somebody to undo the machine they were
//working in. Marking it here is what makes that line correct rather than
//suppressed.
//---------------------------------------------------------------------------

module.exports = function mine(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Button, Skeleton, Empty, Note, Notice, Mono, KvRow, Plus, ask
    } = theme;

    var when = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : 'never'; };

    //WHOSE IT IS, IN ONE PLACE. Read by the list and by the "what it is" column,
    //so the two cannot disagree about what the pane is showing.
    function isMine(v) {
        if ((v.tags || []).indexOf('supervisor') >= 0) return false;
        return !!v.borrowed || v.forTasks === false || !!v.branch;
    }

    function why(v) {
        if (v.borrowed) return 'borrowed — ' + ((v.borrowed || {}).why || 'somebody is using it');
        if (v.forTasks === false) return 'kept back from the queue';
        if (v.branch) return 'it claims ' + v.branch;
        return '';
    }

    //---- the left column ---------------------------------------------------

    function Row({ v, on, onPick }) {
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    <Mono>{v.name}</Mono>{' '}
                    <Badge kind={v.running ? 'ok' : ''}>{v.running ? (v.connected ? 'running' : 'running, not dialled in') : (v.state || 'off')}</Badge>
                </CardTitle>
                <CardSub>
                    {v.borrowed ? <span><Badge kind="run">borrowed</Badge>{' '}</span> : null}
                    {v.forTasks === false ? <span><Badge kind="warn">kept back</Badge>{' '}</span> : null}
                    {v.holdsCredential ? <span><Badge kind="warn">holding a sign-in</Badge>{' '}</span> : null}
                    {v.branch ? <span><Mono>{v.branch}</Mono></span> : null}
                </CardSub>
            </Card>
        );
    }

    //---- the middle column: the lane, in the order it is walked ------------

    function Acts({ v, again, setSaid }) {
        if (!v) return <Empty>Pick a machine, or take one below.</Empty>;

        function run(action, args) {
            return okc.call(action, args || { name: v.name }).then(function (said) {
                again();
                if (said && said.note) setSaid({ text: said.note });
                return said;
            }, function (e) {
                setSaid({ bad: true, text: e.message });
                throw e;
            });
        }

        return (
            <Panel>
                <div className="row">
                    <Button kind="ok" disabled={v.running} title={v.running ? 'it is already running' : 'start it'}
                        onClick={function () { run('vmStart'); }}>Start</Button>

                    {/* THE ONE THAT ADOPTS A MACHINE THAT IS ALREADY UP.
                        `vmBorrow` is the other way in and it brings a machine up
                        CLEAN — it refuses one that is already claiming a branch,
                        which is exactly the machine somebody has been working on
                        by hand. So taking that one is `vmForTasks`, which changes
                        nothing about the machine except that the queue leaves it
                        alone. */}
                    <Button kind={v.forTasks === false ? '' : 'ok'}
                        title={v.forTasks === false
                            ? 'put it back in the pool for the queue to use'
                            : 'keep it out of the pool — it is mine'}
                        onClick={function () {
                            var giving = v.forTasks === false;
                            ask({
                                title: (giving ? 'Give ' + v.name + ' back to the queue?' : 'Keep ' + v.name + ' for me?'),
                                plain: giving
                                    ? ['The queue may pick it up again for work tagged with a kind it has.']
                                    : ['The queue stops picking it. Nothing else about the machine changes, and '
                                        + 'anything running on it now finishes.',
                                        'It also stops the dashboard reporting it as a machine left on doing nothing.'],
                                confirm: giving ? 'Give it back' : 'Keep it',
                                onYes: function () { return run('vmForTasks', { name: v.name, enabled: giving }); }
                            });
                        }}>
                        {v.forTasks === false ? 'Give it back to the queue' : 'Keep it for me'}
                    </Button>
                </div>

                <div className="row" style={{ marginTop: '8px' }}>
                    {/*---- THE PRESS THIS WHOLE PLUGIN WAS BUILT FOR ---------

                        PURPLE, BECAUSE IT HAPPENS ON THIS DESK. Every other
                        button here puts shell down a channel and reads what comes
                        back; this opens a window on the computer the app is
                        running on. ../../CLAUDE.md's test for the mark is whether
                        reaching for it is out of bounds, and a model opening
                        windows on somebody's screen is — so the action refuses
                        the pipe and the button says why it is that colour. */}
                    <Button protect
                        disabled={!v.running || !v.connected}
                        title={!v.running
                            ? 'it is not running'
                            : !v.connected
                                ? 'it has not dialled in, so nothing knows its address yet'
                                : 'open its workspace in VS Code, over ssh, with this app\'s own key'}
                        onClick={function () {
                            setSaid({ text: 'Asking VS Code to open ' + v.name + '. It opens in its own window.' });
                            run('openEditor', { name: v.name });
                        }}>Open in VS Code</Button>

                    <Button disabled={!v.running || !v.connected}
                        title={v.running ? 'put every repository on one branch, pointed back at this host' : 'it is not running'}
                        onClick={function () {
                            ask({
                                title: 'Put a branch on ' + v.name + '?',
                                plain: [
                                    'Every repository in this workspace is checked out on one branch on the machine, '
                                        + 'with its origin pointing back at this host rather than at GitHub.',
                                    'The host moves its own checkouts off that branch first, so the machine can hold it.'
                                ],
                                fields: [{ name: 'branch', label: 'Branch', hint: 'the line the work goes on, e.g. diy/something' }],
                                confirm: 'Lay it down',
                                onYes: function (f) {
                                    if (!f.branch) throw new Error('Say which branch.');
                                    return run('vmWorkspace', { name: v.name, branch: f.branch });
                                }
                            });
                        }}>Put my branch on it</Button>
                </div>

                <div className="row" style={{ marginTop: '8px' }}>
                    {/* A SIGN-IN COMES BACK BEFORE A MACHINE IS PUT AWAY, and
                        this is the button the banner used to be the only route
                        to. It leaves the machine running, as it found it. */}
                    <Button disabled={!v.holdsCredential}
                        title={v.holdsCredential ? 'take the sign-in off it and leave it running' : 'it is holding no sign-in'}
                        onClick={function () {
                            ask({
                                title: 'Take the sign-in back off ' + v.name + '?',
                                plain: ['It leaves the machine running exactly as it is. Claude on it stops being able '
                                    + 'to authenticate until something signs in again.'],
                                confirm: 'Take it back',
                                onYes: function () { return run('credentialRecover', { name: v.name }); }
                            });
                        }}>Take the sign-in back</Button>

                    <Button kind="danger" protect
                        disabled={!v.borrowed && v.forTasks !== false && !v.branch}
                        title="give it back: release the claim, and put it away clean unless told otherwise"
                        onClick={function () {
                            ask({
                                title: 'Give ' + v.name + ' back?',
                                plain: [
                                    'It stops being mine: the claim goes, and the queue may pick it up again.',
                                    v.holdsCredential ? 'It is still holding a sign-in — take that back first, or it goes with the disk.' : null
                                ],
                                cost: 'Unless "leave it as it is" is ticked, the machine is put away clean — rolled back to its base snapshot.',
                                fields: [{
                                    name: 'keep', type: 'checkbox', label: 'Leave it as it is',
                                    hint: 'Releases the claim and changes nothing on the disk. Use this when the work on it is not finished.'
                                }],
                                confirm: 'Give it back',
                                onYes: function (f) { return run('vmReturn', { name: v.name, keep: f.keep || undefined }); }
                            });
                        }}>Give it back</Button>
                </div>

                {v.holdsCredential
                    ? <Note kind="warn">It is holding a sign-in. Nothing else is watching this now that the machine is
                        mine — the dashboard's banner deliberately leaves a machine alone once somebody has taken it —
                        so taking it back before this machine is put away or powered off is this pane's job.</Note>
                    : null}
            </Panel>
        );
    }

    //---- the right column --------------------------------------------------

    function What({ v, host }) {
        if (!v) return <Empty>nothing selected</Empty>;
        var sp = v.spec || {};
        return (
            <Panel>
                <KvRow label="state">{v.running ? (v.connected ? 'running' : 'running, not dialled in') : (v.state || 'off')}</KvRow>
                <KvRow label="mine because">{why(v) || <span className="muted">it is not mine</span>}</KvRow>
                <KvRow label="claims">{v.branch ? <Mono>{v.branch}</Mono> : <span className="muted">nothing</span>}</KvRow>
                <KvRow label="holds a sign-in">{v.holdsCredential ? 'yes' : 'no'}</KvRow>
                <KvRow label="reached as">
                    {host ? <Mono>{host.alias}</Mono> : <span className="muted">it has not dialled in</span>}
                </KvRow>
                <KvRow label="address">
                    {host ? <Mono>{host.user + '@' + host.address}</Mono> : <span className="muted">not recorded</span>}
                </KvRow>
                <KvRow label="this app's key">
                    {host
                        ? (host.usesOurKey ? 'yes' : 'no — it was built with a different key')
                        : <span className="muted">not known</span>}
                </KvRow>
                <KvRow label="workspace">{sp.folder ? <Mono>{sp.folder}</Mono> : <span className="muted">the default</span>}</KvRow>
                <KvRow label="last heard from">{when(v.lastSeenAt)}</KvRow>
            </Panel>
        );
    }

    //---- the pane ----------------------------------------------------------

    function Mine() {
        var { state: got, error, again } = okc.use('vmList', {}, 5000);
        //THE ALIASES COME FROM THE PLUGIN THAT WRITES THEM. ../keys already
        //answers with the reading ../core/ssh writes its config file FROM, so
        //this pane does not work out a second one — two readings of one register
        //is how a pane says a machine is reachable while the file describing it
        //says nothing about it.
        var { state: conf } = okc.use('sshConfig', {}, 15000);
        var [picked, setPicked] = remember.use('diy', 'machine', null);
        var [said, setSaid] = useState(null);

        function take() {
            ask({
                title: 'Take a machine for myself',
                plain: [
                    'It comes out of the pool and is brought up clean, for you to work in. The queue will not touch it.',
                    'A machine that is already claiming a branch cannot be taken this way — pick it in the list and '
                        + 'press "Keep it for me" instead.'
                ],
                fields: [
                    { name: 'why', label: 'What for', hint: 'said in the log and on the machine, so anybody looking knows why it is out of the pool' },
                    { name: 'tag', label: 'A kind of machine', hint: 'optional — worker, judge. Leave it empty to take whichever is free.' }
                ],
                confirm: 'Take one',
                onYes: function (f) {
                    return okc.call('vmBorrow', { why: f.why, tag: f.tag || undefined }).then(function (r) {
                        if (r && r.name) setPicked(r.name);
                        again();
                        setSaid({ text: (r && r.note) || 'Taken.' });
                    }, function (e) { setSaid({ bad: true, text: e.message }); throw e; });
                }
            });
        }

        if (!got && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!got) return <Pane><Skeleton rows={4} /></Pane>;

        var all = got.vms || [];
        var rows = all.filter(isMine);
        var on = all.filter(function (v) { return v.name == picked; })[0] || null;

        var hosts = {};
        ((conf && conf.hosts) || []).forEach(function (h) { hosts[h.name] = h; });

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Cols>
                    <Col narrow>
                        <TitleRow>
                            Mine<Grow />
                            <span className="muted">{rows.length}</span>
                            <Plus title="Take a machine out of the pool for yourself" onClick={take} />
                        </TitleRow>
                        <Stack>
                            {rows.length
                                ? rows.map(function (v) {
                                    return <Row key={v.name} v={v} on={v.name == picked}
                                        onPick={function () { setPicked(v.name); }} />;
                                })
                                : <Empty>No machine is yours yet. Take one with +, or keep one back in Runners.</Empty>}
                        </Stack>
                    </Col>

                    <Col>
                        <h2>Actions <span className="muted">{on ? '— ' + on.name : '— nothing selected'}</span></h2>
                        <Acts v={on} again={again} setSaid={setSaid} />
                    </Col>

                    <Col wide>
                        <h2>What it is</h2>
                        <What v={on} host={on ? hosts[on.name] : null} />
                        <Note>This is your own lane. Nothing here is queued, nothing judges what you do on it, and
                            the branch it commits on is the one you put there.</Note>
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Mine;
};
