var React = require('react');

//---------------------------------------------------------------------------
//the dashboard's own look, as a rectify theme kit.
//
//WHAT THIS REPLACED. The scaffold shipped an example kit — bootstrap, jquery,
//bootstrap-icons — and said so in as many words: "this is an example kit, not
//the scaffold's opinion... bringing your own style is the expected thing to do".
//This is that swap. `theme` is still the slot and nothing outside this folder
//knows what is behind it.
//
//THE STYLESHEET IS THE DASHBOARD'S, CARRIED OVER WHOLE. dashboard.scss is
//ui/ui.css copied across unchanged — 1,274 lines of a vocabulary that took a
//long time to get right, and every class name in it is already load-bearing:
//`npm test` over there checks that every class the window uses exists, because
//CSS has no undefined-name error and a misspelt class is the quietest failure
//available. Copied rather than rewritten so that stays true.
//
//It arrives as .scss only because the build has a rule for that and not for
//plain .css, and scss is a superset. Nothing in it uses sass.
//
//AND SELECTION IS BACK ON. The example kit set `user-select: none` on body,
//which is the right default for a desktop app you drag around and the wrong one
//for this: the whole app is text somebody copies — machine names, branch names,
//commit shas, the exact wording of a refusal. Over in the old window there is a
//rule that a panel must not redraw unless something changed, written because
//rewriting identical text destroys a selection mid-copy and "a snapshot count
//that ticks is uncopyable". A stylesheet that forbids selecting at all makes
//that whole argument moot in the worst way.
//
//Chrome keeps `none` — the topbar, the tabs, the buttons — because that is what
//the convention is actually for.
//---------------------------------------------------------------------------

plugin.consumes = ['react', 'config', 'appPackage'];
plugin.provides = ['theme'];
async function plugin(imports, register, config) {
    require('./dashboard.scss');

    //ONE MODE, AND IT IS DARK. The dashboard has no light theme and never had:
    //its tokens are a dark palette and the panels are built on them. A switcher
    //here would offer something that does not exist.
    document.body.classList.add('okc');

    //---- the shell ---------------------------------------------------------
    //
    //`.topbar` is a flex row: the brand on the left, the tabs pushed right by
    //`margin-left: auto`. The dot is the one-glance answer to "is this thing
    //connected", which is why it is first and why it is a colour rather than a
    //word.
    function Topbar({ brand, sub, live, tabs, on, onPick, right }) {
        return (
            <div className="topbar">
                <div className="brand">
                    <span className="dot" style={live ? { background: 'var(--ok)' } : undefined}
                        title={live ? 'connected' : 'not connected'} />
                    <strong>{brand}</strong>
                    {sub ? <span className="mono muted">{sub}</span> : null}
                </div>
                <div className="tabs">
                    {(tabs || []).map(function (t) {
                        var name = typeof t == 'string' ? t : t.name;
                        return (
                            <button key={name}
                                className={'tab' + (name == on ? ' on' : '')}
                                onClick={function () { if (onPick) onPick(name); }}>
                                {name}
                                {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
                            </button>
                        );
                    })}
                </div>
                {right || null}
            </div>
        );
    }

    //---- the pieces every pane is made of ----------------------------------

    //`active` IS NOT OPTIONAL, and leaving it off cost an evening. The
    //stylesheet says `.pane { display: none }` and `.pane.active { display:
    //block }` — so a pane without it is a correctly named, correctly spelt,
    //completely invisible container. The class guard cannot see this: the name
    //exists, which is all it checks.
    //
    //The old window pre-rendered every pane and toggled `active` to switch
    //between them. Here the shell mounts one tab at a time, so a pane that
    //exists at all is the one being looked at — there is nothing to toggle, and
    //the modifier is simply always on.
    function Pane({ children }) { return <div className="pane active">{children}</div>; }
    function Panel({ children }) { return <div className="panel">{children}</div>; }
    function Card({ children, on, onClick }) {
        return <div className={'card' + (on ? ' on' : '')} onClick={onClick}>{children}</div>;
    }
    function Badge({ children, kind }) {
        return <span className={'badge' + (kind ? ' ' + kind : '')}>{children}</span>;
    }
    function Button({ children, kind, ...rest }) {
        return <button className={'btn' + (kind ? ' ' + kind : '')} {...rest}>{children}</button>;
    }
    //"NOTHING HERE" IS AN ANSWER AND HAS ITS OWN LOOK, because an empty panel
    //reads as broken and this reads as empty — a different thing, and the one
    //somebody is actually asking about.
    function Empty({ children }) { return <p className="empty">{children}</p>; }
    function Note({ children, kind }) { return <p className={'note' + (kind ? ' ' + kind : ' muted')}>{children}</p>; }
    function Mono({ children }) { return <span className="mono">{children}</span>; }

    await register(null, {
        theme: {
            Topbar, Pane, Panel, Card, Badge, Button, Empty, Note, Mono
        }
    });
}
module.exports = plugin;
