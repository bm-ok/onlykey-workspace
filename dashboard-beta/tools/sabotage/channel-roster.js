//what ../../test/vms/channel-roster.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/channel/roster.js',
    test: 'test/vms/channel-roster.test.js',
    breaks: [
        //NOTHING IS ACCEPTED BEFORE A VALID HELLO.
        ['a socket may say anything before it says hello',
            "if (m.type !== 'hello') return { fault: 'said something before hello' };",
            ''],

        ['any token at all gets a machine in',
            "        if (!sameToken(m.token, expected)) {\n            return { fault: 'claimed to be \"' + m.vm + '\" without the right token' };\n        }",
            ''],

        ['a machine this app never made can dial in by sending no token',
            'if (given.length !== expected.length || !expected.length) return false;',
            'if (given.length !== expected.length) return false;'],

        ['a token is compared with ===, which leaks how much of a guess was right',
            "    if (given.length !== expected.length || !expected.length) return false;\n    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));",
            '    return given === expected;'],

        ['a token that merely starts the same is accepted',
            '    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));',
            '    return expected.indexOf(given.slice(0, 4)) === 0;'],

        //THE SOCKET'S FAR END, NOT WHAT THE MACHINE SAYS ABOUT ITSELF.
        ['the address a machine claims is believed over where it dialled from',
            "onHello(vm, { address: addressOf(s.from), user: (m.facts || {}).user || null });",
            "onHello(vm, { address: (m.facts || {}).address || addressOf(s.from), user: (m.facts || {}).user || null });"],

        ['an address arriving over a v6 socket keeps its prefix',
            "        .replace(/^::ffff:/, '')   //an IPv4 address arriving over a v6 socket",
            '        '],

        ['the far end port is treated as part of the address',
            "        .replace(/:\\d+$/, '');     //the far end's port, which is nobody's address",
            "        ;"],

        //It took adding something below it and watching that not run.
        ['a handler that throws on arrival is swallowed silently',
            "                say('vm', vm, 'channel').warn('something went wrong handling its arrival: ' + e.message);",
            ''],

        ['a handler that throws takes the session down with it',
            '            try {\n                onHello(vm, { address: addressOf(s.from), user: (m.facts || {}).user || null });\n            } catch (e) {',
            '            if (true) {\n                onHello(vm, { address: addressOf(s.from), user: (m.facts || {}).user || null });\n            } else if (false) { var e = null;'],

        //A machine rebooting is the ordinary case, not the exception.
        ['a machine reconnecting after a reboot is refused as a duplicate',
            "        var had = agents[vm];\n        if (had && had.write !== s.write) drop(vm, 'was replaced by a new connection');",
            "        if (agents[vm]) return { fault: 'is already dialled in' };"],

        ['the old connection is abandoned rather than closed and answered',
            "if (had && had.write !== s.write) drop(vm, 'was replaced by a new connection');",
            ''],

        //A one-way heartbeat proves nothing.
        ['a beat is not answered, so a machine that lost its network never redials',
            "        try { agent.write({ type: 'beat' }); } catch (e) { /* it is going anyway */ }",
            ''],

        //It is FALSE when a machine first connects and becomes true later.
        ['a desktop appearing is only noticed at hello',
            "        if (typeof m.desktop === 'boolean' && agent.facts.desktop !== m.desktop) {",
            '        if (false) {'],

        ['every beat says something about the desktop',
            "if (typeof m.desktop === 'boolean' && agent.facts.desktop !== m.desktop) {",
            "if (typeof m.desktop === 'boolean') {"],

        ['what a machine is using is announced on every beat',
            "        if (typeof m.memoryUsedMB === 'number') {\n            agent.facts.memoryUsedMB = m.memoryUsedMB;",
            "        if (typeof m.memoryUsedMB === 'number') {\n            say('vm', vm, 'guest').info('using ' + m.memoryUsedMB + 'MB');\n            agent.facts.memoryUsedMB = m.memoryUsedMB;"],

        ['what a machine is using is not recorded at all',
            'agent.facts.memoryUsedMB = m.memoryUsedMB;',
            ''],

        //TCP will not notice a machine killed mid-sentence.
        ['a machine that says nothing is never treated as gone',
            '            if (quiet > silentTooLong) {',
            '            if (false) {'],

        ['a machine that is merely slow is thrown away',
            'if (quiet > silentTooLong) {',
            'if (quiet > 0) {'],

        ['a sign of life other than a beat does not count',
            '        var agent = agents[vm];\n        if (agent) agent.lastSeen = now();\n        return !!agent;',
            '        return !!agents[vm];'],

        //A job whose machine has gone will never be answered.
        ['nobody is told when a machine goes',
            '        try { onGone(name, why); } catch (e) { /* said below */ }',
            ''],

        ['dropping the same machine twice tells everyone twice',
            '        var agent = agents[name];\n        if (!agent) return false;',
            '        var agent = agents[name] || {};'],

        ['the socket of a dropped machine is left open',
            '        try { agent.close(); } catch (e) { /* already gone */ }',
            ''],

        ['shutting down forgets the machines without telling anyone',
            "        Object.keys(agents).forEach(function (name) { drop(name, why || 'this host is shutting down'); });",
            '        agents = {};'],

        //`capture` writes the whole rendered DOM to a file with no redaction.
        ['the list carries the socket a card would draw',
            '                facts: agents[name].facts\n            };',
            '                facts: agents[name].facts,\n                write: agents[name].write\n            };']
    ]
};
