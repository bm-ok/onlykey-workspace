var React = require('react');
var { useState } = React;
var useAsk = require('../okc/ask');

//the Sessions tab: what the work on a branch line remembers.
//
//THE TAB EXISTS BECAUSE THE THING IT SHOWS USED TO NOT EXIST. A machine is
//rolled back when its work ends, so a worker's memory would have died with it —
//a task given out twice was two strangers rather than one worker having a
//second go. The host copies ~/.claude out when a run ends and unpacks it before
//the next run starts, and this is where you watch that happening. It is also
//the only place a conversation that has gone somewhere you do not want it
//carrying on from can be stopped.
//
//OVER THERE IT IS A SUB-TAB OF RUNNERS, because what a worker remembered is a
//fact about a runner. The beta shell has one flat bar and no sub-tabs, so it
//sits next to Machines instead and is ordered to land beside it.
//
//ONE CALL, AND DELIBERATELY NO SECOND ONE. `sessions` returns
//{sessions[], bytes, where, note} whole; `inside` is a summary read out of the
//gzip ONCE, when it arrived, so this panel reads a small object instead of
//gunzipping ninety kilobytes on a refresh loop. The singular `session` action
//exists and this tab must not call it — it answers "has this task got a memory
//yet" for a task that has never run, which is a different question.
//
//ALL THE `changed()` BOOKKEEPING FROM THE OLD PANE IS GONE, and that is the
//point of the port rather than an omission. Over there every paint compares a
//signature and returns early, because rewriting text that is IDENTICAL destroys
//a selection somebody is in the middle of making — and this panel is full of
//mono values people copy by hand. Here that is React's job. Select the
//conversation id and leave it selected while the read count ticks.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono, Button, ago } = theme;

    //FORGETTING A SESSION IS PROPOSED AS A PERSON'S PRESS.
    //
    //A session is the record of what a machine was actually asked and what it
    //actually said — the only account of a run that survives the machine being
    //put back to its snapshot. Forgetting one is not deleting a row; it is
    //deleting the answer to "what happened", and the question always gets asked
    //later than the deletion.
    //
    //The second press, the one behind "Yes, forget it", is guarded rather than
    //the first: arming it shows what is about to go, which is reading.

    //A 1 KB FLOOR, NOT A ROUNDING. Two of the archives on this host are 185 and
    //186 bytes; without the floor they read "0 KB", which looks like an empty
    //file rather than a tiny one.
    function size(bytes) {
        var n = bytes || 0;
        if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
        return Math.max(1, Math.round(n / 1024)) + ' KB';
    }

    //THE BRANCH LINE, BECAUSE THAT IS WHAT A CONVERSATION IS ABOUT. This led
    //with "#42 <task title>" once, and the question somebody has in front of a
    //list of these is WHICH LINE IT WAS RUN UNDER — which a task number does
    //not answer, and answers less every time a session outlives the task that
    //started it. A row saying "#42, task gone" is true and tells you nothing.
    function lineOf(s) {
        return s.about || s.branch || s.title || (s.number ? '#' + s.number : (s.taskId || s.uid));
    }

    //TWO ROWS WITH THE SAME BRANCH LINE ARE TWO DIFFERENT CONVERSATIONS — the
    //one that wrote the line and the one that read it. Never deduped by branch,
    //and the colours differ on purpose so they cannot be mistaken for each
    //other at a glance.
    function Lane({ lane }) {
        if (!lane) return null;
        return <Badge kind={lane == 'judge' ? 'run' : 'ok'}>{lane}</Badge>;
    }

    function Row({ k, mono, copy, children }) {
        return (
            <tr>
                <th>{k}</th>
                <td className={mono ? 'mono' : ''} style={copy ? { userSelect: 'text' } : undefined}>{children}</td>
            </tr>
        );
    }

    function List({ rows, picked, onPick }) {
        if (!rows.length) {
            return <Empty>Nothing yet. A worker started by a job hands its memory back when it finishes, and gets it again the next time that task runs.</Empty>;
        }
        return (<>
            {rows.map(function (s) {
                return (
                    <div key={s.uid}
                        className={'card pick' + (s.uid == picked ? ' on' : '')}
                        onClick={function () { onPick(s.uid); }}>
                        <div className="card-title">
                            <span className="grow">{lineOf(s)}</span>
                            <Lane lane={s.lane} />
                            {/* ORPHANED IS THE NORMAL STATE HERE, NOT AN ERROR:
                                42 of the 45 rows on this host are orphans. A
                                session filed under a branch line is SUPPOSED to
                                outlive its task — what was produced outlives
                                the note about it — so this is said only where
                                there is no line to show instead. A blanket
                                orphan badge marks 93% of the list as broken. */}
                            {s.orphaned && !s.about && !s.branch ? <Badge kind="muted">task gone</Badge> : null}
                        </div>
                        <div className="card-sub">
                            {(s.number ? '#' + s.number + ' · ' : '') +
                                (s.runs || 1) + ' run' + ((s.runs || 1) == 1 ? '' : 's') + ' · ' + size(s.bytes)}
                        </div>
                        <div className="card-sub">
                            {'last kept ' + ago(s.kept) + (s.machine ? ' from ' + s.machine : '')}
                        </div>
                    </div>
                );
            })}
        </>);
    }

    //WHAT THE WORKER ACTUALLY DID, which is the question a run's log cannot
    //answer.
    function Inside({ inside }) {
        if (!inside) return null;

        //AN UNREADABLE ARCHIVE IS NOT AN EMPTY RUN, and it is byte-identical to
        //one: all four of these on this host carry turns:0, no tools, no model,
        //no tokens — exactly what a worker that genuinely did nothing looks
        //like. So it replaces the whole table rather than rendering as zeros.
        if (inside.unreadable) {
            return (<>
                <div className="card-title">What it did</div>
                <Note kind="warn">{'The archive is kept, and could not be read to summarise: ' + inside.unreadable}</Note>
            </>);
        }

        var tools = inside.tools || [];
        var touched = inside.touched || [];
        return (<>
            <div className="card-title">What it did</div>
            <table className="kv">
                <tbody>
                    {/* A CRASHED RUN AND A SHORT ONE READ ALIKE WITHOUT THIS.
                        One row here is 9 turns, 1 API error, no model and no
                        tokens: a run that fell over at sign-in. Dropping the
                        error count makes it read as a normal tiny run. */}
                    <Row k="turns">{inside.turns + (inside.errors ? ' — ' + inside.errors + ' of them an API error' : '')}</Row>
                    <Row k="model" mono>{inside.model || 'not recorded'}</Row>
                    <Row k="tools">
                        {tools.length
                            ? tools.map(function (t) { return t.name + ' ×' + t.n; }).join(', ')
                            : 'it ran nothing'}
                    </Row>
                    <Row k="files touched" mono copy>
                        {touched.length
                            ? touched.join(', ') + (inside.moreTouched ? ' and ' + inside.moreTouched + ' more' : '')
                            : 'none'}
                    </Row>
                    {/* CACHE READS DWARF THE REST BY TWO ORDERS OF MAGNITUDE
                        and that is the ordinary shape of a resumed
                        conversation — 1.3M to 5.2M read against ~30k out. Said
                        plainly, and not as the headline number, so it does not
                        read as a fault. */}
                    <Row k="tokens">
                        {inside.tokens
                            ? inside.tokens.in + ' in, ' + inside.tokens.out + ' out, ' +
                              (inside.tokens.cache || 0).toLocaleString() + ' read from cache'
                            : 'not recorded'}
                    </Row>
                    <Row k="talked for">
                        {inside.from && inside.to
                            ? Math.max(1, Math.round((Date.parse(inside.to) - Date.parse(inside.from)) / 1000)) + 's, ending ' + ago(inside.to)
                            : 'not recorded'}
                    </Row>
                    <Row k="transcript" mono copy>{inside.transcript || '—'}</Row>
                </tbody>
            </table>
        </>);
    }

    function Detail({ s, onForget }) {
        //TWO STEPS, BECAUSE THE OLD PANE PUT THIS BEHIND A CONFIRM DIALOG WITH
        //A COST LINE. The beta shell has no dialog service yet, so the same
        //sentences are said in place and the button has to be pressed twice.
        //What must not happen is one press deleting a transcript.
        var [armed, setArmed] = useState(false);
        var [said, setSaid] = useState(null);

        if (!s) return <Empty>Pick one on the left.</Empty>;

        function showInFolder() {
            //DO NOT ASSUME A FILE MANAGER EXISTS. The window runs under nw.js
            //here and plainly in a browser during development, where there is
            //nothing to open a folder with — and pretending otherwise is a
            //button that does nothing and says nothing.
            var nwShell = typeof nw != 'undefined' && nw.Shell;
            if (!nwShell) return setSaid({ kind: 'bad', text: 'This window cannot open a file manager here.' });
            nwShell.showItemInFolder(s.path);
        }

        function forget() {
            setArmed(false);
            //BY UID, NOT BY TASK ID. These outlive their tasks on purpose, so
            //the name that still resolves after a board is cleared is the uid —
            //passing the task id answered "there is no task called…" about a
            //row sitting on the screen in front of you.
            okc.call('sessionForget', { id: s.uid }).then(function () {
                setSaid({ kind: 'warn', text: 'Forgotten. The next run starts fresh.' });
                onForget();
            }, function (e) {
                setSaid({ kind: 'bad', text: e.message });
            });
        }

        return (<>
            <div className="card-title titlerow">
                <span className="grow">{lineOf(s)}</span>
                <Lane lane={s.lane} />
                <Badge kind="ok">{(s.runs || 1) + ' run' + ((s.runs || 1) == 1 ? '' : 's')}</Badge>
            </div>

            <table className="kv">
                <tbody>
                    {/* WHICH CONVERSATION, spelled out, because it is the value
                        a run is resumed with and the one thing somebody would
                        want to check against a transcript by hand. It is not
                        `uid`, which is what the archive is filed under, and not
                        `taskId`, which often resolves to nothing. */}
                    <Row k="conversation" mono copy>{s.id || 'not recorded'}</Row>
                    <Row k="task" mono>{s.taskId || '—'}</Row>
                    <Row k="branch line" mono>{s.about || s.branch || '—'}</Row>
                    {/* A NULL LANE MEANS "KEPT BEFORE LANES WERE", not
                        "unknown" and not "worker" — 20 of the rows here. The
                        action fills a lane by LOOKUP on the task board, so
                        found-on-the-board means it was worked; a judgement is
                        never on that board and is never given a lane this way,
                        and anything unrecoverable is left empty. Defaulting it
                        to worker invents the answer. */}
                    <Row k="lane" mono>
                        {s.lane
                            ? s.lane + ' — ' + (s.lane == 'judge' ? 'a reading of that line' : 'work done on that line')
                            : 'not recorded — kept before lanes were'}
                    </Row>
                    <Row k="last machine" mono>{s.machine || '—'}</Row>
                    {/* PROVENANCE, NOT OWNERSHIP, and the old panel showed
                        neither. `guest` is which sign-in was on the machine for
                        the last run; `guests` is every sign-in that has ever
                        carried this conversation. A key can be swapped and the
                        conversation survives — that is the design, and nothing
                        in this path refuses for credential reasons. */}
                    <Row k="signed by" mono>{s.guest || 'not recorded'}</Row>
                    <Row k="sign-ins" mono>
                        {(s.guests || []).length
                            ? s.guests.join(', ') + (s.guests.length > 1 ? ' — it has been carried by more than one' : '')
                            : 'none recorded'}
                    </Row>
                    <Row k="last run" mono>{s.run || '—'}</Row>
                    <Row k="folder" mono copy>{s.folder || '—'}</Row>
                    <Row k="first kept">{s.first ? ago(s.first) : '—'}</Row>
                    <Row k="last kept">{ago(s.kept)}</Row>
                    <Row k="size">{size(s.bytes)}</Row>
                    <Row k="kept at" mono copy>{s.path}</Row>
                </tbody>
            </table>

            {/* RESUMPTIONS OF ONE CONVERSATION, NOT A COUNT OF CONVERSATIONS.
                Eleven rows here have run more than once and one has run five
                times; `first` and `kept` bracket it. "5 runs" must not be read
                as five sessions. */}
            {(s.runs || 1) > 1
                ? <Note>{'The same conversation, resumed ' + s.runs + ' times — first kept ' + ago(s.first) + ', last kept ' + ago(s.kept) + '.'}</Note>
                : null}

            <Inside inside={s.inside} />

            <div className="card-title">The archive</div>
            <Note>The whole of the worker's ~/.claude, as a gzip — the transcript, which project folder it belongs to, and its settings. It is unpacked onto whichever machine picks this task up next, so the worker carries on instead of meeting the work again.</Note>
            {/* LOAD-BEARING, NOT DECORATION. A machine is handed a credential
                on its way up and it is taken back on the way down; a copy
                riding along in here would be an unsealed one per task. Dropping
                this paragraph makes the pane look like it ships a token to
                whichever machine picks the task up next. */}
            <Note>The credential is deliberately not in it. A machine is handed one on its way up and it is taken back on the way down; a copy riding along in here would be an unsealed one per task.</Note>

            {said ? <Note kind={said.kind}>{said.text}</Note> : null}

            {armed ? (<>
                <Note kind="bad">The transcript of everything this worker was told and decided is deleted from this host, and the machines that made it are long gone.</Note>
                <Note>The next run of this task starts a fresh conversation, with no memory of the ones before it.</Note>
                <Note>The task, its branch, the files it handed over and its logs are all untouched.</Note>
            </>) : null}

            <div className="row">
                <Button kind="small" title="Open the folder it is kept in" onClick={showInFolder}>Show in folder</Button>
                {/* THE OLD PANE HAS A "GO TO THE TASK" BUTTON HERE, drawn only
                    when the task is still on the board — offering it for an
                    orphan is a button that switches tab and lands on nothing.
                    The beta shell's whole surface is `shell.tab()`; there is no
                    way to move to another tab and pick something in it, so the
                    same condition says where to look instead of pretending to
                    take you there. */}
                {s.taskId && !s.orphaned
                    ? <span className="empty">{'still on the board as '}<Mono>{s.taskId}</Mono>{' — over on Tasks'}</span>
                    : null}
                {armed
                    ? (<>
                        <Button kind="small danger" protect onClick={forget}>Yes, forget it</Button>
                        <Button kind="small" onClick={function () { setArmed(false); }}>Keep it</Button>
                    </>)
                    : <Button kind="small danger" onClick={function () { setSaid(null); setArmed(true); }}>Forget it</Button>}
            </div>
        </>);
    }

    function Sessions() {
        var { state, error, reads } = useAsk(okc, 'sessions', {}, 5000);
        var [picked, setPicked] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Empty>asking…</Empty></Pane>;

        var rows = state.sessions || [];
        //THINGS GET FORGOTTEN AND BOARDS GET CLEARED, so a pick that is no
        //longer in the list falls back to the first row rather than leaving the
        //panel pointing at nothing.
        var here = rows.some(function (s) { return s.uid == picked; });
        var on = here ? picked : (rows.length ? rows[0].uid : null);
        var one = rows.filter(function (s) { return s.uid == on; })[0] || null;

        return (
            <Pane>
                {/* THE ERROR SITS ABOVE THE LAST GOOD ANSWER rather than
                    replacing it. "I could not ask" and "there is nothing
                    remembered" are different sentences, and showing the second
                    for the first is how somebody concludes their archives are
                    gone. */}
                {error ? <Note kind="bad">{error}</Note> : null}

                <Panel>
                    <div className="card-title">
                        {'Remembered ' + (rows.length ? '— ' + rows.length + ', ' + size(state.bytes) : '— none yet')}
                    </div>
                    <Note>{state.note}</Note>
                    {state.where ? <p className="note muted mono">{state.where}</p> : null}
                </Panel>

                <div className="cols">
                    <div className="col narrow">
                        <div className="stack">
                            <List rows={rows} picked={on} onPick={setPicked} />
                        </div>
                    </div>
                    <div className="col wide">
                        <Panel>
                            {/* KEYED ON THE PICK so the confirm on the danger
                                button cannot survive a change of row. Arming
                                one archive and deleting a different one is the
                                one mistake this panel must not allow. */}
                            <Detail key={on} s={one} onForget={function () { setPicked(null); }} />
                        </Panel>
                    </div>
                </div>

                <Note>{'read ' + reads + ' time(s), every 5s'}</Note>
            </Pane>
        );
    }

    shell.pane({ tab: 'Runners', name: 'Claude Sessions', order: 50, Component: Sessions });

    await register(null, {});
}
module.exports = plugin;
