var React = require('react');
var { useState, useEffect } = React;
var useAsk = require('../okc/ask');

//the Settings tab: one question, asked about one place.
//
//"MAY THE DRILLS RUN AGAINST THE FOLDER I HAVE OPEN RIGHT NOW?" Three kinds of
//person open this tab: one the Test tab has just refused and who wants the
//sentence saying why; one about to hand this app a workspace they care about,
//checking nothing is armed against it; and one who dismissed the dialog that
//asked them and has come looking for the question again. All three want the
//same card, so there is one.
//
//ON IS NOT A STATE THIS SETTING HAS. It is on FOR somewhere. `enabled` alone
//answers nothing — the predicate is enabled AND the folder it was turned on for
//being the folder open now, compared as raw strings. "On for a folder that is
//not the one open" is the exact state this card exists to make visible, and
//collapsing it to on or to off deletes the pane's reason to exist.
//
//WHY THE TWO BUTTONS HERE ARE EXPECTED TO BE REFUSED, and that is not a bug in
//this file. `settingSet testsEnabled` and `testsAnswer` are guarded against
//`_overTheWire`, `_driven` and `_fromTest` — a model may ASK for the drills and
//may not decide that somebody's repository is a fine place to run them. This
//window is a second process talking to the running dashboard down its socket,
//so the guard counts it as the pipe and says so. The buttons stay, because they
//are what the pane is for and because the refusal is the honest answer to press
//them from here today; the sentence it returns is shown where the press was
//made rather than swallowed. When this window IS the window, the same press
//goes through unchanged.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

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

    //The confirmation, in page rather than native: it has to carry plain words
    //about what the drills actually do and what it costs when one of them finds
    //something. A confirm() holds none of that.
    function Dialog({ d, onClose }) {
        if (!d) return null;
        return (
            <div className="dlg-overlay"
                onClick={function (e) { if (e.target === e.currentTarget) onClose(); }}>
                <div className="dlg">
                    <div className="dlg-title">{d.title}</div>
                    <div className="dlg-body">
                        {(d.plain || []).map(function (p, i) {
                            return <p key={i} className="note">{p}</p>;
                        })}
                        {d.cost ? <div className="dlg-cost"><strong>What it costs: </strong>{d.cost}</div> : null}
                    </div>
                    <div className="dlg-actions">
                        {/* DISMISSING AND ANSWERING "NO" ARE DIFFERENT ACTS, and
                            both have to exist. Closing this leaves the request
                            standing so it can be found on the card; "No" clears
                            it. A question that exists only inside a dialog
                            somebody closed is a question nobody answers. */}
                        {d.extra
                            ? <button className="btn" onClick={function () { onClose(); d.extra.onClick(); }}>{d.extra.label}</button>
                            : null}
                        <button className="btn" onClick={onClose}>Never mind</button>
                        <button className={'btn' + (d.danger ? ' danger' : '')}
                            onClick={function () { onClose(); d.onYes(); }}>{d.confirm}</button>
                    </div>
                </div>
            </div>
        );
    }

    //THE DRILLS, AND THE ONE THING THAT MAKES THEM DANGEROUS. They drive this
    //app for real: one writes a task and removes it again, one takes a
    //credential off a machine and puts it back. Against three scaffolding
    //repositories that is what they are for; against somebody's actual work it
    //is a stranger typing into their repository, and nothing here can tell the
    //two apart. So the card leads with the folder.
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

    function Settings() {
        var { state, error, reads } = useAsk(okc, 'settings', {}, 5000);
        //THE STANDING REQUEST COMES FROM `status` AS WELL, already filtered to
        //the open folder on the other side. Two reads rather than one because
        //they answer two questions: what this app is set to, and whether
        //something is waiting on a person right now.
        var live = useAsk(okc, 'status', {}, 5000);

        var [dlg, setDlg] = useState(null);
        var [said, setSaid] = useState(null);

        var req = live.state ? live.state.askedToTest : null;
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
            if (dlg) return;
            askedShown = reqAt;
            setDlg(askToTest(req));
        }, [reqAt, !!dlg]);

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
                            onAsk={function () { setDlg(confirmOn(t.openDir)); }} />
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

                <Dialog d={dlg} onClose={function () { setDlg(null); }} />
            </Pane>
        );
    }

    shell.tab({ name: 'Settings', order: 90, Component: Settings });

    await register(null, {});
}
module.exports = plugin;
