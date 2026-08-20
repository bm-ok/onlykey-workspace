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

plugin.consumes = ['react', 'theme', 'appPackage', 'okc', 'app'];
plugin.provides = ['shell'];
async function plugin(imports, register) {
    var { react, theme, appPackage, okc, app } = imports;
    var { Topbar } = theme;

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
    function panesIn(tab) {
        return panes.filter(function (p) { return p.tab == tab; })
            .sort(function (a, b) { return (a.order || 50) - (b.order || 50) || a.name.localeCompare(b.name); });
    }

    function App() {
        var [on, setOn] = useState(tabs.length ? tabs[0].name : null);
        var [pane, setPane] = useState(null);
        var [up, setUp] = useState(okc.connected);

        useEffect(function () { return okc.onUp(setUp); }, []);

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
                //A TAB WITHOUT A NAMED PANE GOES BACK TO ITS FIRST, so asking for
                //a tab twice does not depend on what was showing last time.
                setPane(pane || null);
                if (reply) reply({ ok: true, tab: inTab, pane: pane || null });
            }

            okc.io.on('shell:show', asked);
            return function () { okc.io.off('shell:show', asked); };
        }, [on]);

        var showing = tabs.find(function (t) { return t.name == on; });
        var mine = panesIn(on);

        //THE FIRST PANE IS THE ONE THAT SHOWS, until somebody picks another —
        //and the choice is remembered per tab rather than reset on every visit,
        //because coming back to where you were is what a person expects and
        //being sent back to the first pane every time is what makes a tab bar
        //annoying.
        var picked = mine.find(function (p) { return p.name == pane; }) || mine[0];
        var Body = mine.length ? (picked && picked.Component) : (showing && showing.Component);

        return (<>
            <Topbar
                brand="Dashboard"
                sub={'beta ' + appPackage.version}
                live={up}
                tabs={tabs.map(function (t) { return { name: t.name, badge: t.badge }; })}
                on={on}
                onPick={function (name) { setOn(name); setPane(null); }}
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
            {Body ? <Body /> : <p className="empty">no tabs are loaded</p>}
        </>);
    }

    //the tabs register during the graph; this renders once it is up
    app.on('start', function () {
        tabs.sort(function (a, b) { return (a.order || 50) - (b.order || 50) || a.name.localeCompare(b.name); });
        react.root.render(<App />);
    });

    await register(null, {
        shell: {
            //`order` rather than an index, so two tabs can be added without
            //either knowing about the other. Ties fall back to the name.
            tab: function (t) { tabs.push(t); },
            pane: function (p) { panes.push(p); }
        }
    });
}
module.exports = plugin;
