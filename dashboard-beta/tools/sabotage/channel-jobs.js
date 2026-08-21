//what ../../test/vms/channel-jobs.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/channel/jobs.js',
    test: 'test/vms/channel-jobs.test.js',
    breaks: [
        //THE CREDENTIAL CASE. The log is drawn in the window, photographed by
        //`capture`, and handed out by `logSince`.
        ['a quiet command puts its output in the log anyway',
            "        if (!(job && job.quiet)) say('vm', vm, 'guest').out(text);",
            "        say('vm', vm, 'guest').out(text);"],

        ['quiet withholds the output from the caller as well',
            '        if (job) job.lines.push(text);',
            '        if (job && !job.quiet) job.lines.push(text);'],

        ['quiet is ignored entirely',
            'var quiet = !!o.quiet;',
            'var quiet = false;'],

        //It is the VALUE that must not be logged, never the act.
        ['the act of running it is hidden too',
            "        say('vm', name, 'channel').info('running on ' + name + ': ' + what);",
            "        if (!quiet) say('vm', name, 'channel').info('running on ' + name + ': ' + what);"],

        ['ordinary output is withheld from the log',
            "if (!(job && job.quiet)) say('vm', vm, 'guest').out(text);",
            ''],

        //A stray line is evidence.
        ['output for a job nobody is waiting on is thrown away',
            "        if (job) job.lines.push(text);\n        if (!(job && job.quiet)) say('vm', vm, 'guest').out(text);",
            "        if (!job) return false;\n        job.lines.push(text);\n        if (!job.quiet) say('vm', vm, 'guest').out(text);"],

        //Asking.
        ['a machine that is not dialled in is asked anyway',
            "        var agent = agentFor(name);\n        if (!agent) {",
            '        var agent = agentFor(name) || { write: function () {} };\n        if (false) {'],

        ['every job is given the same id, so two answers land on one',
            'var id = String(++seq);',
            "var id = '1';"],

        ['output is joined in whatever order it is asked for',
            "job.settle(null, { code: m.code, output: job.lines.join('\\n') });",
            "job.settle(null, { code: m.code, output: job.lines.slice().sort().join('\\n') });"],

        ['a non-zero code is turned into a failure of the channel',
            "        job.settle(null, { code: m.code, output: job.lines.join('\\n') });",
            "        if (m.code !== 0) job.settle(new Error('failed'));\n        else job.settle(null, { code: m.code, output: job.lines.join('\\n') });"],

        //A job that never settles is a promise nobody resolves and a machine
        //nobody puts away.
        ['a command that never finishes is waited on forever',
            '            var timer = after(timeout, function () {\n                delete open[id];',
            '            var timer = after(timeout, function () {\n                return;\n                delete open[id];'],

        ['the timeout is not the one that was asked for',
            'var timer = after(timeout, function () {',
            'var timer = after(GIVE_UP_AFTER, function () {'],

        ['a job that finished leaves its timer running',
            '                    cancel(timer);',
            ''],

        //A job whose machine has gone will never be answered.
        ['a machine that goes leaves its jobs waiting',
            '            job.settle(new Error(\'"\' + vm + \'" \' + why + \', so the command was not finished.\'));',
            ''],

        ['going takes every machine’s jobs, not only that one’s',
            "            if (open[id].vm !== vm) return;",
            ''],

        ['a job is abandoned but left on the list',
            '            delete open[id];\n            abandoned.push(id);',
            '            abandoned.push(id);']
    ]
};
