//---------------------------------------------------------------------------
//the board and the queue, at a command line.
//
//`reads` IS THE COLUMN, NOT `state`. The board works out what is true from the
//branch rather than from what somebody last wrote down, and where the two
//disagree the branch wins — see ./server.js. Printing `state` here would put the
//weaker of two answers on the page.
//
//AND "done, nothing arrived" IS ITS OWN WORD for a reason: a done task that
//delivered nothing and a done task that delivered are the same state and
//opposite outcomes.
//
//`--json` STILL GIVES THE BRACES, and nothing here is computed or asked for.
//---------------------------------------------------------------------------

function fit(s, n) {
    var t = String(s == null ? '' : s);
    return (t.length > n ? t.slice(0, n - 2) + '…' : t).padEnd(n);
}

//HOW LONG AGO, SPELLED THE WAY ../core/cron/cli.js SPELLS IT — the queue IS one
//of that plugin's timers, so `okc crons` and `okc queueState` are two views of
//the same clock and should not describe it in two dialects.
//
//COPIED RATHER THAN SHARED, AND THAT IS THE CONVENTION HERE. No `cli.js` in this
//app requires anything: they are plain modules the walk in tools/okc.js loads one
//at a time, precisely so the command line can answer with no plugin graph behind
//it. Reaching into another plugin's printer would be the first exception, to
//borrow six lines of arithmetic. What must not be duplicated is a DECISION, and
//"seconds are smaller than minutes" is not one.
function ago(at) {
    if (!at) return null;
    var then = Date.parse(at);
    if (!then) return String(at);

    var s = Math.round(Math.max(0, Date.now() - then) / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.round(m / 60) + 'h ago';
}

module.exports = {
    print: {
        tasks: function (said) {
            var all = said.tasks || [];
            if (!all.length) {
                //THE EMPTY BOARD SAYS WHY IT IS EMPTY. This app's tasks are its
                //own, and "no task has been written" reads as data loss to
                //anybody who has some in the dashboard being ported from.
                return '  no task has been written here yet — this board reads this app’s own tasks,\n'
                    + '  which start empty and are separate from the dashboard being ported from';
            }

            var out = [];
            all.forEach(function (t) {
                out.push('  ' + fit('#' + t.number, 6) + fit(t.reads, 24) + t.title);
                out.push('      ' + fit(t.branch, 30)
                    + (t.worker ? t.worker + '  ' : '')
                    + (t.machine ? 'on ' + t.machine : ''));
                //WHAT IT DELIVERED, when there is anything to say. `delivered`
                //is about the BRANCH and stays true from the run before, which
                //is why `reads` above is the one to trust.
                if (t.artifact) out.push('      ' + t.artifact);
            });

            out.push('');
            out.push('  ' + all.length + ' task' + (all.length === 1 ? '' : 's'));
            return out.join('\n');
        },

        queueState: function (said) {
            var out = [];

            //WHOSE CLOCK IS RUNNING, AND WHETHER IT IS — two different facts,
            //and this host can own the tick and have it switched off.
            //
            //`startedBy` IS `{by, at}` AND NOT A NAME, which this printed as
            //`[object Object]` for as long as it has existed. ./server.js builds
            //it from `clock.since()`, which answers both halves — WHO started the
            //queue and WHEN — because "it is running" and "somebody started it
            //eight hours ago and went home" are the same word and different
            //situations.
            //
            //IT LOOKED LIKE A NAME, WHICH IS WHY IT SURVIVED. ../core/cron's own
            //`job.startedBy` IS a plain string; this field borrowed the name and
            //not the shape, and string concatenation has no undefined-name error
            //to catch that with — the same class of quiet failure as a misspelt
            //CSS class, in the one place nobody photographs.
            var startedBy = said.startedBy || null;
            var startedWhen = startedBy && ago(startedBy.at);
            out.push('  ' + (said.ticking ? 'running' : 'stopped')
                + (startedBy && startedBy.by
                    ? ' — started by ' + startedBy.by + (startedWhen ? ', ' + startedWhen : '')
                    : '')
                //`every` ALREADY READS AS A SENTENCE — "15s" — because the
                //action worked it out from the clock rather than from a number
                //written twice. Reformatting it here would be the second copy.
                + (said.every ? '   every ' + said.every : ''));

            //AND WHOSE CLOCK IT IS. This host can be reading a board the other
            //app is running, which is a different thing from running it.
            if (said.tickHere === false) {
                out.push('  the tick is the other dashboard’s — this host is reading, not dispatching');
            }

            //A QUEUE THAT CANNOT BE READ IS NOT AN EMPTY QUEUE, and that has to
            //reach the page before anything else does. "The host is keeping up"
            //and "I cannot see the work" are opposite reports.
            if (said.unreachable && said.unreachable.length) {
                out.push('  COULD NOT READ: ' + said.unreachable.join(', ')
                    + ' — what is below is not the whole picture');
            }

            out.push('');
            var waiting = said.waiting || [];
            if (!waiting.length) out.push('  nothing waiting');
            else {
                waiting.forEach(function (w) {
                    out.push('  ' + fit(w.ref, 8) + fit(w.kind, 11) + (w.title || w.on || ''));
                });
            }

            var flying = said.inFlight || [];
            if (flying.length) {
                out.push('');
                out.push('  running now:');
                flying.forEach(function (r) {
                    out.push('    ' + fit(r.machine, 16) + (r.task || r.doing || ''));
                });
            }

            //WHAT WOULD GO WHERE, IF THE TICK WERE ON. The deciding, answerable
            //without the acting.
            var plan = said.plan || {};
            if ((plan.next || []).length) {
                out.push('');
                out.push('  next tick would send:');
                plan.next.forEach(function (d) {
                    out.push('    ' + fit(d.ref, 8) + '-> ' + d.machine);
                });
            }
            if ((plan.waiting || []).length) {
                out.push('');
                plan.waiting.forEach(function (w) {
                    out.push('    ' + fit(w.ref, 8) + w.why);
                });
            }

            var pool = said.machines || [];
            if (pool.length) {
                out.push('');
                out.push('  ' + pool.filter(function (m) { return m.free; }).length + ' of '
                    + pool.length + ' machine(s) free');
            }

            if (plan.signInCheck === false) {
                out.push('');
                out.push('  ' + plan.about);
            }
            return out.join('\n');
        },

        taskFiles: function (said) {
            //TWO QUESTIONS, ONE ACTION. Without an id it is "what is on this
            //host in total", including what belongs to tasks the board has
            //forgotten — which is the half worth having a word for.
            if (said.tasks) {
                var rows = said.tasks || [];
                if (!rows.length) return '  nothing has been handed over';

                var out = rows.map(function (a) {
                    return '  ' + fit(a.number ? '#' + a.number : '(gone)', 8)
                        + fit(a.files + ' file' + (a.files === 1 ? '' : 's'), 10)
                        + fit(Math.round((a.bytes || 0) / 1024) + ' KB', 10)
                        + (a.title || a.uid) + (a.orphaned ? '   — no task points at this any more' : '');
                });
                out.push('');
                out.push('  ' + said.where);
                return out.join('\n');
            }

            var files = said.files || [];
            if (!files.length) return '  ' + said.note;

            var lines = files.map(function (f) {
                return '  ' + fit(f.name || f.file, 30)
                    + fit(Math.round((f.bytes || 0) / 1024) + ' KB', 10)
                    + (f.run ? 'from ' + f.run : '');
            });
            lines.push('');
            lines.push('  ' + said.note);
            return lines.join('\n');
        }
    }
};
