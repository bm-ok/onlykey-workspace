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
        var setPane = function (name) {
            setPanes(function (was) {
                var next = Object.assign({}, was);
                if (name == null) delete next[on]; else next[on] = name;
                return next;
            });
        };
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
                if (pane) setPane(pane);
                if (reply) reply({ ok: true, tab: inTab, pane: pane || null });
            }

            okc.io.on('shell:show', asked);
            return function () { okc.io.off('shell:show', asked); };
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
                {Body ? <Body /> : <p className="empty">no tabs are loaded</p>}
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

            //Pushed by whoever knows. `null` or 0 takes a badge off; a falsy
            //`why` lets a tab be used again.
            badge: setBadge,
            label: setLabel,
            stop: setStopped
        }
    });
}
module.exports = plugin;
