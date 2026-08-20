var React = require('react');
var { useState, useEffect } = React;

//---- who decides what is guarded -------------------------------------------
//
//THE THEME MUST NOT CONSUME `guards`, and this is why the answer arrives
//backwards. Every pane consumes the theme, and the guards pane is a pane — so a
//theme that asked for `guards` would be waiting on something waiting on it.
//
//Instead the theme keeps a hook with a safe default: what the code proposed
//stands, and nothing is unlocked. The guards plugin fills it in when it comes
//up. If it never comes up, every proposed guard is still a guard — which is the
//direction to fail in, since the cost is a trip to the window and the other
//direction is a press nobody agreed to.
var guardHook = {
    check: function (label, proposed) { return !!proposed; },
    watchers: new Set()
};
function setGuardCheck(fn) {
    guardHook.check = fn || function (label, proposed) { return !!proposed; };
    guardsChanged();
}
function guardsChanged() {
    guardHook.watchers.forEach(function (w) { w(); });
}
//Subscribed per control, so turning a guard on repaints the button that moment
//rather than at the next time something else happens to render.
function useGuard(label, proposed) {
    var [, bump] = useState(0);
    useEffect(function () {
        var f = function () { bump(function (n) { return n + 1; }); };
        guardHook.watchers.add(f);
        return function () { guardHook.watchers.delete(f); };
    }, []);
    return guardHook.check(label, proposed);
}

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
//"NOTHING HERE" AND "NOTHING HERE, AND THAT IS WRONG" ARE DIFFERENT SENTENCES.
//No line naming a branch is an ordinary Tuesday; no repository having a default
//branch should not be possible. Drawn the same way, the second reads as the
//first and nobody looks into it.
function Empty({ children, bad }) { return <p className={'empty' + (bad ? ' bad' : '')}>{children}</p>; }
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

//`protect` MARKS A PRESS THAT IS A PERSON'S TO MAKE. It draws purple and the
//command line is refused when it tries to press one — send it, merge it, allow
//this to be judged, approve a prompt. The colour is only honest because of that
//refusal; a mark saying "you cannot press this" on something a model can press
//is worse than no mark at all.
//
//SPELT `protect` RATHER THAN `protected` because `protected` is reserved in
//strict mode and cannot be destructured out of props. The class is `protected`,
//which is the word that shows up in the markup and in what the driver reports.
function Button({ children, kind, protect, guard, ...rest }) {
    //THE WORDS ON THE BUTTON ARE ITS NAME. That is what the driver matches on,
    //what the guards pane lists, and what a person reads — three things that
    //have to agree, and only agree by being the same string. `guard` is the
    //override for a button whose children are not plain text.
    var label = guard || (typeof children == 'string' ? children : null);
    var on = useGuard(label, protect);
    var cls = 'btn' + (kind ? ' ' + kind : '') + (on ? ' protected' : '');
    return <button className={cls} {...rest}>{children}</button>;
}

//The `+` that lives in a TitleRow. Making a thing is a deliberate act with a
//reason — branch cuts used to happen as a side effect of setting a machine up,
//from whatever string a task carried, so a typo made a branch rather than an
//error.
//THE ROUND CONTROL AT THE END OF A TITLE ROW. Named for what it usually is
//rather than what it always is: the same control carries a refresh glyph on a
//list that syncs. Hard-coding "+" here sent the branch list's sync button
//through a plain <button>, which is how a guard silently did not apply once
//already -- a control outside the kit is a control the guard cannot see.
function Plus({ title, onClick, kind, disabled, children }) {
    return (
        <button className={'plus' + (kind ? ' ' + kind : '')} title={title}
            onClick={onClick} disabled={disabled}>{children == null ? '+' : children}</button>
    );
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

//The wrapper that makes inputs inside it look like fields. `.form` and `.dlg`
//carry the same rules, so a form in a pane and a form in the gate cannot drift.
function Form({ children }) { return <div className="form">{children}</div>; }

//A heading with whatever chooses what is being looked at beside it, pushed
//right. The bigger cousin of TitleRow: that one is a line, this one wraps and
//dresses the inputs in it.
function HeadRow({ children }) { return <div className="head-row">{children}</div>; }
function Controls({ children }) { return <div className="head-controls">{children}</div>; }

//---- something being read -------------------------------------------------
//
//A <pre> AND NOT AN EDITOR, AND THAT IS A GAP RATHER THAN A DECISION. The rule
//in the old window is "code that is read gets an editor, not a <pre>", written
//because a hundred lines of undifferentiated JavaScript is something a person
//scrolls past and approves anyway — which is exactly the failure the approval
//panes exist to prevent. It vendors Ace for this.
//
//This app does not vendor it yet, and pretending otherwise would be worse than
//saying so: `Code` is the seam, so the day the editor arrives one file changes
//and every pane that shows something for reading gets it.
//
//BOUNDED, because it appears inside a dialog. A script that grows pushes the
//confirm button off the bottom of a fixed overlay, which is how a question
//becomes unanswerable — that has happened here before.
function Code({ text, tall }) {
    return <pre className={'code' + (tall ? ' tall' : '')}>{String(text == null ? '' : text)}</pre>;
}

//---- waiting -------------------------------------------------------------

//A SKELETON RATHER THAN THE WORD "LOADING".
//
//Every pane ported before this said `asking…`, which was my shortcut and is
//worse than what it replaced: it says nothing about what is coming and reads
//like a failure state. A shape says "this is a list, and it is on its way" —
//and it holds the layout still, so the page does not jump when the answer
//lands.
//`sample` MARKS AN EXHIBIT RATHER THAN A WAIT. The Kit pane shows one of these
//as a specimen, and anything asking "is this pane still loading" by looking for
//a skeleton on the screen concluded that the catalogue was loading forever.
//
//A data attribute rather than a class, on purpose: there is nothing to style
//here, and a class would have to be added to a stylesheet and checked by the
//guard for no reason other than to be ignored.
function Skeleton({ rows, sample }) {
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
    return <div data-sample={sample ? '1' : undefined}>{cards}</div>;
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
//HOW LONG AGO, IN ONE PLACE.
//
//This was written out separately in three panes and the copies had already
//stopped agreeing: one said "1 minutes ago", and they crossed from hours into
//days at 36 hours and at 48 hours respectively. None of that is a decision --
//it is drift, and the kind that is invisible because each pane reads fine on
//its own and they are never seen side by side.
//
//THE THRESHOLDS ARE THE OLD WINDOW'S, deliberately: seconds up to 90, minutes
//up to 90 minutes, hours up to two days, days after. Somebody who knows that
//window should not have to learn a second sense of "a while ago" here.
function ago(when) {
    if (!when) return '—';
    var secs = Math.max(0, Math.round((Date.now() - Date.parse(when)) / 1000));
    var n, unit;
    if (secs < 90) { n = secs; unit = 'second'; }
    else if (secs < 5400) { n = Math.round(secs / 60); unit = 'minute'; }
    else if (secs < 172800) { n = Math.round(secs / 3600); unit = 'hour'; }
    else { n = Math.round(secs / 86400); unit = 'day'; }
    return n + ' ' + unit + (n == 1 ? '' : 's') + ' ago';
}

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
//---- a section inside a pane, and its heading -----------------------------
//
//A HEADING THAT CARRIES QUALIFIERS BESIDE IT: what this section is, then which
//repository it was read from, then when. Distinct from `TitleRow` in one way
//that matters -- the muted parts beside the word stay in normal case.
//
//THAT IS NOT A FLOURISH. "ISSUES ON BM-SANDBOX-B/LOCAL-REPO-A 11 HOURS AGO"
//shouts a repository path that somebody has to read character by character to
//check, and uppercasing a name makes it a DIFFERENT name to the eye than the
//one in the list two inches to the left.
//
//Both of these were being written as bare class names in one pane already,
//which is how a kit stops being the place the answer lives.
function Group({ children }) { return <div className="carries">{children}</div>; }
function Head({ children }) { return <div className="carries-head">{children}</div>; }

//---- a thin row of facts, and the sentence under it -----------------------
//
//A LIST OF BRANCHES IS NOT A LIST OF CARDS. A card is a thing somebody picks;
//these are rows somebody reads down, twenty at a time, looking for the one that
//is wrong. Cards at that count are a wall of borders and the eye has nowhere to
//run, so this is a rule between rows and nothing else.
//
//NAME LEFT, FACTS RIGHT, AND THE FACTS TRAVEL TOGETHER. The row is
//space-between, so anything handed to `right` has to arrive as ONE child or the
//name drifts into the middle -- which is why `right` is a slot rather than the
//caller spreading facts into `children`. Paid for once already in the old
//window, in this exact list.
function Part({ children, right }) {
    return (
        <div className="group-part">
            <span>{children}</span>
            {right == null ? null : <span className="where">{right}</span>}
        </div>
    );
}

//WHAT TO DO ABOUT THE ROW ABOVE, in a sentence, indented and quiet.
//
//The facts on the row answer "is my copy current". This answers the question
//somebody actually has -- am I done with this branch -- and it is the one that
//is genuinely hard to see, because a squashed pull request leaves work that HAS
//landed and looks unmerged. It is an explanation rather than a second row of
//facts, and is styled as one.
function PartWhy({ children }) { return <div className="group-why">{children}</div>; }

function Kv({ children }) { return <table className="kv"><tbody>{children}</tbody></table>; }
function KvRow({ label, children }) { return <tr><th>{label}</th><td>{children}</td></tr>; }

module.exports = {
    setGuardCheck, guardsChanged, useGuard,
    Panel, Card, CardTitle, CardSub, Empty, Note, Mono, Muted,
    Badge, Badges, Chips, Chip,
    Button, Plus, Cog, Finder, Form, HeadRow, Controls,
    Skeleton, Notice, Banner, Link, Spec, Kv, KvRow, Part, PartWhy, Group, Head, Code, ago, openOut
};
