var React = require('react');
var { useState, useEffect } = React;

module.exports = function general(theme, okc, shell) {
    var { Pane, Panel, Badge, Empty, Note, Mono, ask } = theme;

    //ONCE PER REQUEST, kept outside the component so it survives the tab being
    //switched away from and back. Keyed on when the request was made: the reads
    //below land every five seconds, and without this the question reappears on
    //every one of them. A dialog somebody dismisses without reading is the
    //opposite of having asked them.
    var askedShown = null;

    function ago(at) {
        var ms = Date.now() - new Date(at).getTime();
        if (!(ms >= 0)) return 'just now';
        var m = Math.round(ms / 60000);
        if (m < 1) return 'less than a minute ago';
        if (m < 60) return m + ' minute' + (m == 1 ? '' : 's') + ' ago';
        var h = Math.round(m / 60);
        if (h < 48) return h + ' hour' + (h == 1 ? '' : 's') + ' ago';
        return Math.round(h / 24) + ' days ago';
    }

    //A SENTENCE THAT HAS TO BE FOUND, drawn as a bordered line rather than as
    //another grey paragraph. `.note.warn` matches a class that exists and no
    //rule that draws anything — so over in the old window the standing request
    //and the refusal, the two things a person came here to read, rendered
    //identically to the explanatory prose around them. `.authline` is the
    //stylesheet's existing "one fact, with an edge saying how it went": warn by
    //default, ok when it is good news. Used rather than adding a rule, because
    //the theme is shared and not this tab's to edit.
    function Line({ kind, children }) {
        return <div className={'authline' + (kind ? ' ' + kind : '')}>{children}</div>;
    }

    //THE DRILLS, AND THE ONE THING THAT MAKES THEM DANGEROUS. They drive this
    //app for real: one writes a task and removes it again, one takes a
    //credential off a machine and puts it back. Against three scaffolding
    //repositories that is what they are for; against somebody's actual work it
    //is a stranger typing into their repository, and nothing here can tell the
    //two apart. So the card leads with the folder.
    function Sandbox({ t }) {
        var sb = t.sandbox || { list: [], owners: [] };
        var [adding, setAdding] = useState('');
        var [note, setNote] = useState(null);
        function write(list) {
            setNote(null);
            return okc.call('settingSet', { name: 'testsSandbox', value: list }).then(
                function () { setAdding(''); },
                function (e) { setNote({ bad: true, text: e.message }); }
            );
        }
        var seen = {};
        (sb.owners || []).forEach(function (o) { [o.owner].concat(o.chain || []).forEach(function (n) { if (n) seen[n] = true; }); });
        var here = Object.keys(seen).sort();
        return (
            <div style={{ marginTop: '10px' }}>
                <div className="card-title">
                    <span className="grow">Sandbox owners</span>
                    <Badge kind={sb.list.length ? 'ok' : 'warn'}>{sb.list.length ? sb.list.length + ' named' : 'nothing named — any remote'}</Badge>
                </div>
                <div className="muted" style={{ fontSize: '12px', margin: '4px 0 6px' }}>
                    GitHub owners a drill may touch. With names here, every repository's remote and its whole chain must belong to one, or the drills refuse and say which does not.
                    {here.length ? ' This workspace reaches: ' + here.join(', ') + '.' : ''}
                </div>
                <div className="row">
                    {sb.list.map(function (n) {
                        return (
                            <span key={n} className="badge">
                                <Mono>{n}</Mono>
                                <button className="btn" style={{ marginLeft: '6px', padding: '0 6px' }} title={'Take ' + n + ' off the list'}
                                    onClick={function () { write(sb.list.filter(function (x) { return x !== n; })); }}>×</button>
                            </span>
                        );
                    })}
                </div>
                <div className="row" style={{ marginTop: '6px' }}>
                    <input value={adding} placeholder="a GitHub owner, e.g. bm-sandbox-a"
                        onChange={function (e) { setAdding(e.target.value); }}
                        onKeyDown={function (e) { if (e.key === 'Enter' && adding.trim()) write(sb.list.concat([adding.trim()])); }} />
                    <button className="btn" disabled={!adding.trim()} onClick={function () { write(sb.list.concat([adding.trim()])); }}>Add owner</button>
                    {here.length && !sb.list.length
                        ? <button className="btn" title="Name every owner this workspace reaches today" onClick={function () { write(here); }}>Name what is here</button>
                        : null}
                </div>
                {note ? <Line kind="bad">{note.text}</Line> : null}
            </div>
        );
    }

    function TestCard({ t, asked, onOff, onAsk, said }) {
        var on = !!t.enabled;
        //TAKEN FROM THE ACTION RATHER THAN RECOMPUTED. It is the same string
        //equality either way, and computing it twice is how a card comes to
        //disagree with the refusal a drill was given.
        var here = !!t.allowed;
        //A request standing about THIS folder. One raised against another
        //workspace is not a question anybody here can answer — and testsAnswer
        //re-checks the folder itself and clears such a request rather than
        //honouring it, so showing it would only invite an answer about the
        //wrong place.
        var standing = asked && !here && asked.forDir === t.openDir ? asked : null;

        return (
            <div className={'card' + (on && !here ? ' warn' : '')}>
                <div className="card-title">
                    <span className="grow">Run the drills against this workspace</span>
                    {/* THREE STATES, NOT A BOOLEAN. Off wears the plain badge,
                        which in this stylesheet is already the muted one —
                        `.badge` and `.badge.muted` are the same grey, and a
                        state nobody has acted on should read as quiet rather
                        than as a warning. */}
                    {here
                        ? <Badge kind="ok">on, here</Badge>
                        : on
                            ? <Badge kind="warn">on, elsewhere</Badge>
                            : <Badge>off</Badge>}
                </div>

                {/* ASKED, AND STILL WAITING — on the card as well as in the
                    dialog, for the same reason the dialog has a "No" button. */}
                {standing
                    ? <Line><strong>{'Asked ' + ago(standing.at) + ': '}</strong><span>{standing.why}</span></Line>
                    : null}

                <p className="note">
                    The drills in the Test tab drive this app for real — one writes a task and removes it
                    again, one takes the worker credential off a machine, proves a signed-out machine is
                    refused work, and puts it back. Against scaffolding repositories that is exactly what
                    they are for. Against work you care about it is a stranger typing into your repository,
                    and this app cannot tell the two apart, so it does not guess.
                </p>

                {/* BOTH ROWS, EVEN WHEN THEY MATCH. That redundancy is the check
                    somebody came here to make. Raw, and selectable: the server
                    compares these strings as they are, so prettying the case or
                    the separators would make the pane disagree with the
                    predicate it is reporting. */}
                <table className="kv">
                    <tbody>
                        <tr>
                            <th>turned on for</th>
                            {/* TWO DIFFERENT EMPTY STATES. A null `forDir` is a
                                fact about the setting — turning off writes it
                                away in the same act — and a null `openDir` is a
                                fact about the app. */}
                            <td style={{ userSelect: 'text' }}><Mono>{t.forDir || '—'}</Mono></td>
                        </tr>
                        <tr>
                            <th>open now</th>
                            <td style={{ userSelect: 'text' }}><Mono>{t.openDir || 'nothing is open'}</Mono></td>
                        </tr>
                    </tbody>
                </table>

                {/* WHY, IN THE WORDS THE ACTION USES. Three different reasons
                    arrive here — switched off, no workspace open, on for a
                    different folder — and it is rendered verbatim so that a
                    person reading this card and a model reading a refusal on the
                    command line are looking at one sentence rather than two
                    wordings of it. */}
                {!here
                    ? <Line>{t.why}</Line>
                    : <Line kind="ok">On for the folder open now. Opening a different workspace switches this off — it is on for a place, not on in general.</Line>}

                {/* WHAT THE LAST PRESS ANSWERED, said where the press was made.
                    Over the wire these two writes are refused on purpose; the
                    refusal is a sentence worth reading rather than a button that
                    silently does nothing. */}
                {said ? <Line kind={said.bad ? 'bad' : 'ok'}>{said.text}</Line> : null}

                {/* THE SANDBOX LIST, BESIDE THE SWITCH. With names on it the
                    drills may only touch repositories whose remote, and whose
                    whole chain, belong to one of them; the refusal above names
                    the offender. Empty checks nothing. */}
                <Sandbox t={t} said={said} />

                <div className="row" style={{ marginTop: '8px' }}>
                    {on
                        //Switching off is free and asks nothing.
                        ? <button className="btn" onClick={function () { onOff(); }}>Switch them off</button>
                        : <button className="btn danger" disabled={!t.openDir}
                            onClick={function () { if (t.openDir) onAsk(); }}>
                            {t.openDir ? 'Turn them on for this workspace' : 'No workspace is open'}
                        </button>}
                </div>
            </div>
        );
    }

    //THE DIALOG USED TO BE WRITTEN OUT HERE, and that is the drift this port was
    //meant to catch. It was a fair copy — an overlay, a body, three buttons —
    //and it was the second one in the app, which is how a look stops being one
    //look. It is now `theme.ask`, whose host is mounted once by the shell.
    //
    //One thing that copy said and the shared one keeps: DISMISSING AND ANSWERING
    //"NO" ARE DIFFERENT ACTS. Closing this leaves the request standing so it can
    //be found on the card; the extra button clears it. A question that exists
    //only inside a dialog somebody closed is a question nobody answers.

    function Settings() {
        var { state, error, reads } = okc.use('settings', {}, 5000);
        //THE STANDING REQUEST COMES BACK WITH THE SETTINGS, and it used to be a
        //second read of `status`. That was right while the two lived in
        //different modules over in the app being ported from — they answered two
        //questions, what this app is set to and what is waiting on a person.
        //
        //./server.js OWNS BOTH NOW: the request IS a setting, kept in the same
        //document, so two reads would be two answers to one question with a
        //five-second window in which they disagree. Worse, the one that would be
        //wrong is `status` — it is still relayed, so it reports the OTHER app's
        //settings file, which this app can neither read nor write.

        var [dlgOpen, setDlgOpen] = useState(false);
        var [said, setSaid] = useState(null);

        var req = state ? state.askedToTest : null;
        var reqAt = req ? req.at : null;

        //THE ENTRY POINT THE OLD WINDOW CALLED FROM ITS DRAW LOOP, kept: the
        //question is for whoever is at the keyboard, not for whoever thinks to
        //open this tab.
        //
        //AND THE ONE THING THIS PORT CANNOT DO YET, said rather than hidden.
        //Over there the dialog was raised from draw.js, so it reached you
        //wherever you were standing. Here the shell mounts one tab at a time and
        //offers no always-mounted slot, so this fires while Settings is showing
        //and nowhere else. The card carries the request either way, which is why
        //that is a smaller loss than it would otherwise be — but it is a loss,
        //and it belongs in the shell rather than in a second copy of this
        //effect in every tab.
        useEffect(function () {
            if (!reqAt) return;
            if (askedShown === reqAt) return;
            //Not over the top of something else: a dialog that opens while
            //somebody is mid-decision in another one steals the keyboard and
            //answers the wrong question. This can wait five seconds for the
            //screen to be free.
            if (dlgOpen) return;
            askedShown = reqAt;
            setDlgOpen(true);
            ask(askToTest(req)).then(function () { setDlgOpen(false); });
        }, [reqAt, dlgOpen]);

        //Both writes report what they were told and leave the reading to the
        //next poll. The old window had to `forget` five cached panels here —
        //settings, tests-note, test-suites, test-list, test-detail — because the
        //Test tab kept its refusals and went on showing them. Nothing caches
        //here: every tab asks for itself on its own cadence, so a stale refusal
        //cannot outlive the setting by more than one read.
        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note || 'Saved.' }); },
                function (e) { setSaid({ bad: true, text: e.message }); }
            );
        }

        function setTests(on) {
            setSaid(null);
            return tell(okc.call('settingSet', { name: 'testsEnabled', value: on }));
        }

        function answer(allow) {
            setSaid(null);
            //Answering clears the request on the other side, so let it be asked
            //again if it comes back.
            askedShown = null;
            return tell(okc.call('testsAnswer', { allow: allow }));
        }

        //A DIALOG THAT NAMES THE FOLDER. The failure being guarded against is
        //somebody arming this while looking at the wrong one, so the path goes
        //in the question rather than only on the card behind it.
        function confirmOn(dir) {
            return {
                title: 'Let the drills run here?',
                plain: [
                    'They will run against ' + dir + '.',
                    'One writes a task on a branch cut and removes it again. One takes the worker credential off a machine, proves that a signed-out machine is refused work, and puts it back.',
                    'They never touch a machine the queue is driving, and the two long round-trip drills are not among them — those are drafts, run by a person who has decided to spend the time.'
                ],
                cost: 'If a guard has already stopped working, the thing it was guarding against happens here, in this folder. That is what a drill is: an attempt to do the wrong thing.',
                confirm: 'Turn them on here',
                danger: true,
                //THE MOST IMPORTANT GUARD IN THE APP. This switch is what opens
                //driving at all — a model able to press it could open its own
                //gate. The circle happens to close on its own today, since
                //nothing can be pressed from outside while the switch is off,
                //but "it works out" is not a rule and this is.
                onYes: function () { setTests(true); }
            };
        }

        function askToTest(r) {
            return {
                title: 'Run the drills against this workspace?',
                plain: [
                    'Asked ' + ago(r.at) + ' — for ' + r.forDir + '.',
                    'The reason given: ' + r.why,
                    'The drills drive this app for real. One writes a task on a branch cut and removes it again. One takes the worker credential off a machine, proves a signed-out machine is refused work, and puts it back. They never touch a machine the queue is driving.',
                    'Saying yes keeps them on for this folder only, across restarts, until the workspace changes.'
                ],
                cost: 'If a guard has already stopped working, the thing it was meant to stop happens here, in this folder. That is what a drill is: an attempt to do the wrong thing.',
                confirm: 'Allow, for this workspace',
                danger: true,
                //ASKED BY SOMETHING ELSE, ANSWERED BY A PERSON. That is the
                //whole shape of this request, and it stops being that the moment
                //the thing that asked can also answer.
                extra: { label: 'No', onClick: function () { answer(false); } },
                onYes: function () { answer(true); }
            };
        }

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) {
            //ONE PLACEHOLDER, BECAUSE ONE CARD ARRIVES. The old pane reserved
            //two and filled one, which is a layout jump on every open.
            return (
                <Pane>
                    <Panel>
                        <div className="skel-card">
                            <div className="skel skel-line" />
                            <div className="skel skel-line" />
                        </div>
                    </Panel>
                </Pane>
            );
        }

        var t = state.tests || {};
        var s = state.settings || {};
        //`settings.testsAsked` may name a workspace that has since been closed
        //or switched; the card filters it to the open folder itself.
        var asked = s.testsAsked || null;

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                <Panel>
                    <div className="card-title">
                        <span className="grow">Settings</span>
                        <span className="muted">— this app, not this workspace</span>
                    </div>
                    <Note>
                        {'Kept in ' + (state.where || 'a file beside the events record') + '. '}
                        These survive switching workspace, closing one, and having none open — anything that
                        belongs to a folder of repositories is kept with the folder instead.
                    </Note>

                    <div className="stack">
                        <TestCard t={t} asked={asked} said={said}
                            onOff={function () { setTests(false); }}
                            onAsk={function () { ask(confirmOn(t.openDir)); }} />
                    </div>
                </Panel>

                {/* THE OTHER FIVE, NAMED RATHER THAN DRAWN. core/settings.js says
                    of its own list that "the window shows this list; a key absent
                    from it is not a setting, it is a typo" — and this pane shows
                    one of six. Two are controlled in other tabs. `watchGitHub`
                    has no control anywhere in the UI and is reachable only down
                    the pipe, unguarded, which for "watch my repositories and act
                    on what turns up" is the one that should be said out loud in a
                    window. Reported here rather than given a card, so the gap is
                    visible without this tab quietly deciding it owns it. */}
                <Note>
                    {'Also kept here, and not shown as cards: supervisorWakes (' + (s.supervisorWakes ? 'on' : 'off') +
                        ', switched in Chat), supervisorKey (' + (s.supervisorKey || 'none') +
                        ', chosen in Guests), watchGitHub (' + (s.watchGitHub ? 'on' : 'off') +
                        ', which has no control in any tab and is set down the pipe).'}
                </Note>

                <Note>{'read ' + reads + ' time(s), every 5s'}</Note>

            </Pane>
        );
    }

    return Settings;
};
