var React = require('react');
var { useState, useRef, useEffect } = React;

//the Live tab: one tagged stream of everything this host and every machine it
//supervises are saying, right now.
//
//WHAT A PERSON OPENS IT FOR. "Something long is running — what is happening,
//and if it went wrong, what said so." An install is twenty-five minutes of
//near-silence and then everything at once, and this is the only place a guest's
//output surfaces at all.
//
//THE OLD PANE COULD NOT BE PORTED AS WRITTEN. Over there the window shares the
//server's node context and does `require('./core/log')` — `liveLog.all()` once
//and `liveLog.subscribe()` for push — so it throws on load in any host that is
//not the desktop window. Here there is a socket and a table of named actions,
//so the log is read over the wire like everything else.
//
//AND IT IS READ FROM ZERO EVERY TIME, not from the last id seen. That looks
//wasteful and is the cheap way out of a real trap: ids start at 1 and RESET
//when the dashboard restarts, which it does a dozen times in an afternoon while
//its own code is being worked on. A watcher holding an id from a previous life
//is connected, healthy and permanently silent — which looks exactly like a
//quiet system. Holding no id at all cannot get that wrong. The server's ring is
//2000 entries, so the answer is bounded no matter how long this sits open.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono, Skeleton} = theme;

    //THE LAST 800 OF WHAT MATCHED, not of what arrived. Filtering to one tag
    //during an install is how somebody finds the six lines that matter in two
    //thousand, and cutting before the filter would hide them behind apt output.
    var SHOWN = 800;

    //ONLY THE LEVELS THE STYLESHEET ACTUALLY TINTS. `info` is the plain
    //foreground and has no rule, so it gets no class — a class name that is not
    //in dashboard.scss renders as nothing and is the quietest failure available.
    var TINTED = { good: 1, warn: 1, bad: 1, out: 1 };

    function Line({ e }) {
        //`out` IS NOT `info`, AND FLATTENING THEM IS THE ONE THING NOT TO DO.
        //`out` is raw command or guest output, one row per line so each is
        //filterable; `info` is the app's own sentence about its own act. Tinted
        //differently on purpose — merge them and 500 lines of apt read as the
        //app talking.
        return (
            <div className={'line' + (TINTED[e.level] ? ' ' + e.level : '')}>
                <span className="t">{String(e.at || '').slice(11, 19)}</span>
                <span className="g">{(e.tags || []).join(' ')}</span>
                <span className="m">{e.text}</span>
            </div>
        );
    }

    function Log() {
        var { state, error } = okc.use('logSince', { since: 0 }, 2000);
        var [off, setOff] = useState({});//tags that are muted; starts empty
        var [find, setFind] = useState('');
        var [follow, setFollow] = useState(true);
        var [asking, setAsking] = useState(false);//the Clear button, mid-question
        var [clearErr, setClearErr] = useState(null);
        var box = useRef(null);

        var entries = (state && state.entries) || [];

        var kept = entries.filter(function (e) {
            var tags = e.tags || [];
            for (var i = 0; i < tags.length; i++) if (off[tags[i]]) return false;
            if (!find) return true;
            var q = find.toLowerCase();
            if (String(e.text || '').toLowerCase().indexOf(q) >= 0) return true;
            return tags.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
        });
        var view = kept.slice(-SHOWN);
        var last = view.length ? view[view.length - 1].id : 0;

        //SCROLLED TO THE BOTTOM ONLY WHEN FOLLOW IS TICKED, and only when the
        //newest line actually changed. The old pane learned this the hard way:
        //refilling on every tick sent scrollback to the top, so nothing above
        //the fold could be read during an install — i.e. it broke the pane
        //during the exact event the pane exists for.
        useEffect(function () {
            if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
        }, [follow, last]);

        function clear() {
            //DESTRUCTIVE AND GLOBAL. `logClear` empties the server's log for
            //every client and there is no file behind it, so it is gone. Asked
            //twice on purpose, and worded as what it is rather than as a
            //view-level "hide these lines" — which is what a one-press Clear
            //next to a find box would be read as.
            if (!asking) { setAsking(true); return; }
            setAsking(false);
            okc.call('logClear', {}).then(function () { setClearErr(null); },
                function (e) { setClearErr(e.message); });
        }

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var tags = state.tags || [];

        return (
            <Pane>
                {/* THE ERROR SITS ABOVE THE LAST GOOD ANSWER. A console that
                    blanked while the dashboard restarted would say "nothing is
                    happening" when it means "I could not ask", and during an
                    install those are opposite sentences. */}
                {error ? <Note kind="bad">{error}</Note> : null}
                {clearErr ? <Note kind="bad">{clearErr}</Note> : null}

                <div className="head-row">
                    <h2>Live</h2>
                    <span className="muted">{'— ' + kept.length + ' of ' + entries.length + ' lines'}</span>
                    <div className="head-controls">
                        <label className="inline">
                            <input type="checkbox" checked={follow}
                                onChange={function (ev) { setFollow(ev.target.checked); }} />
                            <span>Follow</span>
                        </label>
                        <input value={find} placeholder="find text"
                            onChange={function (ev) { setFind(ev.target.value); }} />
                        <button className={'btn' + (asking ? ' danger' : '')} onClick={clear}
                            onBlur={function () { setAsking(false); }}>
                            {asking ? 'empty it for everyone?' : 'Clear'}
                        </button>
                    </div>
                </div>

                {/* BUILT FROM THE TAGS ACTUALLY PRESENT, and every one starts
                    ON. Tags are not an enum — machine names appear as tags — so
                    the default has to be everything, and a new tag from anywhere
                    becomes a filter without being registered anywhere. Inverting
                    this into a pick-these-tags filter would hide every line from
                    a machine nobody had thought of yet. */}
                <div className="chips">
                    {tags.map(function (t) {
                        return (
                            <button key={t.tag} className={'chip' + (off[t.tag] ? '' : ' on')}
                                onClick={function () {
                                    setOff(function (m) {
                                        var next = Object.assign({}, m);
                                        if (next[t.tag]) delete next[t.tag]; else next[t.tag] = true;
                                        return next;
                                    });
                                }}>
                                {t.tag}<b>{t.n}</b>
                            </button>
                        );
                    })}
                </div>

                <div className="console tall" ref={box}>
                    {view.length
                        ? view.map(function (e) { return <Line key={e.id} e={e} />; })
                        //THREE EMPTY CONSOLES THAT LOOK IDENTICAL AND MEAN
                        //DIFFERENT THINGS: nothing has been said, everything
                        //said is filtered out, or the record itself just began.
                        //The counter above tells them apart in numbers; this
                        //says which in words.
                        : <Empty>{entries.length
                            ? 'nothing matches — ' + entries.length + ' lines are held and the filters hide all of them'
                            : 'the log is empty — nothing has been said since this dashboard started'}</Empty>}
                </div>

                {/* WHAT THIS IS AND WHAT IT IS NOT. The live log is in memory,
                    is lost on restart, and is not written to disk ON PURPOSE —
                    it carries sign-in URLs, tokens and whatever a worker
                    printed. It is also not the event stream: that keeps app acts
                    on an allowlist and never `out`, so the two are different
                    sets of lines. */}
                <Note>held in memory only and lost when the dashboard restarts — the durable record is the event stream, which is a different set of lines</Note>
            </Pane>
        );
    }

    //THE FULL CATALOGUE, AND THE CLAIM IS EXHAUSTIVENESS: nothing this server
    //can do exists without appearing here. Its own view rather than more rows in
    //the console, because it answers a different question — Live asks "what is
    //happening", this asks "does this server have a way to do X, and what does
    //it want".
    function Catalogue() {
        //ASKED ONCE, NOT ON A CADENCE. The table is fixed for the life of the
        //process it is read from, so polling it would be re-asking a
        //256-answer-wide question every few seconds for an answer that cannot
        //change. `okc.use` with no interval reads once and stops.
        var { state, error } = okc.use('actions', {}, 0);
        var [find, setFind] = useState('');

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.actions || [];
        var q = find.toLowerCase();
        var rows = !q ? all : all.filter(function (a) {
            return String(a.name).toLowerCase().indexOf(q) >= 0
                || String(a.about || '').toLowerCase().indexOf(q) >= 0;
        });
        var withArgs = all.filter(function (a) { return (a.takes || []).length; }).length;

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}
                <Panel>
                    <div className="card-title">
                        <Mono>{all.length + ' actions'}</Mono>
                        <Badge>{withArgs + ' take arguments'}</Badge>
                    </div>
                    {/* A FLAT LIST OF 256 ROWS IS WHAT THIS WAS, with no way to
                        reach one of them. The exhaustiveness is the point, so
                        nothing is grouped away or cut — but a box that narrows
                        what is drawn costs that claim nothing. */}
                    <input className="finder" value={find} placeholder="find an action"
                        onChange={function (ev) { setFind(ev.target.value); }} />
                    {rows.length
                        ? rows.map(function (a) {
                            return (
                                <div className="act" key={a.name}>
                                    <code>{a.name}</code>
                                    <span className="about">{a.about}</span>
                                    <span className="takes">{(a.takes || []).join(', ')}</span>
                                </div>
                            );
                        })
                        : <Empty>{'no action matches — all ' + all.length + ' of them are here'}</Empty>}
                </Panel>
            </Pane>
        );
    }

    //TWO VIEWS BEHIND ONE TAB, chosen here rather than folded into one list.
    //Sub-tabs are quieter than the top row on purpose: this picks which question
    //is being asked about one subject, where the bar above picks the subject.
    function Live() {
        var [on, setOn] = useState('Stream');
        return (<>
            <div className="subtabs">
                {['Stream', 'Actions'].map(function (n) {
                    return (
                        <button key={n} className={'subtab' + (n == on ? ' active' : '')}
                            onClick={function () { setOn(n); }}>{n}</button>
                    );
                })}
            </div>
            {on == 'Stream' ? <Log /> : <Catalogue />}
        </>);
    }

    //THREE THINGS THE OLD PANE DID THAT DELIBERATELY DO NOT COME ACROSS.
    //
    //  the tab badge. Over there arrivals were counted while the pane was
    //  hidden, and a `bad` line turned the count red until somebody visited.
    //  Here the shell mounts one tab at a time, so a hidden Live has no effects
    //  running and nothing to count with — the badge would have to live in the
    //  shell, watching the log on every tab's behalf, which is a change to a
    //  shared plugin rather than to this one. Left undone and said out loud
    //  rather than half-built.
    //
    //  the "am I actually receiving" dot. The topbar already has one, driven by
    //  `okc.onUp`, and it goes dull on disconnect and green again on reconnect
    //  on its own. A second one painted here once at startup would lie for the
    //  rest of the session.
    //
    //  the redraw kick. An arriving `vm` or `guest` line used to schedule a full
    //  window repaint, debounced 400ms, because the rest of the window learned
    //  from this stream that a machine had changed. Every tab asks its own
    //  question on its own cadence now, so Machines finds out by asking rather
    //  than by being told — and the debounce existed only to stop dozens of
    //  lines a second each re-asking VirtualBox for the whole machine list.
    shell.tab({ name: 'Live', order: 80, Component: Live });

    await register(null, {});
}
module.exports = plugin;
