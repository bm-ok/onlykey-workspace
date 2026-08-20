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

plugin.consumes = ['react', 'theme', 'appPackage', 'okc', 'app', 'remember'];
plugin.provides = ['shell'];
async function plugin(imports, register) {
    var { react, theme, appPackage, okc, app, remember } = imports;
    var { Topbar, Dialogs } = theme;

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

    //`chrome: true` KEEPS A TAB OUT OF THE ROW WITHOUT MAKING IT UNREACHABLE.
    //The Inbox is not one of the tabs over there — it is behind the brand, at
    //the far left, badged with what is waiting. It is somewhere you are SENT
    //rather than somewhere you browse to, and putting it in the row beside
    //Repositories would say the opposite.
    function inRow(t) { return !t.chrome; }

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
                <div className="pane active">
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
        var [up, setUp] = useState(okc.connected);
        var [, bumpBadge] = useState(0);

        useEffect(function () { return okc.onUp(setUp); }, []);
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
            goTo.at = function (tab, pane) { asked({ tab: tab, pane: pane || null }, null); };
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
        //version is on the About tab for anybody who wants it.
        //
        //(A `{/* */}` comment cannot sit between attributes — that is for
        //children. Between attributes it is a `//` line, as here. Learned twice.)
        var showing = banners.slice().sort(function (a, b) { return at(a) - at(b); });

        return (<>
            <Topbar
                brand="Dashboard"
                live={up}
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
            go: function (tab, pane) { if (goTo.at) goTo.at(tab, pane); }
        }
    });
}
module.exports = plugin;
