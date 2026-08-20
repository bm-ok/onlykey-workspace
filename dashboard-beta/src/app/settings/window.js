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
        var { state, error, reads } = useAsk(okc, 'settings', {}, 5000);
        //THE STANDING REQUEST COMES FROM `status` AS WELL, already filtered to
        //the open folder on the other side. Two reads rather than one because
        //they answer two questions: what this app is set to, and whether
        //something is waiting on a person right now.
        var live = useAsk(okc, 'status', {}, 5000);

        var [dlgOpen, setDlgOpen] = useState(false);
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
                protect: true,
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
                protect: true,
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

    //A PANE RATHER THAN THE TAB ITSELF, so the tab can hold more than one thing.
    //The shell shows a tab's panes when it has any and its own Component when it
    //has none — so a tab that is both is a tab whose body silently disappears the
    //day somebody adds a second pane to it. Registered this way it cannot.
    shell.tab({ name: 'Settings', order: 90 });
    shell.pane({ tab: 'Settings', name: 'General', order: 10, Component: Settings });

    await register(null, {});
}
module.exports = plugin;
