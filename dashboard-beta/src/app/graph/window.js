var React = require('react');
var { useState } = React;
var useAsk = require('../okc/ask');

//the Graph tab: one renderer, two pictures.
//
//BOTH TABS ARE THE SAME PICTURE — a row of cards laid left to right in the
//order things happened, with wires between them. Repositories -> Graph asks
//"what has actually happened to the branches in this workspace"; Supervisor ->
//What it did asks "in its last turn, what did it reach for, and what was it
//told no about". The shapes are identical because the answer is: nodes with a
//column, a row and up to four lines, and explicit {from,to} links.
//
//THE PORT DROPS LITEGRAPH. Everything the old ui/graph.js fought for comes free
//with DOM cards: no zero-width canvas inside a hidden pane, no
//startRendering/stopRendering bookkeeping, no wheel handler patched onto a
//prototype before any canvas exists, no gutting of an editor's right-click
//menu, no 34-character title slice, and a rebuild no longer throws away your
//pan. It is also why a title is not truncated here — a card wraps.
//
//IT IS READ-ONLY, AND THAT IS A DECISION RATHER THAN AN OMISSION. Over there
//the editor affordances — add, remove, clone, rewire, the play button — were
//all deliberately switched off so this could not become a second place work
//starts, beside the queue, with its own idea of the rules. Nothing here may
//grow a button that starts or changes anything. The only interaction is "take
//me to it".
//
//AND IT COMPUTES NO FACTS OF ITS OWN. Everything drawn is in the answer:
//nodes, links, a note, a why. See actions/graphs.js — the join of five tables
//is the whole value, and a second version of it here would go stale on its own.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./graph.scss.
    require('./graph.scss');
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

    //TONES ARRIVE AS RAW HEX AND MAP ONTO THE STYLESHEET'S OWN VARS, so a
    //colour changed in dashboard.scss changes here with it. #f778ba — the pink
    //for a change that came from outside — has no var, and is left inline
    //rather than snapped to the nearest one that does exist: it means
    //"somebody else's", which is not warn, not accent and not running.
    var TONE = {
        '#7d8998': 'var(--muted)',
        '#3fb950': 'var(--ok)',
        '#f85149': 'var(--fail)',
        '#d29922': 'var(--warn)',
        '#4aa3ff': 'var(--accent)',
        '#a371f7': 'var(--running)'
    };

    //A LINE WITH NO TONE IS DEFAULT ON PURPOSE. The server decides what is
    //coloured; re-deriving a tone from the words is how a picture starts
    //stating things nothing recorded.
    function colour(hex) {
        if (!hex) return null;
        return TONE[String(hex).toLowerCase()] || hex;
    }

    //WHAT A CARD IS, SAID IN COLOUR: identity, not judgement. Only `refused`
    //gets an alarm colour and it earns it — the refusals are the point of the
    //turn picture, the moments a model tried something it may not do. A verdict
    //has its own line on the judgement card and is deliberately not repeated in
    //the dot, where "rejected" and "a judgement happened" would wear one red.
    var KIND = {
        branch: 'var(--accent)',
        //A `pull` SUBJECT IS NOT A BRANCH. It is somebody else's fork, not in
        //this workspace, and it was drawn as a branch once and read as one.
        //Different colour, different card kind, different destination.
        pull: '#f778ba',
        task: 'var(--text)',
        machine: 'var(--running)',
        judgement: 'var(--muted)',
        woke: 'var(--accent)',
        //`read` DOES NOT MEAN "IT READ SOMETHING" — it means a call that got
        //through, and its body line is the allowlist's own description of that
        //action. An earlier attempt to sort calls into read and wrote by name
        //was wrong in the first turn it was pointed at.
        read: 'var(--muted)',
        refused: 'var(--fail)',
        said: 'var(--text)'
    };

    function where(w) {
        return [w.view, w.pane, w.pick].filter(Boolean).join(' / ');
    }

    function Node({ n, on, onPick }) {
        return (
            <div className={'card' + (n.where ? ' pick' : '') + (on ? ' on' : '')}
                onClick={n.where ? onPick : undefined}>
                <div className="card-title">
                    <span className="dot" style={{ background: KIND[n.kind] || 'var(--muted)' }} />
                    <span className="grow">{n.title}</span>
                    <Badge kind={n.kind == 'refused' ? 'bad' : ''}>{n.kind}</Badge>
                </div>
                {/* EVERY LINE, INCLUDING THE FOURTH. An earlier slice(0, 3) ate
                    the timestamp footer and left a timeline whose axis could not
                    be read. */}
                {(n.lines || []).map(function (l, i) {
                    var c = colour(l.tone);
                    return <div className="card-sub" key={i} style={c ? { color: c } : undefined}>{l.text}</div>;
                })}
                {/* WHERE IT REALLY LIVES. Every node carries {view, pane, pick}
                    — the same shape core/inbox.js uses — and the old right-click
                    menu threw the `pick` away and called showPane(pane, view),
                    which lands somebody on Branches Cut with thirty cards and
                    none of them selected. This shell has no cross-tab
                    navigation to hand yet, so the address is shown rather than
                    followed; when it grows one this becomes a single call and
                    the pick is already here. A node with no `where` is not
                    clickable at all, rather than clickable and dead. */}
                {on && n.where ? <div className="card-sub"><Mono>{where(n.where)}</Mono></div> : null}
            </div>
        );
    }

    //ROWS AND COLUMNS ARE THE SERVER'S AND ARE NOT RE-DERIVED HERE.
    //
    //A column means WHEN, not WHAT. An earlier version of the data gave each
    //kind a fixed column — branch 0, task 1, machine 2, judgement 3 — and a
    //story missing a step drew a wire across two empty columns, saying "three
    //steps are missing" when there had only ever been two. So a machine sits at
    //column 2 in one row and column 3 in another, and that is correct.
    //
    //The row order is the server's too: in flight first, then most recently
    //touched. Re-sorting here would rearrange the picture under somebody who is
    //in the middle of reading it.
    function rowsOf(nodes) {
        var by = [];
        (nodes || []).forEach(function (n) {
            var r = n.row || 0;
            if (!by[r]) by[r] = [];
            by[r].push(n);
        });
        return by.filter(Boolean).map(function (row) {
            return row.slice().sort(function (a, b) { return a.column - b.column; });
        });
    }

    function Picture({ nodes, links, picked, onPick }) {
        var rows = rowsOf(nodes);

        //THE WIRES, BY THE PAIR THEY NAME. Being beside each other is not the
        //same claim as being joined, so the gap between two cards that merely
        //share a row stays blank.
        var joins = {};
        var into = {};
        (links || []).forEach(function (l) {
            joins[l.from + '>' + l.to] = true;
            into[l.to] = l.from;
        });

        return (
            <div className="stack">
                {rows.map(function (row, r) {
                    var here = {};
                    row.forEach(function (n) { here[n.id] = true; });
                    //A TURN IS LONGER THAN A SCREEN and wraps every four cards,
                    //so the first card of a row can be wired to the last card of
                    //the row above. The sequence turns the corner rather than
                    //stopping there.
                    var carried = row.length && into[row[0].id] && !here[into[row[0].id]];
                    return (
                        <div className="cols" key={r}>
                            {carried ? <div className="muted mono">{'↳'}</div> : null}
                            {row.map(function (n, i) {
                                var wired = i && joins[row[i - 1].id + '>' + n.id];
                                return (
                                    <React.Fragment key={n.id}>
                                        {i ? <div className="muted mono">{wired ? '→' : ''}</div> : null}
                                        <div className="col">
                                            <Node n={n} on={picked == n.id}
                                                onPick={function () { onPick(picked == n.id ? null : n.id); }} />
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    }

    //ONE BOARD, ASKED A DIFFERENT QUESTION. Only the sub-tab showing is
    //mounted, so only one of them is asking — the DOM version of the paint
    //guard the old pane had to write twice, once before the call and once again
    //after it resolved, because a person can be two tabs away by the time an
    //answer arrives. React's reconciliation is the other half: identical text
    //is not rewritten, so a redraw does not destroy a selection mid-copy.
    function Board({ action, caution }) {
        var { state, error, reads } = useAsk(okc, action, {}, 5000);
        var [picked, setPicked] = useState(null);

        //THREE EMPTY STATES, THREE DIFFERENT ANSWERS, and the old pane funnelled
        //two of them into one grey "nothing to draw" card:
        //
        //  (a) nodes:[] with a `why` — a real answer about a real workspace
        //  (b) refused BY NAME because no workspace is open, which is not
        //      "nothing happened" but "that question is about something that is
        //      not open"
        //  (c) the call threw
        //
        //None of them may render as a blank area: a pane that has not loaded and
        //a pane whose answer is "none" look identical, and one of them is an
        //answer.
        var shut = error && /^No workspace is open/.test(error);

        if (!state && error) return <Note kind={shut ? 'warn' : 'bad'}>{error}</Note>;
        if (!state) return <Empty>asking…</Empty>;

        var nodes = state.nodes || [];
        return (<>
            {/* the error sits above the last good picture rather than replacing
                it — "I could not ask" is not "there is nothing" */}
            {error ? <Note kind={shut ? 'warn' : 'bad'}>{error}</Note> : null}

            {nodes.length
                ? <Picture nodes={nodes} links={state.links} picked={picked} onPick={setPicked} />
                : <>
                    <Empty>{state.why || 'it drew nothing and did not say why'}</Empty>
                    {caution ? <Note kind="warn">{caution}</Note> : null}
                </>}

            {/* `note` AND `why` ARE NOT THE SAME FIELD. `why` only exists when
                the picture is empty; `note` captions one that exists, and it is
                where the truncation is admitted — "8 branches, none in flight —
                1 older not drawn". Dropped, the pane lies quietly about how much
                work there is. */}
            {state.note ? <Note>{state.note}</Note> : null}
            <Note>{'read ' + reads + ' time(s), every 5s'
                + (nodes.length ? ' · ' + nodes.length + ' cards, ' + (state.links || []).length + ' wires' : '')}</Note>
        </>);
    }

    //THE CHIP IS ITS OWN COMPONENT so the class name is the only string in the
    //className — a comparison literal beside it reads as a class to the check
    //that proves every class exists, and a class that does not exist renders as
    //nothing.
    function Chip({ on, pick, children }) {
        return <button className={'chip' + (on ? ' on' : '')} onClick={pick}>{children}</button>;
    }

    function Graph() {
        var [on, setOn] = useState('work');

        return (
            <Pane>
                {/* TWO QUESTIONS, ONE RENDERER. Chips rather than a second row of
                    tabs, because this chooses which subject the picture is about
                    rather than which part of the app you are in. */}
                <div className="chips">
                    <Chip on={on == 'work'} pick={function () { setOn('work'); }}>what happened to the branches</Chip>
                    <Chip on={on == 'turn'} pick={function () { setOn('turn'); }}>what the supervisor did</Chip>
                </div>
                <Panel>
                    <div className="titlerow">
                        <div className="card-title">{on == 'work' ? 'Branches, end to end' : 'The last turn'}</div>
                        <span className="grow" />
                        <span className="muted">{on == 'work'
                            ? 'a branch, the task cut from it, the machine, the judgement, the pull request'
                            : 'read back out of the event stream, not recorded separately'}</span>
                    </div>
                    {on == 'work'
                        ? <Board action="workGraph" />
                        : <Board action="turnGraph"
                            //A LIVE BUG THIS INHERITS AND MUST NOT PAPER OVER.
                            //turnGraph finds the turn boundary by searching back
                            //for "waking it" through events.all(), which keeps
                            //the last 200 lines — so a turn whose waking has
                            //aged out of that window answers "it has not been
                            //woken since this log begins" while three calls and
                            //an answer from that same turn are still inside it.
                            //The empty state is a false negative and its wording
                            //is misleading. The fix belongs in
                            //actions/graphs.js — search with `since`, or raise
                            //the limit for this one query — and until it lands
                            //this pane says so rather than letting somebody read
                            //it as "the supervisor has done nothing".
                            caution={'that may be the log window rather than the supervisor: the turn boundary is found by searching back through the last 200 events, so a waking older than those has aged out while the calls that followed it are still there. Not evidence that nothing ran.'} />}
                </Panel>
            </Pane>
        );
    }

    //---- where this lives, and it is not a choice -------------------------
    //
    //THE TAB NAMES ARE THE STRUCTURE. This port had been inventing its own —
    //top-level tabs for Machines, Sessions, Sign-ins and Graph, none of which
    //exist in the app being ported from, and renamed panes elsewhere. An
    //information architecture that drifts is one that has to be re-learned by
    //anybody who knows the old window, which is everybody who would use this.
    //
    //The real map is in ui/index.html over there: twelve panes under
    //Repositories, six under Runners, and the tab names as written.
    shell.pane({ tab: 'Repositories', name: 'Graph', order: 120, Component: Graph });

    await register(null, {});
}
module.exports = plugin;
