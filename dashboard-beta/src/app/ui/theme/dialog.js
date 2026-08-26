var React = require('react');
var { useState, useEffect, useRef } = React;
//`openOut` REACHES THE PERSON'S REAL BROWSER — see ./bits.js. Taken from there
//rather than written again, because "how a link leaves this window" is one
//decision and this is the second place that needs it.
var { useGuard, openOut, Button } = require('./bits');

//---------------------------------------------------------------------------
//the dialog — where an irreversible thing is agreed to.
//
//THIS IS NOT DECORATION AND IT IS NOT A CONFIRM BOX. Every act in this app that
//cannot be taken back goes through here: send it, merge it, allow this to be
//judged, approve a prompt, approve a contract, destroy a machine. The operator's
//rule is that a PERSON makes those presses — a supervisor may prepare the thing
//and may even say it is ready, and the press is still somebody's.
//
//So this file is the gate, and building five panes that each invent their own
//confirm is exactly the outcome the port was meant to avoid. It exists before
//the panes that need it, on purpose.
//
//WHAT IT LEARNED THE HARD WAY, all of which is carried over rather than
//rediscovered:
//
//  IT IS BOUNDED AND SCROLLS IN THE MIDDLE. The title and the buttons are
//  pinned; only the body moves. A dialog can carry a diff or a whole definition,
//  and those are as long as they are — without this the confirm button ends up
//  below the bottom of a fixed overlay that does not scroll, and the question
//  cannot be answered at all. That has happened.
//
//  THE COST IS STATED SEPARATELY FROM THE EXPLANATION. `cost` is what cannot be
//  undone, and it gets its own line and its own weight, because it is the part
//  somebody skims past when it is the fourth sentence of a paragraph.
//
//  A REFUSAL IS SHOWN IN PLACE. When `onYes` throws, the dialog stays open and
//  says why. Closing and going quiet loses the one sentence that explains what
//  to do instead — and half the refusals in this app are the app working
//  correctly, so they are worth reading.
//
//  A NODE IS ALLOWED WHERE A SENTENCE IS. Some of what a dialog has to say is a
//  table — two addresses and two branch names per repository, which is a grid
//  however it is worded. Written as prose it was mangled three times running.
//  The screen behind the dialog already draws it properly; this lets the dialog
//  use THAT rather than a second attempt at saying the same thing.
//
//  TABS REBUILD RATHER THAN HIDE. A tab's fields are what get read on confirm,
//  so leaving the other tab's inputs mounted means whichever was touched last
//  decides what is submitted.
//---------------------------------------------------------------------------

//---- the store -----------------------------------------------------------
//
//IMPERATIVE ON PURPOSE. A dialog is opened from a click handler, deep inside a
//pane, and the answer is awaited right there — `await ask({...})` reads like
//what it is. Threading open/close state down through every pane to a component
//would put the gate's plumbing in forty places.

var stack = [];
var watchers = new Set();
var nextId = 1;

function announce() { watchers.forEach(function (w) { w(stack.slice()); }); }

//Opens a dialog and settles when it is answered: `true` if confirmed, `false` if
//dismissed. `onYes` still runs inside, because it is what decides whether the
//dialog may close.
function ask(spec) {
    return new Promise(function (resolve) {
        stack = stack.concat([{ id: nextId++, spec: spec, resolve: resolve }]);
        announce();
    });
}

function drop(id, answer) {
    var it = null;
    stack = stack.filter(function (d) {
        if (d.id != id) return true;
        it = d; return false;
    });
    announce();
    if (it) it.resolve(answer);
}

//---- fields --------------------------------------------------------------

//`f.protect` MARKS A VALUE THAT IS THE PERSON'S AND NOBODY ELSE'S. It draws a
//purple outline, and the driver withholds the value from everything it reports
//— see ../drive/window.js. The mark and the withholding are one feature: an
//outline saying "this is private" on something readable is a decoration.
function Field({ f, value, onChange }) {
    //Guarded by the same list the buttons are, and by its label for the same
    //reason: it is what the driver matches on and what a person reads.
    var mark = useGuard(f.label, f.protect) ? ' protected' : '';
    //A CHECKBOX ANSWERS WITH `checked`. Its `value` is the string "on" whether
    //it is ticked or not, which is the quietest way available to build a form
    //where every box reads as yes.
    if (f.type == 'checkbox') {
        return (
            <div>
                <label className="inline" style={{ gap: '8px' }}>
                    <input type="checkbox" checked={value === true} disabled={f.disabled}
                        onChange={function (e) { onChange(e.target.checked); }} />
                    <span>{f.label}</span>
                </label>
                {/* What ticking it actually does. A checkbox with consequences
                    somebody cannot see is the one they tick wrongly and find out
                    about later. */}
                {f.hint ? <p className="note muted">{f.hint}</p> : null}
            </div>
        );
    }

    var input;
    if (f.options) {
        input = (
            <select className={mark.trim() || undefined} value={value} disabled={f.disabled} onChange={function (e) { onChange(e.target.value); }}>
                {f.options.map(function (o) { return <option key={o.value} value={o.value}>{o.label}</option>; })}
            </select>
        );
    } else if (f.multiline) {
        input = (
            <textarea className={mark.trim() || undefined} rows={f.rows || 8} placeholder={f.placeholder || ''} value={value} disabled={f.disabled}
                onChange={function (e) { onChange(e.target.value); }} />
        );
    } else {
        input = (
            <input className={mark.trim() || undefined} type={f.type || 'text'} placeholder={f.placeholder || ''} value={value} disabled={f.disabled}
                onChange={function (e) { onChange(e.target.value); }} />
        );
    }

    return (
        <div>
            {/* A FIELD THAT IS THERE AND CANNOT BE USED YET is a different thing
                from a field that is absent. "Which kind of machine" has nothing
                to offer until a machine is tagged; hidden until then it is a
                feature that appears one day out of nowhere. Same rule as a
                button: disable what must not be used, and say why. */}
            {/* A RED `*` ON WHAT THE DOOR WILL REFUSE WITHOUT. Every one of
                those refusals already exists and most are good sentences — but
                a form whose faults are only legible after pressing it is one
                somebody presses three times to find all of them.

                A SPAN AND NOT `content: '*'`. A pseudo-element is invisible to
                `windowControls`, which reads labels to say what is on screen, so
                the one check that could notice the mark had stopped rendering
                would not see it. */}
            <label>
                {f.label}
                {f.needed ? <span className="needed" title="required">*</span> : null}
            </label>
            {input}
            {/* Where a value comes from is the thing somebody is missing at the
                moment they are asked for it. */}
            {f.hint ? <p className="note muted">{f.hint}</p> : null}
        </div>
    );
}

function startingValues(fields) {
    var v = {};
    (fields || []).forEach(function (f) {
        v[f.name] = f.type == 'checkbox' ? (f.value === true || f.value === 'true') : (f.value == null ? '' : String(f.value));
    });
    return v;
}

//---- one dialog ----------------------------------------------------------

function Dialog({ id, spec }) {
    var tabs = spec.tabs && spec.tabs.length ? spec.tabs : null;
    var [openTab, setOpenTab] = useState(0);

    //The tab's own half wins over the dialog's, so a tab can change the fields,
    //the cost and the button without repeating the title.
    var t = tabs ? tabs[openTab] : {};
    var fields = (tabs ? t.fields : spec.fields) || [];
    var plain = t.plain || spec.plain;
    var cost = t.cost || spec.cost;
    var confirm = t.confirm || spec.confirm || 'Yes';
    var danger = t.danger != null ? t.danger : spec.danger;
    var onYes = t.onYes || spec.onYes;
    //A DIALOG'S CONFIRM IS THE PRESS, so it is the one that most needs to be
    //guardable. Same rule as a Button: `protect` is the app proposing, the
    //guards list decides, and the person's own press is untouched either way —
    //what a guard stops is something else pressing it for them.
    var guardedYes = useGuard(confirm, t.protect != null ? t.protect : spec.protect);

    var [values, setValues] = useState(function () { return startingValues(fields); });
    var [err, setErr] = useState(null);
    var [busy, setBusy] = useState(false);
    var first = useRef(null);

    //REBUILT WHEN THE TAB CHANGES, which is the whole reason tabs are handled
    //here rather than by opening a second dialog: the values must not survive
    //the switch, or whichever tab was touched last decides what is submitted.
    useEffect(function () { setValues(startingValues(fields)); setErr(null); }, [openTab]);

    useEffect(function () { if (first.current) first.current.focus(); }, []);

    function set(name, v) {
        setValues(function (was) { var next = Object.assign({}, was); next[name] = v; return next; });
    }

    async function yes() {
        setBusy(true);
        setErr(null);
        try {
            //Strings arrive trimmed; a checkbox arrives as a boolean.
            var out = {};
            Object.keys(values).forEach(function (k) {
                out[k] = typeof values[k] == 'string' ? values[k].trim() : values[k];
            });
            if (onYes) await onYes(out);
            drop(id, true);
        } catch (e) {
            setErr((e && e.message) || String(e));
            setBusy(false);
        }
    }

    return (
        <div className="dlg-overlay" onClick={function (e) { if (e.target === e.currentTarget) drop(id, false); }}>
            <div className="dlg">
                <div className="dlg-title">{spec.title}</div>

                {tabs ? (
                    <div className="dlg-tabs">
                        {tabs.map(function (x, i) {
                            return (
                                <button key={x.label} className={'dlg-tab' + (i == openTab ? ' active' : '')}
                                    onClick={function () { setOpenTab(i); }}>{x.label}</button>
                            );
                        })}
                    </div>
                ) : null}

                {/* THE MIDDLE IS THE ONLY PART THAT SCROLLS. */}
                <div className="dlg-body">
                    {plain && plain.filter(Boolean).length ? (
                        <div>
                            <div className="dlg-heading">What this does</div>
                            <ul>
                                {plain.filter(Boolean).map(function (p, i) {
                                    //A node is allowed where a sentence is.
                                    return typeof p == 'string'
                                        ? <li key={i}>{p}</li>
                                        : <li key={i} className="wide">{p}</li>;
                                })}
                            </ul>
                        </div>
                    ) : null}

                    {/* WHAT IS ABOUT TO GO OUT, WHERE IT CAN BE READ FIRST.
                        For the acts whose whole risk is the CONTENT rather than
                        the button — a comment on a stranger's pull request, a
                        message this host publishes under somebody's name. Those
                        cannot be unsent, so "read it afterwards and fix it" is
                        not available the way it is nearly everywhere else.

                        BOUNDED AND SCROLLING IN THE MIDDLE. The title and the
                        buttons stay pinned; twelve thousand characters inside a
                        dialog that grows would put the confirm button below the
                        bottom of a fixed overlay, which the app being ported
                        from records having done.

                        `console read`, NOT `console tall`: tall is a viewport
                        height and belongs to a pane that IS the screen. */}
                    {/* THE HEADING IS THE CALLER'S. It said "What will be
                        posted" for everybody, which was written for the one
                        caller there was — a review going onto a pull request —
                        and was a lie on the next one: a sign-in URL is something
                        to VISIT, and a box over it saying it will be posted
                        describes a thing that is not going to happen. */}
                    {spec.reads ? (
                        <div>
                            <div className="dlg-heading">{spec.readsAre || 'What will be posted'}</div>
                            <div className="console read">{spec.reads}</div>
                            {/* AND A WAY TO OPEN IT, when what is being read is
                                an address rather than a document.

                                AN ORDINARY LINK WOULD NAVIGATE THE DASHBOARD.
                                This is an app page, so an `<a href>` replaces
                                the window with the sign-in page and takes the
                                dialog waiting for the code with it — see
                                `openOut`, which hands it to the operating system
                                instead.

                                THE ADDRESS STAYS VISIBLE BESIDE IT. A button
                                that silently fails to open leaves nothing to
                                fall back on, and for a sign-in this address is
                                the only way to finish what was started on the
                                machine. */}
                            {spec.opens ? (
                                <div className="row" style={{ marginTop: '8px' }}>
                                    {/* AWAITED, because opening a browser is the
                                        NODE half's job here and therefore a
                                        round trip — see `setOpener` in
                                        ./window.js. The old version treated it
                                        as a boolean and reported failure before
                                        it had happened. */}
                                    <Button onClick={function () {
                                        setErr(null);
                                        Promise.resolve(openOut(spec.reads)).then(function (ok) {
                                            if (!ok) setErr('Could not open a browser — copy the address above instead.');
                                        });
                                    }}>{spec.opens}</Button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {cost ? <div className="dlg-cost"><strong>Cannot be undone: </strong>{cost}</div> : null}
                    {spec.link ? <p><a className="linky" href={spec.link} target="_blank" rel="noreferrer">{spec.link}</a></p> : null}

                    {/* Fields go in the scrolling half, after whatever explains
                        them. */}
                    {fields.map(function (f, i) {
                        return (
                            <div key={f.name} ref={i === 0 ? first : null}>
                                <Field f={f} value={values[f.name]} onChange={function (v) { set(f.name, v); }} />
                            </div>
                        );
                    })}
                </div>

                {err ? <p className="dlg-err">{err}</p> : null}

                <div className="dlg-actions">
                    <button className="btn" onClick={function () { drop(id, false); }}>Never mind</button>
                    {spec.extra ? (
                        <button className={'btn' + (spec.extra.danger ? ' danger' : '')}
                            onClick={function () { drop(id, false); spec.extra.onClick(); }}>
                            {spec.extra.label}
                        </button>
                    ) : null}
                    <button className={'btn ' + (danger ? 'danger' : 'ok') + (guardedYes ? ' protected' : '')} disabled={busy} onClick={yes}>
                        {busy ? 'working…' : confirm}
                    </button>
                </div>
            </div>
        </div>
    );
}

//---- the host ------------------------------------------------------------
//
//Mounted once by the shell. Renders the top of the stack only — a dialog opened
//from inside a dialog covers it rather than sitting beside it.

function Dialogs() {
    var [open, setOpen] = useState(stack);
    useEffect(function () {
        watchers.add(setOpen);
        return function () { watchers.delete(setOpen); };
    }, []);
    if (!open.length) return null;
    var top = open[open.length - 1];
    return <Dialog key={top.id} id={top.id} spec={top.spec} />;
}

//`Field` IS EXPORTED BECAUSE FORMS EXIST OUTSIDE DIALOGS. A pane that asks for
//a value in place -- a note, an address, a search that is more than one box --
//should draw it the same way the gate does, not nearly the same way.
module.exports = { ask, Dialogs, Field };
