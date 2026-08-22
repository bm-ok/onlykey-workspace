//how the clock reads at the command line.
//
//THE SAME QUESTION THE PANE ANSWERS, in one screen of text: what runs on its
//own, whether it is on, and whether it has been failing. A JSON dump of this is
//twenty lines per job and the interesting part — "last ran 4m ago and threw" —
//is somewhere in the middle of it.

function forHowLong(ms) {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return Math.max(1, Math.round(ms)) + 'ms';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm';
    return Math.round(m / 60) + 'h';
}

function ago(at) {
    if (!at) return 'never';
    var then = Date.parse(at);
    if (!then) return String(at);
    return forHowLong(Math.max(0, Date.now() - then)) + ' ago';
}

module.exports = {
    print: {
        crons: function (said) {
            var jobs = (said && said.jobs) || [];
            if (!jobs.length) return 'Nothing is scheduled on this host.';

            var out = ['what this host does on its own — one timer, looking every '
                + forHowLong(said.beat), ''];

            jobs.forEach(function (job) {
                //THE STATE FIRST, because it is the reason somebody ran this.
                var state = job.running ? 'running' : 'stopped';
                if (!job.armed) state += ', nothing behind it';
                if (job.inFlight) state += ', in flight now';

                out.push('  ' + job.name + '  (' + state + ')');
                if (job.about) out.push('      ' + job.about);

                out.push('      every ' + forHowLong(job.every)
                    + (job.running ? ', next in ' + forHowLong(job.dueIn) : '')
                    + '   ' + job.runs + ' run' + (job.runs === 1 ? '' : 's')
                    + (job.failures ? ', ' + job.failures + ' FAILED' : ''));

                if (job.last) {
                    out.push('      last: ' + ago(job.last.at) + ', took ' + forHowLong(job.last.ms)
                        + ' — ' + (job.last.ok ? 'fine' : 'FAILED: ' + (job.last.said || 'it said nothing')));
                }
                if (job.since) out.push('      started by ' + job.since.by + ', ' + ago(job.since.at));

                //SAID HERE TOO, so a refusal at the command line is not the first
                //time anybody hears about it.
                if (job.humanOnly) out.push('      only a person may work this switch');

                out.push('');
            });

            //THE EDGE, NAMED. A board claiming to be everything while four panes
            //quietly poll on their own is worse than one that says where it stops.
            out.push('this is the node half only — a pane that refreshes while you look at it is not here.');
            return out.join('\n');
        },

        cronStart: function (said) {
            return said.wasAlready
                ? said.name + ' was already running.'
                : said.name + ' is running.';
        },

        cronStop: function (said) {
            return said.wasAlready
                ? said.name + ' was not running.'
                : said.name + ' is stopped. Anything already in flight is not interrupted.';
        },

        cronRun: function (said) {
            if (!said.ran) {
                //`ran: false` IS NOT A FAILURE, and the two want opposite things
                //done about them: one is "look at the error", the other is
                //"there is nothing registered, or it is already going".
                return said.name + ' did not run — it is either already in flight, or nothing '
                    + 'is registered to do it.';
            }
            var last = (said.job || {}).last || {};
            return said.name + (said.ok ? ' ran' : ' ran and FAILED')
                + (last.ms !== undefined ? ' in ' + forHowLong(last.ms) : '')
                + (said.ok ? '.' : ': ' + (last.said || 'it said nothing'));
        }
    }
};
