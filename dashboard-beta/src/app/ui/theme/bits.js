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
//`muted` IS FOR A CARD THAT IS FINISHED RATHER THAN ONE THAT IS UNIMPORTANT — a
//todo marked done, and whatever else ends up meaning the same thing. It stays in
//the list on purpose, because done is kept and shown; it just stops competing
//with the things still to do.
function Card({ children, pick, on, warn, muted, onClick, title }) {
    var cls = 'card' + (pick ? ' pick' : '') + (on ? ' on' : '') + (warn ? ' warn' : '') + (muted ? ' muted' : '');
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

//TWO VIEWS OF ONE SUBJECT, INSIDE A PANE.
//
//NOT THE SAME THING AS A SUB-TAB IN THE ROW ABOVE, though it is drawn the same
//and that is deliberate. The row above picks the SUBJECT — which pane you are
//looking at. This picks the QUESTION being asked about one subject: the same
//change, read as files or as commits.
//
//NOT A CHIP EITHER. A chip is a filter and several can be on at once; exactly
//one of these is on, always, and picking one puts the last one away.
//
//IT EXISTS BECAUSE THE AD-HOC VERSION KEPT COMING BACK. Live had a pair of these
//built out of `useState` and raw class names, and Changes had another, each with
//its own `subtab(look, name)` helper — and the one in Changes carried a comment
//about how to write the comparison so the class checker would not report "files"
//as a missing CSS class. That is a pane working around a guard because the kit
//was missing a piece.
//
//THE DRIVER CAN PRESS THEM, by the words on them, like any button — they are
//buttons. What it cannot do is reach one with `show --pane`, because these are
//not registered with the shell; `show` moves between PANES and this is inside
//one. Worth knowing before writing a walk that expects to find them.
function Views({ names, on, onPick }) {
    var same = function (a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); };
    return (
        <div className="subtabs">
            {(names || []).map(function (n) {
                return (
                    <button key={n} className={'subtab' + (same(on, n) ? ' active' : '')}
                        onClick={function () { if (onPick) onPick(n); }}>{n}</button>
                );
            })}
        </div>
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

//WHICH ORDER A LIST IS IN, beside the box that says which of it to show.
//
//A select rather than chips on purpose: these are five answers to ONE question
//and exactly one of them is true at a time, which is the one thing a row of
//chips cannot say. Chips are for "which kinds am I looking at", where any
//combination is meaningful.
//
//Controlled, like Finder, and for the same reason — what order a list is in is
//the list's business.
function Sorter({ value, onChange, options, title }) {
    return (
        <select className="sorter" value={value} title={title}
            onChange={function (e) { onChange(e.target.value); }}>
            {(options || []).map(function (o) {
                var id = Array.isArray(o) ? o[0] : o;
                var label = Array.isArray(o) ? o[1] : o;
                return <option key={id} value={id}>{label}</option>;
            })}
        </select>
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
//`Code`, `Editor` AND `Markdown` ARE NOT IN THIS FILE, and that is the one place
//the kit reaches outside itself. Each is backed by a vendored library that
//belongs to a single concern — Ace in ../editor, marked in ../markdown, each
//with its own vendor folder inside its own plugin — and ../window.js folds them
//into the theme object so a pane still asks the theme for everything and never
//learns where they came from.
//
//WHICH IS THE POINT RATHER THAN A COMPROMISE. "Code that is read gets an editor,
//not a <pre>" is a rule about approvals: a hundred lines of undifferentiated
//JavaScript is something a person scrolls past and then approves anyway, which
//is exactly the failure the approval panes exist to prevent. This file used to
//hold a <pre> and a note admitting it was a gap. The gap is closed, and closing
//it changed one file rather than every pane, which is what the seam was for.

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

//GOING SOMEWHERE, WRITTEN AS A LINK BUT NOT ONE. `Link` opens the person's real
//browser; this moves them within the app, and the difference matters enough that
//the two must not look interchangeable in a pane's source.
//
//IT IS A <button> AND NOT AN <a> because there is no address. An anchor with no
//href is a thing screen readers announce as a link and then cannot follow, and
//an anchor with href="#" puts a stray entry in the history for every press.
//
//THE STYLESHEET ALREADY EXPECTED IT. `.linky` has been there since the theme was
//carried over, described as "a button that reads as a link, for moving between
//views rather than acting" -- and the banner rules style `.running-banner .linky`
//and `.testing-banner .linky` specifically, because the accent blue is the one
//colour on those grounds nobody can read.
//A LINK THAT IS PRESSED RATHER THAN FOLLOWED, and it is a <button> for that
//reason: it does something, so it answers to the keyboard and to the driver like
//everything else that does something.
//
//`protect` MAKES IT PURPLE, AND THE SAME PURPLE MEANS THE SAME THING. A guarded
//Linky is a person's press exactly as a guarded Button is — the driver refuses it
//by the same class, the guards pane lists it by the same words. What changes is
//only the weight: a sentence with a repair at the end of it wants a phrase, not a
//control sitting in the middle of the paragraph.
function Linky({ children, onClick, title, protect, guard }) {
    //THE WORDS ON IT ARE ITS NAME, the same rule as Button: that is what the
    //driver matches, what the guards pane lists and what a person reads, and the
    //three only agree by being one string.
    var label = guard || (typeof children == 'string' ? children : null);
    var on = useGuard(label, protect);
    return <button className={'linky' + (on ? ' protected' : '')} onClick={onClick} title={title}>{children}</button>;
}

//A SWITCH: A STATE SOMEBODY SETS, NOT AN ACT SOMEBODY PERFORMS.
//
//THAT IS THE WHOLE REASON IT IS NOT A BUTTON. A button says "do this now" and
//the result is a thing that happened; a switch says "be like this from now on"
//and the result is a thing that is TRUE. Reading its own state back is the point
//of the shape — you can see how it is set without pressing anything, which a
//button cannot do and a pair of buttons only fakes.
//
//AND IT IS A CHECKBOX UNDERNEATH, which is not an implementation detail. It is
//what makes it legible to everything else: `windowControls` already reports an
//`input` with its label, its kind and its VALUE, so a switch is a control the
//driver can read the setting of rather than one it flips blind. It answers to
//the keyboard, `protect` marks it the same way it marks a field, and a
//protected one has its value withheld by the same rule that withholds a token.
//
//A LABEL AROUND IT RATHER THAN BESIDE IT, because ../core/drive/window.js looks
//up as well as back — `n.closest('label')` — so the words are its name for the
//driver, for the guards pane and for a person, which is the same rule Button
//keeps.
function Toggle({ children, on, onChange, disabled, title, protect, guard }) {
    var label = guard || (typeof children == 'string' ? children : null);
    var marked = useGuard(label, protect);
    return (
        <label className={'toggle' + (disabled ? ' disabled' : '')} title={title}>
            <input type="checkbox" className={marked ? 'protected' : undefined}
                checked={!!on} disabled={disabled}
                onChange={function (ev) { if (onChange) onChange(ev.target.checked); }} />
            {/* THE PILL IS DRAWN AND NOT PRESSED. The checkbox above is the
                control; this is a picture of it, so nothing here has to keep a
                second idea of which way it is set. */}
            <span className="pill" />
            <span>{children}</span>
        </label>
    );
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
        //`linky-chip` IS A MODIFIER, NOT A SHAPE. Its rule is a cursor and a
        //hover colour and nothing else — the border, the padding and the size
        //are `.chip`, which it was always written to sit beside. On its own it
        //draws as bare text that happens to be clickable, which is the quiet
        //kind of wrong: it renders, it works, and it looks like nothing.
        <a className={chip ? 'chip linky-chip' : 'linky'} href={href} target="_blank" rel="noreferrer"
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
//---- one capability, as a row ---------------------------------------------
//
//A NAME, WHAT IT IS FOR, AND WHAT IT TAKES. Three columns and no card, because
//this is a reference somebody scans down looking for one name — two hundred and
//fifty cards is a scroll bar and nothing else. The name column is a fixed width
//so the descriptions line up and the eye can run down them.
//
//THE ARGUMENTS ARE ON THE RIGHT AND QUIET. They are the second question. What
//matters first is whether the thing exists at all and whether it is the one you
//meant.
function Act({ name, about, takes }) {
    return (
        <div className="act">
            <code>{name}</code>
            <span className="about">{about}</span>
            <span className="takes">{takes}</span>
        </div>
    );
}

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
    Badge, Badges, Chips, Chip, Views,
    Button, Toggle, Plus, Cog, Finder, Sorter, Form, HeadRow, Controls,
    Skeleton, Notice, Banner, Link, Linky, Spec, Kv, KvRow, Part, PartWhy, Group, Head, Act, ago, openOut
};
