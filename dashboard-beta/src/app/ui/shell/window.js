var React = require('react');
var { useState, useEffect } = React;

//the shell: the topbar, the tabs, and which one is showing.
//
//A TAB IS A FOLDER. This provides `shell`, a tab plugin consumes it and calls
//`shell.tab({...})`, and that is the whole registration. There is no list of
//tabs anywhere — the same property the scaffold has for plugins, carried down a
//level: adding a tab is creating a folder, and there is no place to add one
//that forgets it.
//
//WHY THAT IS THE POINT OF THIS PORT. The old window is one 15,000-line ui/
//directory where every pane is a file, every file is reached from a switch in
//draw.js, and the paint functions all share one node context with the actions
//they call — which is why a synchronous action freezes the window. Here a tab
//is a plugin with a declared boundary: it consumes `okc` to ask the dashboard
//something and it cannot reach anything it did not declare.
//
//RENDERED AFTER EVERY PLUGIN HAS REGISTERED, not while they are still loading.
//rectify emits `start` on the app service once the graph is up, and the tabs
//register during that graph — so rendering earlier would draw whichever ones
//happened to be resolved first, and the order would be the plugin resolution
//order rather than anything a person chose.

//---- WHAT THE DOT IN THE CORNER IS ABOUT -----------------------------------
//
//IT USED TO BE ABOUT THE PORT. Purple meant this app was still attached to the
//dashboard it was ported FROM, which answered whatever had not moved across
//yet; green meant it was answering everything by itself, which was what DONE
//looked like. That relay is gone, and with it the only thing purple said.
//
//IT NOW ANSWERS THE ONLY QUESTION A DOT IS ANY GOOD FOR: is there anything I
//have to do. Being looked at is the whole job of a dot, and one that reports an
//internal fact about the app gets looked at once.
//
//  green   working, and nothing is waiting on you
//  purple  something is waiting on you, and how many
//  red     this window cannot reach its own server. The only one of the three
//          that means something is wrong HERE
//
//RED STILL WINS, for the reason it always did: with this wire down we cannot
//know what is waiting either, and "we do not know" has to read as the loudest
//of the three rather than the quietest.
//
//---- AND PURPLE ON A DOT IS NOT PURPLE ON A BUTTON -------------------------
//
//THE THEME SAYS PURPLE IS NEVER A STATUS — see ../theme/dashboard.scss — and
//on a control that stays exactly true. A purple button is a press a model may
//not make, and the colour is only legible there because it is spent on nothing
//else. In the corner it IS a status, which is the one place that rule bends.
//
//THEY ARE ONE SENTENCE FROM TWO SIDES, which is what lets a single colour
//carry both. On a control purple means THIS IS THE PERSON'S. In the corner it
//means THE PERSON HAS SOMETHING WAITING. Both say the person is the one who
//acts — neither is about how the app is doing, which is what every other
//colour in this theme answers. A colour that sometimes meant "look at this"
//and sometimes "how is it going" would be read as neither, and that is the
//line this stays on the right side of.
//
//DRIVEN OFF THE INBOX'S OWN COUNT — the number the shell is already handed for
//the tab badge, by ../../inbox on the one poller it already runs. So the dot
//and the Inbox tab cannot disagree, and nothing new is fetched to light it.
var DOT_QUIET = 'working normally, and nothing is waiting on you';

function dotWaiting(n) {
    return n + ' thing(s) waiting on you — see the Inbox tab. Nothing is stuck: this is '
        + 'work only a person can do';
}

var DOT_DEAD = 'this window cannot reach its own server. Nothing on screen is being kept up to '
    + 'date — it is the last thing that arrived, however old that is';

plugin.consumes = ['react', 'theme', 'appPackage', 'okc', 'app', 'remember'];
plugin.provides = ['shell'];
async function plugin(imports, register) {
    var { react, theme, appPackage, okc, app, remember } = imports;
    var { Topbar, Dialogs, Notice, Linky } = theme;

    var tabs = [];
    var panes = [];

    //WHAT SITS ABOVE EVERYTHING, ON EVERY TAB. A banner is not a pane: it is not
    //somewhere you go, it is something that is true wherever you are. So it is
    //registered like a tab and rendered outside the one-tab-at-a-time rule --
    //mounted for as long as the window is, because a warning that is only on
    //screen while you happen to be looking at the right tab is not a warning.
    var banners = [];

    //A TAB WITH PANES IN IT, and the panes are folders too.
    //
    //The Repositories tab in the app being ported is six panes over one subject
    //— what is on GitHub, what is cut, what is proposed, what conflicts. They
    //are one tab because they answer one question between them, and separate
    //panes because each is a screenful.
    //
    //REGISTERED THE SAME WAY A TAB IS, and by whoever owns them rather than by
    //the tab. A pane names the tab it belongs in; the tab does not list its
    //panes. So a pane is a folder that can be added, removed or ported on its
    //own, and the tab it lands in needs no edit — the same property one level
    //down, and the reason the five biggest files left can be ported
    //independently of each other.
    //---- badges, and a tab that is not in the row --------------------------
    //
    //A BADGE IS READ FROM SOMEWHERE ELSE, which is the whole point of it. Every
    //pane in this app is mounted only while it is showing, so a tab that is not
    //open asks nothing — exactly right for a panel and exactly wrong for a
    //count whose job is to be seen from another tab. So the count is pushed
    //here by whoever knows it, and the shell holds it.
    //Three things a tab can be told from outside, one watcher between them:
    //a count, a label, and whether it may be used at all.
    var badges = {};
    var labels = {};
    var stopped = {};
    var badgeWatchers = new Set();
    function poke() { badgeWatchers.forEach(function (f) { f(); }); }
    function setBadge(name, value) {
        if (badges[name] === value) return;
        badges[name] = value; poke();
    }
    function setLabel(name, value) {
        if (labels[name] === value) return;
        labels[name] = value; poke();
    }
    //WHICH TABS STOP WORKING IS THE CLEAREST STATEMENT OF WHAT A WORKSPACE IS.
    //Dimmed and unclickable rather than removed: a row that silently loses half
    //its buttons reads as a broken window rather than as a state. `why` becomes
    //the title, so the answer is on the thing that refused.
    function setStopped(name, why) {
        if (stopped[name] === why) return;
        stopped[name] = why; poke();
    }

    //HIDDEN IS DIFFERENT FROM STOPPED. A stopped tab is one this workspace
    //cannot use and should still see; a hidden one is one that does not
    //exist while a switch is off. The Test tab is the case: with testing
    //mode off there is nothing in it that may run, and a tab of refusals is
    //an invitation to find the switch. Off means gone.
    var hidden = {};
    function setHidden(name, on) {
        if (!!hidden[name] === !!on) return;
        hidden[name] = !!on; poke();
    }

    //HIDDEN IS DIFFERENT FROM STOPPED. A stopped tab is one this workspace
    //cannot use and should still see; a hidden one is one that does not
    //exist while a switch is off. The Test tab is the case: with testing
    //mode off there is nothing in it that may run, and a tab of refusals is
    //an invitation to find the switch. Off means gone.
    var hidden = {};
    function setHidden(name, on) {
        if (!!hidden[name] === !!on) return;
        hidden[name] = !!on; poke();
    }

    //HIDDEN IS DIFFERENT FROM STOPPED. A stopped tab is one this workspace
    //cannot use and should still see; a hidden one is one that does not
    //exist while a switch is off. The Test tab is the case: with testing
    //mode off there is nothing in it that may run, and a tab of refusals is
    //an invitation to find the switch. Off means gone.
    var hidden = {};
    function setHidden(name, on) {
        if (!!hidden[name] === !!on) return;
        hidden[name] = !!on; poke();
    }

    //`chrome: true` KEEPS A TAB OUT OF THE ROW WITHOUT MAKING IT UNREACHABLE.
    //The Inbox is not one of the tabs over there — it is behind the brand, at
    //the far left, badged with what is waiting. It is somewhere you are SENT
    //rather than somewhere you browse to, and putting it in the row beside
    //Repositories would say the opposite.
    function inRow(t) { return !t.chrome && !hidden[t.name]; }

    //`order: 0` IS FALSY AND `|| 50` ATE IT. The Inbox asked for 0 to be first
    //and was given 50, so the workspace tab — asking for 1 — came out ahead of
    //it, and the brand read "workspace Dashboard" instead of "Dashboard
    //workspace". A default written with `||` cannot tell "not given" from
    //"given, and zero".
    function at(t) { return t.order == null ? 50 : t.order; }

    function panesIn(tab) {
        return panes.filter(function (p) { return p.tab == tab; })
            .sort(function (a, b) { return at(a) - at(b) || a.name.localeCompare(b.name); });
    }

    //GOING SOMEWHERE FROM A PANE, which is a different thing from a person
    //pressing a tab.
    //
    //A pane sometimes hands off: an issue becomes a task, and the form that
    //writes one lives under another tab. The alternative is a second copy of
    //that form inside a dialog, which is how one question ends up with two
    //answers that drift.
    //
    //A HOLDER RATHER THAN CONTEXT, because `shell` is handed out at register
    //time and the setters only exist once the component is mounted. Same shape
    //as the guard hook in the theme, and for the same reason.
    var goTo = { at: null };

    //WHERE THE WINDOW IS, AND A WAY TO SAY SOMETHING IN IT — held the same way
    //`goTo` is, because they are the same kind of thing: the shell knows, and
    //everything else has to ask rather than work it out.
    //
    //`where` EXISTS SO NOBODY READS THE DOM FOR IT. A plugin wanting to know
    //which pane is showing would otherwise query `.tab.active` — naming a class,
    //which is the one thing a pane may never do here, and reading a fact the
    //shell is holding three lines away. The first plugin that needed it did
    //exactly that before this existed.
    //
    //`say` IS THE SLOT THE OLD WINDOW HAS AND THIS ONE DID NOT. Over there one
    //notice bar sits under the tab row and everything says its results into it.
    //Here each pane grew its own `said` state — Keys, Todo and the rest all keep
    //one — which is fine for a pane reporting on its own button, and no use at
    //all to anything that is not a pane. A key press is not a pane.
    var here = { at: null };
    var saying = { at: null };

    //---- one broken thing is not a blank window ---------------------------
    //
    //REACT TAKES THE WHOLE TREE DOWN FOR ONE BAD VALUE. Render an object where a
    //string belongs -- a task's `subject`, a sign-in's `account` -- and every tab
    //goes, the topbar with it, and what is left says nothing at all. That has
    //happened twice here, and both times the app looked dead rather than wrong.
    //
    //SAYING IT IS THE OLD WINDOW'S RULE, not an invention. `paintTasks` used to
    //swallow its errors and draw nothing, "which looks exactly like having
    //nothing to show -- and that is the question somebody is asking when they
    //look at an empty tab". A boundary that renders the error keeps that true
    //while stopping one pane from taking the other fourteen with it.
    //
    //A CLASS, BECAUSE REACT HAS NO HOOK FOR THIS. componentDidCatch and
    //getDerivedStateFromError are the whole API and neither exists on a function
    //component. This is the only class in the app and that is why.
    class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { err: null }; }
        static getDerivedStateFromError(err) { return { err: err }; }
        componentDidCatch(err) { console.error('[shell] ' + (this.props.what || 'something') + ' threw', err); }
        //RESET WHEN WHAT IS BEING SHOWN CHANGES, so a pane that broke is not
        //broken for ever: switching away and back mounts it again. `what` is the
        //tab and pane name, which is exactly the thing that should clear it.
        componentDidUpdate(prev) {
            if (prev.what !== this.props.what && this.state.err) this.setState({ err: null });
        }
        render() {
            if (!this.state.err) return this.props.children;
            return (
                //MARKED SO SOMETHING OUTSIDE CAN SEE IT, and this is not
                //decoration. The boundary renders TEXT, so `windowControls`
                //counted it as content and `npm run walk` reported a pane that
                //had crashed as "came up, has something on screen" — which is
                //the exact failure the walk exists to catch, passing the walk.
                //
                //Found by a person opening the pane and it going blank, after
                //the walk had said 44 of 44 were fine. An attribute is read
                //rather than the sentence, because a sentence gets reworded.
                <div className="pane active" data-broke={String((this.state.err && this.state.err.message) || this.state.err)}>
                    <p className="note bad">
                        <strong>{(this.props.what || 'This') + ' could not be drawn. '}</strong>
                        {String(this.state.err && this.state.err.message || this.state.err)}
                    </p>
                    <p className="note">
                        The rest of the window is unaffected. This is the pane failing, not the
                        app — the whole message is in the developer console.
                    </p>
                </div>
            );
        }
    }

    function App() {
        //WHERE YOU WERE, KEPT. This window is restarted on every change to the
        //server half, and it used to come back on the first tab every time —
        //so the cost of a restart was finding your place, paid by whoever is
        //working on this tool. See ../remember, which also carries the rule
        //about what may and may not be kept there.
        var [on, setOn] = remember.use('shell', 'tab', tabs.length ? tabs[0].name : null);

        //ONE REMEMBERED PANE PER TAB, not one for the app. Coming back to
        //Repositories should land where you left Repositories, and that is a
        //different answer from where you left Settings.
        var [panes, setPanes] = remember.use('shell', 'panes', {});
        var pane = panes[on] || null;

        //THE TAB IT BELONGS TO IS AN ARGUMENT, NOT THE ONE WE HAPPEN TO BE ON.
        //
        //This read `next[on] = name`, closing over the tab showing at the time.
        //For a person pressing a sub-tab that is right — they are already there.
        //For `show --tab X --pane Y` from anywhere else it is wrong in the
        //quietest possible way: Y is filed under the tab being LEFT, X keeps
        //whatever pane it was last on, and the answer comes back {ok:true} with
        //the tab and pane that were asked for.
        //
        //THAT IS WHERE "IT NEEDS TWO CALLS TO SETTLE" CAME FROM. The second call
        //works because by then `on` really is X. It was worked around for a
        //whole session — called twice everywhere, and written into CLAUDE.md as
        //if it were a property of the window — rather than being read as the
        //symptom of a bug. A workaround that works is how a defect gets
        //promoted to a documented behaviour.
        var setPaneOf = function (tab, name) {
            setPanes(function (was) {
                var next = Object.assign({}, was);
                if (name == null) delete next[tab]; else next[tab] = name;
                return next;
            });
        };
        var setPane = function (name) { setPaneOf(on, name); };
        //WHAT THE SHELL LENDS OUT, kept current rather than captured once. Both
        //are set on every render for the same reason `goTo` is set in an effect:
        //a closure taken at mount would answer with the tab that was showing
        //when the window opened, which is the failure `setPaneOf` was written to
        //fix one screen away from here.
        var [said, setSaid] = useState(null);

        var [wire, setWire] = useState(okc.wire);
        var [, bumpBadge] = useState(0);

        //WHAT THE DOT IS LIT BY, and it is the Inbox tab's own badge rather than
        //a second question asked of the same action. ../../inbox pushes that
        //number here on the poller it already runs; reading it back means the
        //corner and the tab cannot say different things, which is the failure
        //this app cares about more than either being briefly stale.
        var waiting = Number(badges['Inbox']) || 0;

        useEffect(function () { return okc.onWire(setWire); }, []);

        here.at = function () { return { tab: on, pane: pane }; };

        //ONE AT A TIME, AND THE NEWEST WINS. Two results on screen at once is a
        //stack somebody has to read backwards; the second thing that happened is
        //the thing being reported on.
        saying.at = function (text, opts) {
            setSaid({ at: Date.now(), text: String(text), kind: opts.kind || 'ok', does: opts.does || null,
                lasts: opts.lasts == null ? 8000 : opts.lasts });
        };

        //IT GOES AWAY BY ITSELF, and the timer restarts when a new one arrives
        //rather than the old one taking the new one with it. `said.at` is in the
        //dependency list for exactly that: two captures eight seconds apart
        //would otherwise leave the second showing for whatever was left of the
        //first one's time.
        useEffect(function () {
            if (!said || !said.lasts) return;
            var t = setTimeout(function () { setSaid(null); }, said.lasts);
            return function () { clearTimeout(t); };
        }, [said && said.at, said && said.lasts]);
        useEffect(function () {
            var f = function () { bumpBadge(function (n) { return n + 1; }); };
            badgeWatchers.add(f);
            return function () { badgeWatchers.delete(f); };
        }, []);

        //DRIVEN FROM OUTSIDE, so a photograph can be of a named pane rather than
        //whichever one happened to be showing. See ./server.js — this is the
        //window end of the `show` action, and it is navigation only.
        useEffect(function () {
            function asked(want, reply) {
                var to = want && want.tab;
                var pane = want && want.pane;

                if (to && !tabs.some(function (t) { return t.name == to; })) {
                    return reply && reply({ ok: false, error: 'there is no tab called "' + to + '" — there is ' + tabs.map(function (t) { return t.name; }).join(', ') });
                }
                var inTab = to || on;
                if (pane && !panesIn(inTab).some(function (p) { return p.name == pane; })) {
                    return reply && reply({ ok: false, error: 'there is no pane called "' + pane + '" in ' + inTab + ' — there is ' + (panesIn(inTab).map(function (p) { return p.name; }).join(', ') || 'none') });
                }

                if (to) setOn(to);
                //A TAB WITHOUT A NAMED PANE LEAVES THE PANE ALONE, which changed
                //when panes started being remembered. It used to reset to the
                //first one so that asking for a tab twice gave the same answer —
                //but that answer is now somebody's bookmark, and a read-only
                //tool that moves where a person was standing is not read-only in
                //the way that matters. Name the pane when the answer has to be
                //the same every time; `npm run walk` does.
                if (pane) setPaneOf(inTab, pane);
                if (reply) reply({ ok: true, tab: inTab, pane: pane || null });
            }

            okc.io.on('shell:show', asked);
            //THE SAME DOOR THE SOCKET USES. A pane that navigated by calling
            //setOn directly would skip the checks `asked` makes — that the tab
            //exists, that the pane is in it — and a typo would leave the shell
            //on a tab with no panes rather than saying so.
            //---- AND IT IS TOLD WHEN THERE IS NO SUCH PLACE -----------------
            //
            //THIS PASSED `null` FOR THE REPLY, and every refusal `asked` makes
            //is `reply && reply(...)`. So a pane sending somebody to a tab that
            //does not exist did NOTHING AT ALL — no move, no message, no line in
            //the console. A button that looks like a button and answers a press
            //with silence.
            //
            //IT WAS NOT HYPOTHETICAL. ../../inbox translated its rows through a
            //table naming the app being ported from, and one entry pointed at
            //"Actions" — a tab this app has never had, since that library is
            //split across Worker and Judge here. Every one of those rows drew a
            //"Go to Actions" button that did nothing when pressed.
            //
            //SAID THROUGH `saying`, which is the shell's own sentence and goes
            //away by itself — and logged, because a person pressing the button
            //and a person reading the console are looking for the same fault.
            //`asked` already writes the message and lists what there IS, so
            //nothing here decides anything; it only stops throwing the answer
            //away.
            goTo.at = function (tab, pane) {
                asked({ tab: tab, pane: pane || null }, function (said) {
                    if (!said || said.ok !== false) return;
                    console.error('shell.go: ' + said.error);
                    if (saying.at) saying.at(said.error, { bad: true });
                });
            };
            return function () { okc.io.off('shell:show', asked); goTo.at = null; };
        }, [on]);

        //STANDING ON A TAB THAT JUST SWITCHED OFF. Moved rather than left
        //showing the last workspace's branches under a heading that no longer
        //means anything.
        useEffect(function () {
            if (!stopped[on]) return;
            var home = tabs.filter(function (t) { return t.chrome && t.home; })[0];
            if (home) setOn(home.name);
        }, [on, stopped[on]]);

        //A TAB HIDDEN WHILE IT IS ON SCREEN goes the same way a stopped one
        //does: home, rather than a blank where a tab was.
        useEffect(function () {
            if (!hidden[on]) return;
            var home = tabs.filter(function (t) { return t.chrome && t.home; })[0];
            setOn(home ? home.name : (tabs.filter(inRow)[0] || {}).name || null);
        }, [on, hidden[on]]);

        //A TAB HIDDEN WHILE IT IS ON SCREEN goes the same way a stopped one
        //does: home, rather than a blank where a tab was.
        useEffect(function () {
            if (!hidden[on]) return;
            var home = tabs.filter(function (t) { return t.chrome && t.home; })[0];
            setOn(home ? home.name : (tabs.filter(inRow)[0] || {}).name || null);
        }, [on, hidden[on]]);

        //A TAB HIDDEN WHILE IT IS ON SCREEN goes the same way a stopped one
        //does: home, rather than a blank where a tab was.
        useEffect(function () {
            if (!hidden[on]) return;
            var home = tabs.filter(function (t) { return t.chrome && t.home; })[0];
            setOn(home ? home.name : (tabs.filter(inRow)[0] || {}).name || null);
        }, [on, hidden[on]]);

        var showing = tabs.find(function (t) { return t.name == on; });
        var mine = panesIn(on);

        //THE FIRST PANE IS THE ONE THAT SHOWS, until somebody picks another —
        //and the choice is remembered per tab rather than reset on every visit,
        //because coming back to where you were is what a person expects and
        //being sent back to the first pane every time is what makes a tab bar
        //annoying.
        var picked = mine.find(function (p) { return p.name == pane; }) || mine[0];
        var Body = mine.length ? (picked && picked.Component) : (showing && showing.Component);

        //THE VERSION USED TO SIT BESIDE THE TITLE and it is the wrong thing for
        //that corner. `beta 0.1.0` never changes and nobody needs to read it
        //twice — the same argument the old window makes about the path to
        //VBoxManage, which is what its title bar used to carry. What belongs
        //there is what all of this is ABOUT: the folder of repositories. The
        //version is not drawn anywhere at all, which is the honest state of
        //it: this said it was on the About tab, and there is no About tab
        //and nothing shows a version. Somewhere in Settings is where it
        //would go if anybody wants it.
        //
        //(A `{/* */}` comment cannot sit between attributes — that is for
        //children. Between attributes it is a `//` line, as here. Learned twice.)
        var showing = banners.slice().sort(function (a, b) { return at(a) - at(b); });

        return (<>
            <Topbar
                brand="Dashboard"
                // THE WIRE FIRST, because it is the only one of the three that
                // means the screen is lying. With it down we cannot know what is
                // waiting either, so there is no state where both are reported.
                dot={!wire
                    ? { tone: 'fail', title: DOT_DEAD }
                    : (waiting > 0
                        ? { tone: 'waiting', title: dotWaiting(waiting) }
                        : { tone: 'ok', title: DOT_QUIET })}
                tabs={tabs.filter(inRow).map(function (t) {
                    return { name: t.name, badge: badges[t.name], stopped: stopped[t.name] };
                })}
                on={on}
                onPick={setOn}
                brandTabs={tabs.filter(function (t) { return t.chrome; }).map(function (t) {
                    return {
                        name: t.name,
                        label: labels[t.name] === undefined ? (t.label || t.name) : labels[t.name],
                        badge: badges[t.name],
                        strong: !!t.strong,
                        none: !!t.none && !labels[t.name]
                    };
                })}
                onBrand={setOn}
            />

            {/* ABOVE THE SUB-TABS AND BELOW THE ROW, which is where the old
                window puts them: they are about the whole app rather than about
                the tab, and a person reads down from the top. */}
            {/* A BANNER IS MOUNTED ON EVERY TAB, so one that throws is worse
                than a pane that throws: it would blank the window wherever you
                stood. Each gets its own boundary for that reason. */}
            {showing.map(function (b, i) {
                var B = b.Component;
                return <Boundary key={b.name || i} what={'the ' + (b.name || 'banner') + ' banner'}><B /></Boundary>;
            })}

            {/* WHAT SOMETHING JUST DID, BELOW THE BANNERS. A banner is a
                state that is still true; this is an event that has finished, so
                the thing that still needs doing stays nearest the top.
                
                It was written above them first, and the comment saying "below
                them on purpose" sat directly over the code putting it above.
                Only the photograph showed it. */}
            {said ? (
                <Boundary what="the notice">
                    <Notice kind={said.kind} onClose={function () { setSaid(null); }}>
                        {said.text}
                        {said.does ? said.does.map(function (d, i) {
                            return <Linky key={i} onClick={function () { d.onClick(); }}>{d.label}</Linky>;
                        }) : null}
                    </Notice>
                </Boundary>
            ) : null}

            {mine.length > 1 ? (
                <div className="subtabs">
                    {mine.map(function (p) {
                        return (
                            <button key={p.name}
                                className={'subtab' + (picked && p.name == picked.name ? ' active' : '')}
                                onClick={function () { setPane(p.name); }}>
                                {p.name}
                            </button>
                        );
                    })}
                </div>
            ) : null}
            {/* EVERY TAB IS MOUNTED ONLY WHILE IT IS SHOWING, which is the
                other half of a rule the old window had to learn: a panel behind
                a tab nobody is looking at must ask nothing. Over there that is
                a guard at the top of every paint function, applied by hand and
                forgotten three times — twice putting `spawn` at a quarter of
                the window's samples. Here an unmounted tab has no effects
                running, so the rule enforces itself. */}
            {/* <main> IS NOT DECORATION EITHER. The stylesheet says
                `main { padding: 16px }` and that is the only thing holding a
                pane off the edges of the window — another piece of the old
                skeleton that lived in index.html and so was invisible to a port
                that read the JavaScript. Without it the first column sits flush
                against the left edge, which is exactly how it looked. */}
            <main>
                <Boundary what={on + (picked ? '/' + picked.name : '')}>
                    {Body ? <Body /> : <p className="empty">no tabs are loaded</p>}
                </Boundary>
            </main>

            {/* MOUNTED ONCE, HERE, AND NOWHERE ELSE. A dialog is opened from
                deep inside a pane by calling `theme.ask(...)` and awaiting the
                answer — so the overlay has to live above whatever pane is
                showing, and has to survive that pane going away. Hanging it off
                the shell is what lets `ask` stay a function call rather than
                open/close state threaded down through forty components. */}
            <Dialogs />
        </>);
    }

    //the tabs register during the graph; this renders once it is up
    app.on('start', function () {
        tabs.sort(function (a, b) { return at(a) - at(b) || a.name.localeCompare(b.name); });
        react.root.render(<App />);
    });

    await register(null, {
        shell: {
            //`order` rather than an index, so two tabs can be added without
            //either knowing about the other. Ties fall back to the name.
            tab: function (t) { tabs.push(t); },
            pane: function (p) { panes.push(p); },
            //TAKE A TAB OUT OF THE ROW WHILE SOMETHING IS OFF, and put it back
            //when it is on. Whoever knows the switch calls this.
            hide: setHidden,
            //TAKE A TAB OUT OF THE ROW WHILE SOMETHING IS OFF, and put it back
            //when it is on. Whoever knows the switch calls this.
            hide: setHidden,
            //TAKE A TAB OUT OF THE ROW WHILE SOMETHING IS OFF, and put it back
            //when it is on. Whoever knows the switch calls this.
            hide: setHidden,

            //ORDER, BECAUSE THE STACKING IS AN ARGUMENT. Over there the running
            //banner sits above testing mode deliberately: that one says this
            //folder MAY be written to, this one says something is writing to it
            //NOW. Lowest order first, same as tabs.
            banner: function (b) { banners.push(b); },

            //Pushed by whoever knows. `null` or 0 takes a badge off; a falsy
            //`why` lets a tab be used again.
            badge: setBadge,
            label: setLabel,
            stop: setStopped,

            //WHERE A PANE HANDS OFF TO ANOTHER PANE. Refuses quietly before the
            //shell is mounted: there is nowhere to go yet, and throwing at that
            //moment would take the whole graph down with it.
            go: function (tab, pane) { if (goTo.at) goTo.at(tab, pane); },

            //WHAT IS ON SCREEN, in the same words the tab row uses — which are
            //the words `show` takes and the words a photograph should be named
            //after, so all three agree by being one string.
            where: function () { return here.at ? here.at() : { tab: null, pane: null }; },

            //A SENTENCE, AND OPTIONALLY A BUTTON. It goes away by itself: a
            //result that stays is a result somebody has to dismiss, and a window
            //that accumulates things to dismiss is one people stop reading.
            say: function (text, opts) { if (saying.at) saying.at(text, opts || {}); }
        }
    });
}
module.exports = plugin;
