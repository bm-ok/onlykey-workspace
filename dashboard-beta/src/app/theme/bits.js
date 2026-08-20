var React = require('react');

//---------------------------------------------------------------------------
//the small pieces every pane is built from.
//
//ALL OF THESE CLASSES ALREADY EXIST. dashboard.scss is the old window's
//stylesheet carried over whole, so this file adds no CSS — it only gives the
//vocabulary a name a pane can reach without knowing a class name. That is the
//whole point of `theme` being a slot: swap this folder and nothing else moves.
//
//And the reason panes must not reach class names directly is that CSS has no
//undefined-name error. A misspelt class is the quietest failure available here:
//task cards were once given `picked` when the stylesheet has `pick`, and the
//result was a list that worked perfectly and looked dead.
//---------------------------------------------------------------------------

//---- containers ----------------------------------------------------------

function Panel({ children }) { return <div className="panel">{children}</div>; }

//`pick` IS THE MASTER COLUMN. A card somebody chooses from a list, which is
//most of the left-hand column in this app, and it needs to look clickable
//before it is clicked.
//
//`warn` marks the surprising case — a repository counted from something other
//than its own default — because it changes what every number elsewhere means.
function Card({ children, pick, on, warn, onClick, title }) {
    var cls = 'card' + (pick ? ' pick' : '') + (on ? ' on' : '') + (warn ? ' warn' : '');
    return <div className={cls} onClick={onClick} title={title}>{children}</div>;
}
function CardTitle({ children }) { return <div className="card-title">{children}</div>; }
function CardSub({ children, bad }) { return <div className={'card-sub' + (bad ? ' bad' : '')}>{children}</div>; }

//"NOTHING HERE" IS AN ANSWER AND HAS ITS OWN LOOK, because an empty panel reads
//as broken and this reads as empty — a different thing, and the one somebody is
//actually asking about.
function Empty({ children }) { return <p className="empty">{children}</p>; }
function Note({ children, kind }) { return <p className={'note' + (kind ? ' ' + kind : ' muted')}>{children}</p>; }
function Mono({ children }) { return <span className="mono">{children}</span>; }
function Muted({ children }) { return <span className="muted">{children}</span>; }

//---- marks ---------------------------------------------------------------

function Badge({ children, kind, title }) {
    return <span className={'badge' + (kind ? ' ' + kind : '')} title={title}>{children}</span>;
}
function Badges({ children }) { return <div className="badges">{children}</div>; }

//The counts above a list, and a filter when they are pressable. `b` inside is
//the number, dimmed — the word is what is being counted and reads first.
function Chips({ children }) { return <div className="chips">{children}</div>; }
function Chip({ children, count, on, kind, onClick, title }) {
    var cls = 'chip' + (on ? ' on' : '') + (kind ? ' ' + kind : '');
    return (
        <button className={cls} onClick={onClick} title={title}>
            {children}{count == null ? null : <b>{count}</b>}
        </button>
    );
}

//---- controls ------------------------------------------------------------

function Button({ children, kind, ...rest }) {
    return <button className={'btn' + (kind ? ' ' + kind : '')} {...rest}>{children}</button>;
}

//The `+` that lives in a TitleRow. Making a thing is a deliberate act with a
//reason — branch cuts used to happen as a side effect of setting a machine up,
//from whatever string a task carried, so a typo made a branch rather than an
//error.
function Plus({ title, onClick, kind }) {
    return <button className={'plus' + (kind ? ' ' + kind : '')} title={title} onClick={onClick}>+</button>;
}

//Hidden until the card is hovered or selected, which is deliberate: settings for
//one item in a list of forty should not be forty visible buttons.
function Cog({ title, onClick }) {
    return <button className="cog" title={title} onClick={onClick}>⚙</button>;
}

//Find-a-thing, above a list. Controlled by the caller — this holds no state,
//because which items survive the filter is the list's business, not the box's.
function Finder({ value, onChange, placeholder }) {
    return (
        <input className="finder" value={value} placeholder={placeholder || 'find'}
            onChange={function (e) { onChange(e.target.value); }} />
    );
}

//---- waiting -------------------------------------------------------------

//A SKELETON RATHER THAN THE WORD "LOADING".
//
//Every pane ported before this said `asking…`, which was my shortcut and is
//worse than what it replaced: it says nothing about what is coming and reads
//like a failure state. A shape says "this is a list, and it is on its way" —
//and it holds the layout still, so the page does not jump when the answer
//lands.
function Skeleton({ rows }) {
    var n = rows || 3;
    var cards = [];
    for (var i = 0; i < n; i++) {
        cards.push(
            <div className="skel-card" key={i}>
                <div className="skel skel-line" />
                <div className="skel skel-line" />
            </div>
        );
    }
    return <div>{cards}</div>;
}

//---- saying something happened -------------------------------------------

//Dismissable, and it says so with an ×. A notice that cannot be got rid of is
//one somebody stops seeing.
function Notice({ children, kind, onClose }) {
    return (
        <div className={'notice' + (kind ? ' ' + kind : '')}>
            <span>{children}</span>
            {onClose ? <button className="notice-x" onClick={onClose} title="dismiss">×</button> : null}
        </div>
    );
}

//THREE BANNERS, AND THE COLOURS ARE NOT INTERCHANGEABLE.
//
//  stale    what is on screen is out of date
//  testing  testing mode is on — a STANDING STATE, amber
//  running  a drill is running right now — a MOMENT, purple
//
//The last two wearing one colour is how somebody stops reading either, which is
//written into the stylesheet's own comment and is the reason `--running` exists
//as a token separate from `--warn`.
//SPELT OUT RATHER THAN BUILT. `kind + '-banner'` reads fine and defeats the
//class guard completely — it sees the halves, not the name, so a fourth kind
//added later would render as an unstyled div and the test would pass. Written
//as three literals the guard can check all three, which it did: it rejected the
//computed version on the first run.
var BANNERS = { stale: 'stale-banner', testing: 'testing-banner', running: 'running-banner' };
function Banner({ kind, children }) {
    return <div className={BANNERS[kind] || BANNERS.stale}>{children}</div>;
}

//---- links ---------------------------------------------------------------

//A LINK MUST REACH THE PERSON'S REAL BROWSER, not open inside the app window.
//Under NW.js that is `nw.Shell.openExternal`; in a browser tab it is an ordinary
//link. Asking which we are in is done here once rather than in every pane.
function openOut(href) {
    try {
        if (typeof nw != 'undefined' && nw.Shell) { nw.Shell.openExternal(href); return true; }
    } catch (e) { /* not under nw */ }
    return false;
}
function Link({ href, children, chip }) {
    return (
        <a className={chip ? 'linky-chip' : 'linky'} href={href} target="_blank" rel="noreferrer"
            onClick={function (e) { if (openOut(href)) e.preventDefault(); }}>
            {children || href}
        </a>
    );
}

//---- a foldable block of facts -------------------------------------------

function Spec({ summary, children }) {
    return <details className="spec"><summary>{summary}</summary>{children}</details>;
}

//A key/value table. Used in enough places to be worth naming, and it keeps the
//`<table className="kv">` spelling in one file.
function Kv({ children }) { return <table className="kv"><tbody>{children}</tbody></table>; }
function KvRow({ label, children }) { return <tr><th>{label}</th><td>{children}</td></tr>; }

module.exports = {
    Panel, Card, CardTitle, CardSub, Empty, Note, Mono, Muted,
    Badge, Badges, Chips, Chip,
    Button, Plus, Cog, Finder,
    Skeleton, Notice, Banner, Link, Spec, Kv, KvRow, openOut
};
