//what ../../test/vms/vbox-reading.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/vbox/reading.js',
    test: 'test/vms/vbox-reading.test.js',
    breaks: [
        ['a machine list is split on whitespace, losing any name with a space',
            "return /^\"(.*)\"\\s+\\{(.+)\\}$/.exec(l.trim());",
            "var p = l.trim().split(' '); return p.length === 2 ? [l, p[0].replace(/\"/g, ''), p[1].replace(/[{}]/g, '')] : null;"],

        ['a machinereadable value keeps its quotes',
            'var m = /^"?([^"=]+)"?="?(.*?)"?$/.exec(line.trim());',
            'var m = /^([^=]+)=(.*)$/.exec(line.trim());'],

        ['a machine that is not there throws instead of being missing',
            "catch (e) { return 'missing'; }",
            'catch (e) { throw e; }'],

        ['aborted no longer counts as off',
            "var OFF = ['poweroff', 'aborted', 'saved', 'aborted-saved'];",
            "var OFF = ['poweroff'];"],

        ['a machine deleted mid-wait is waited for anyway',
            "return OFF.indexOf(s) >= 0 || s === 'missing';",
            'return OFF.indexOf(s) >= 0;'],

        ['a wait has no deadline',
            'if (now() > deadline) return false;',
            ''],

        //THE ONE THAT COST A MACHINE. Powered off is not ready: VirtualBox holds
        //the session past poweroff and a disk operation issued into that window
        //is raced rather than refused.
        ['being off is taken as being ready',
            "if (session === 'Unlocked') return;",
            'return;'],

        ['a session that never unlocks waits for ever',
            'if (now() > deadline) {',
            'if (false) {'],

        ['an absent session field is taken as locked',
            "var session;\n            try { session = (await info(name)).SessionState || 'Unlocked'; }",
            "var session;\n            try { session = (await info(name)).SessionState || 'Locked'; }"],

        ['reads narrate, on a loop that runs every few seconds',
            "return names(await run(['list', 'vms'], { quiet: true }));",
            "return names(await run(['list', 'vms'], {}));"]
    ]
};
