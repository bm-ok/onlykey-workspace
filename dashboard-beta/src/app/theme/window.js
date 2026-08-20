var React = require('react');
var layout = require('./layout');
var bits = require('./bits');
var dialog = require('./dialog');

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
    function Topbar({ brand, sub, live, tabs, on, onPick, right, brandTab, brandBadge, onBrand }) {
        //`.brand` IS THE CONTAINER, NOT THE BUTTON, and the first version of this
        //got it backwards. Over there the brand is a flex row holding the dot,
        //then a `<button class="tab brand-tab">`, then whatever else belongs at
        //the far left. Making the whole row one button put a dashed border
        //around the dot and the version number, and dropped `.tab`, so it got
        //none of the styling every other tab has.
        //
        //`brand-tab` IS A MODIFIER OF `tab`: monospace, accent-coloured, dashed
        //border, and truncated because a workspace path is long. It is a real
        //tab so the same switching and the same active styling drive it.
        return (
            <div className="topbar">
                <div className="brand">
                    <span className="dot" style={live ? { background: 'var(--ok)' } : undefined}
                        title={live ? 'connected' : 'not connected'} />

                    {/* THE TITLE IS THE WAY IN, because it was the one thing in
                        this chrome that did nothing. What is behind it answers
                        "what is waiting on me" — the question somebody asks
                        after finding out the hard way that something sat for a
                        day. Every other badge in this window is one corner of
                        it. */}
                    {brandTab
                        ? <button className={'tab brand-tab' + (on == brandTab ? ' active' : '')}
                            title={'what is waiting on you'}
                            onClick={function () { if (onBrand) onBrand(brandTab); }}>
                            <strong>{brand}</strong>
                            {brandBadge ? <span className="tab-badge">{brandBadge}</span> : null}
                        </button>
                        : <strong>{brand}</strong>}

                    {sub ? <span className="mono muted">{sub}</span> : null}
                </div>
                <div className="tabs">
                    {(tabs || []).map(function (t) {
                        var name = typeof t == 'string' ? t : t.name;
                        return (
                            //`active`, NOT `on`, AND THE DIFFERENCE WAS INVISIBLE. The
                            //stylesheet defines `.tab.active`; this said `on`, so the
                            //tab bar had no current tab at all — eleven tabs, none of
                            //them looking chosen, through a dozen screenshots.
                            //
                            //The name check could not catch it and it is worth saying
                            //why: `on` IS a real class — `.card.on`, `.chip.on` — so
                            //the name exists, which is all that check asks. A wrong
                            //name that happens to be somebody else's right name is the
                            //quietest version of the quietest failure available here.
                            //
                            //There is a check for it now. test/classes.test.js knows
                            //which modifiers the stylesheet gives each base, and says
                            //`"on" is not a modifier of "tab"; it gives "active"`.
                            <button key={name}
                                className={'tab' + (name == on ? ' active' : '')}
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
    //
    //THE REST OF THE KIT LIVES IN ITS OWN FILES, because it stopped being a
    //handful of wrappers. ./layout is the shape of a tab, ./bits is everything
    //small enough to have no argument attached to it, and ./dialog is the gate.
    //Only Topbar and Pane are here, and only because they are the shell's own
    //furniture rather than a pane's.

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

    await register(null, {
        //ONE OBJECT, AND A PANE NEVER SEES A CLASS NAME. Everything a pane
        //is allowed to draw with is here; anything it cannot find is either
        //missing from the kit — worth adding here so the next pane gets it too
        //— or is that pane's own furniture and belongs in its own stylesheet.
        //See ../../THEME.md for which is which.
        theme: Object.assign({ Topbar, Pane }, layout, bits, dialog)
    });
}
module.exports = plugin;
