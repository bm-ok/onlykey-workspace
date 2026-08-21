//what ./vbox-gate.test.js has to be able to catch. See ../../tools/sabotage.js.
module.exports = {
    file: 'src/app/vms/vbox/gate.js',
    test: 'test/vms/vbox-gate.test.js',
    breaks: [
        ['calls no longer go one at a time',
            'var mine = chain.then(function () {',
            'var mine = Promise.resolve().then(function () {'],

        ['a failure stops the queue',
            'chain = mine.then(function () {}, function () {});',
            'chain = mine;'],

        ['identical reads are not shared',
            "return asked.get(args.join(' '), function () { return queued(args, how); });",
            'return queued(args, how);'],

        ['a write leaves every remembered answer standing',
            'function (v) { if (asked) asked.empty(); return v; },',
            'function (v) { return v; },'],

        ['a startvm counts as a read',
            "return a[0] === 'list'",
            "return true || a[0] === 'list'"],

        ['a snapshot list counts as a write',
            "|| (a[0] === 'snapshot' && a[2] === 'list');",
            ';'],

        ['anything that fails is retried, not only a session lock',
            'if (!locked || i === attempts) throw err;',
            'if (i === attempts) throw err;'],

        ['a session lock is not retried at all',
            'if (!locked || i === attempts) throw err;',
            'throw err;'],

        ['it never says it is slow',
            'if (held > SLOW && (lastSlow === null || now() - lastSlow > QUIET_FOR)) {',
            'if (false) {'],

        ['it says it is slow every single time',
            'if (held > SLOW && (lastSlow === null || now() - lastSlow > QUIET_FOR)) {',
            'if (held > SLOW) {'],

        //THE ONE THE PORT ITSELF GOT WRONG. Zero works only because a real clock
        //is an epoch and every number is already past the quiet window; against
        //any other clock the FIRST warning is silently swallowed — the one that
        //says the service has started struggling.
        ['the first slow call is silently swallowed',
            'var lastSlow = null;',
            'var lastSlow = 0;']
    ]
};
