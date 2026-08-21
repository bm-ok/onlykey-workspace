//what ../../test/vms/channel-session.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/channel/session.js',
    test: 'test/vms/channel-session.test.js',
    breaks: [
        //A wiring mistake here passes every test the three halves have.
        ['an unauthenticated socket is handled as though it had said hello',
            '            if (!vm) {',
            '            if (false) {'],

        ['a refused hello is let through anyway',
            '                if (said.fault) return goodbye(said.fault);',
            ''],

        ['a machine is never told it is in',
            "                write({ type: 'hi' });",
            ''],

        //A guest that is simply cut off cannot tell being refused from the
        //network breaking, and the two want different things done about them.
        ['a refused guest is cut off without being told why',
            "    function goodbye(why) {\n        say('channel').warn(from + ': ' + why);\n        write({ type: 'bye', why: why });\n        socket.destroy();\n    }",
            "    function goodbye(why) {\n        say('channel').warn(from + ': ' + why);\n        socket.destroy();\n    }"],

        ['a socket that sent rubbish is left open',
            '        if (got.fault) return goodbye(got.fault);',
            ''],

        //TCP gives you bytes.
        ['a chunk is treated as one message',
            '        for (var i = 0; i < got.messages.length; i++) {',
            '        for (var i = 0; i < Math.min(1, got.messages.length); i++) {'],

        //Everything about what to run lives on this side.
        ['what comes back is filed under the wrong half',
            "        if (msg.type === 'out') return jobs.out(vm, msg);\n        if (msg.type === 'done') return jobs.done(vm, msg);",
            "        if (msg.type === 'done') return jobs.out(vm, msg);\n        if (msg.type === 'out') return jobs.done(vm, msg);"],

        ['a beat is not passed on, so nothing answers it',
            "        if (msg.type === 'beat') return roster.beat(vm, msg);",
            ''],

        ['a message nothing recognises is silently dropped',
            "        say('vm', vm, 'guest').info(JSON.stringify(msg).slice(0, 400));",
            ''],

        ['a sign of life other than a beat is not counted',
            '            roster.seen(vm);',
            ''],

        //WHICH EVENT CAME FIRST IS THE WHOLE DIAGNOSIS.
        ['every ending is the same three words',
            "        roster.drop(vm, why\n            ? 'hung up — ' + why\n            : 'hung up — this side closed it, and nothing here said why');",
            "        roster.drop(vm, 'hung up');"],

        ['the machine closing it is not distinguished from anything else',
            "    socket.on('end', function () { why = why || 'the machine closed it'; });",
            ''],

        ['a connection that broke does not say which error',
            "        why = why || 'error: ' + ((err && (err.code || err.message)) || 'unknown');",
            ''],

        ['the last ending wins rather than the first',
            "    socket.on('end', function () { why = why || 'the machine closed it'; });\n    socket.on('error', function (err) {\n        why = why || 'error: ' + ((err && (err.code || err.message)) || 'unknown');\n    });",
            "    socket.on('end', function () { why = 'the machine closed it'; });\n    socket.on('error', function (err) {\n        why = 'error: ' + ((err && (err.code || err.message)) || 'unknown');\n    });"],

        ['this side closing it reads as the machine having gone',
            "        roster.drop(vm, why\n            ? 'hung up — ' + why",
            "        roster.drop(vm, true\n            ? 'hung up — ' + (why || 'the machine closed it')"],

        //NOT A BREAK: removing `if (!vm) return;` from gone() changes nothing.
        //A socket that never said hello has vm === null, roster.get(null) is
        //undefined, and the check below it returns anyway — and drop() would
        //refuse an unknown name a third time. It was tried as a sabotage and
        //survived because there is nothing there to break. The guard stays for
        //what it says; the test that a never-helloed socket drops nobody stays
        //because the GUARANTEE is real even though this line is not what holds
        //it up.

        //A machine rebooting looks exactly like a machine going.

        ['the old socket closing after a reconnect drops the new connection',
            '        var agent = roster.get(vm);\n        if (!agent || agent.write !== write) return;',
            ''],

        ['a machine that goes mid-command leaves it waiting',
            "        roster.drop(vm, why",
            "        if (jobs.waiting().length) return;\n        roster.drop(vm, why"]
    ]
};
