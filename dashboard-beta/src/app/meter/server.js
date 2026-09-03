var makeLedger = require('./ledger');

//---------------------------------------------------------------------------
//WHAT HAS BEEN SPENT, AND ON WHOSE SIGN-IN.
//
//See ./ledger.js for what a row is and why it is kept per key rather than as one
//number. This is the plugin around it: who may write to it, who reads it, and
//the one action both panes ask.
//
//---- it is its own plugin because it has two readers ----------------------
//
//It was ../queue/meter.js, and that file said in its own header that the day a
//second reader appeared it would move — "a spending record read by two panes is
//a shared system and belongs to neither". The Runners → Meter pane is that
//second reader. So the move happened because the condition was met, and the
//queue consumes this now instead of building it.
//
//WHY NOT core/. core is what this app is built OUT of — the window, the action
//table, the log, storage. A spending record is a thing this app is ABOUT. The
//test for core is not "more than one plugin needs it".
//
//---- who may write to it ---------------------------------------------------
//
//`record` IS ON THE SERVICE AND THERE IS NO ACTION FOR IT. Writing a row is
//something that happens at the moment a run's numbers exist and nowhere else —
//../queue/metering.js reads them off the machine before it is rolled back, which
//is the only window in which they exist at all. An action would be a way for
//anything, including a model over the supervisor's door, to write into a
//spending record. There is no reason for that to be reachable and one obvious
//reason for it not to be.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'state', 'guests'];
plugin.provides = ['meter'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;

    //---- THE WORKSPACE'S DRAWER, NOT THE HOST'S ---------------------------
    //
    //IT WAS `dataDir.at('meter.json')`, in the app's own folder, and that made
    //spend a fact about this INSTALLATION. One ledger counted every workspace
    //together: open a different folder and the same running total came with it.
    //
    //WHAT IS ACTUALLY BEING MEASURED IS A PROJECT. The runs are this workspace's
    //tasks and judgements, on this workspace's machines, under jobs from this
    //workspace's library — everything either side of the number is per folder,
    //and the number was not. It also meant the pane could not answer the question
    //anybody asks of it, which is what THIS project has cost.
    //
    //THE FILE IT HELD PROVED THE POINT: seventeen runs across two workspaces in
    //one total, twelve of them on a machine that is not in this one's register.
    //
    //A THUNK, for the reason every other store here takes one: asking where to
    //write while the graph is being built turns "no workspace yet" into a
    //startup failure. `here.now` is the synchronous door -- ./ledger.js reads and
    //writes with `fs` and cannot await -- and it refuses when nothing is open,
    //which ./ledger.js already swallows on both sides.
    var ledger = makeLedger({ file: function () { return imports.state.here.now('meter').path; } });

    var undo = [];

    if (actions) {
        undo.push(actions.define('meter', {
            about: 'What every sign-in has spent: runs, turns, tokens and cost, per key and in total',
            takes: ['key', 'kind', 'limit'],
            run: function (args) {
                var a = args || {};
                var everything = ledger.read();

                //NARROWED FOR THE ROWS, NEVER FOR THE TOTALS. Filtering both
                //would give a screen where the number at the top changes when you
                //click a column — and a total is the answer to "how much
                //altogether", of which there is exactly one.
                var wanted = everything.filter(function (r) {
                    return (!a.key || String(r.key || '') === String(a.key))
                        && (!a.kind || String(r.kind) === String(a.kind));
                });

                var limit = Math.max(1, Math.min(1000, Number(a.limit) || 100));
                var rows = wanted.slice()
                    .sort(function (x, y) { return String(y.at).localeCompare(String(x.at)); })
                    .slice(0, limit);

                //EVERY SIGN-IN THIS HOST HOLDS, not only the ones that have spent
                //something. A key with no runs against it is a real and useful
                //answer — it is the difference between "it has not been used" and
                //"it is not here", and those look identical in a list built from
                //the spending alone.
                var spent = ledger.byKey(everything);
                var known = [];
                try { known = (imports.guests.all() || []).map(function (g) { return g.name; }); }
                catch (e) { /* no store yet, so the rows below are all there is */ }

                var perKey = spent.concat(known
                    .filter(function (name) {
                        return !spent.some(function (x) { return x.key === name; });
                    })
                    .map(function (name) {
                        return Object.assign({ key: name }, makeLedger.tallyOf([]));
                    }));

                return {
                    rows: rows,
                    showing: rows.length,
                    of: wanted.length,
                    keys: perKey,
                    //THE TOTAL IS OF EVERYTHING, and says so.
                    total: Object.assign({}, ledger.total(everything), {
                        kept: everything.length,
                        most: ledger.MOST_ROWS
                    }),
                    where: ledger.where(),
                    note: everything.length
                        ? (everything.length >= ledger.MOST_ROWS
                            ? 'The oldest rows are dropped past ' + ledger.MOST_ROWS + ', so the total is '
                                + 'of what is kept rather than of all time.'
                            : null)
                        : 'Nothing has been metered yet. A supervisor waking and a worker run each record '
                            + 'one row when they finish.'
                };
            }
        }));
    }

    await register(null, {
        meter: {
            //WRITTEN BY THE QUEUE, at the one moment the numbers exist.
            record: ledger.record,

            //AND READ BY WHOEVER ASKS. `clear` is deliberately not an action:
            //emptying a spending record is not something to do from a command
            //line by accident, and nothing in the window offers it.
            read: ledger.read,
            all: ledger.all,
            byKey: ledger.byKey,
            total: ledger.total,
            clear: ledger.clear,
            where: ledger.where,
            MOST_ROWS: ledger.MOST_ROWS
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
