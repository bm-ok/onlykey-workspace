//what ../../test/vms/busy.test.js has to be able to catch, across the host.
module.exports = {
    file: 'src/app/vms/busy/turns.js',
    test: 'test/vms/busy.test.js',
    breaks: [
        //TWO MACHINES BOOTING AT ONCE DO NOT TAKE TWICE AS LONG, THEY WEDGE.
        //One sat on its splash screen for eleven minutes with nothing wrong
        //with it.
        ['two machines come up at once',
            '            if (!holder) {',
            '            if (true) {'],

        ['nothing is ever recorded as coming up, so nothing ever waits',
            '                holder = { name: name, kind: kind, depth: 1 };\n                return go();',
            '                return go();'],

        //THE SAME MACHINE, INSIDE ITS OWN TURN. Bringing a machine up holds this
        //for the whole boot and then starts it, which takes a turn as well — so
        //without this the one path that matters most waits for a turn only it
        //could give up, for ever.
        ['a machine waits for a turn only it could give up',
            '            if (holder.name === name) {',
            '            if (false) {'],

        //COUNTED RATHER THAN A FLAG, because the nesting is two deep today and
        //nothing says it stays that way.
        ['the nesting is a flag, so an inner turn ending hands the host away',
            '                holder.depth++;\n                return go();',
            '                return go();'],

        ['an inner turn ending is treated as the turn ending',
            '        if (holder && holder.depth > 1) {\n            holder.depth--;\n            return;\n        }',
            ''],

        //A BREATH BETWEEN MACHINES. Ending the turn on the first byte hands the
        //host over at the heaviest moment of the whole boot — the initrd handing
        //over and udev bringing devices up.
        ['the next machine starts the instant the last one speaks',
            '        after(settleMs, function () { next.go(); });',
            '        next.go();'],

        ['there is no settle to wait out',
            '    var settleMs = d.settleMs == null ? SETTLE_MS : d.settleMs;',
            '    var settleMs = 0;'],

        //HELD BY THE MACHINE THAT IS ABOUT TO START, not left ownerless, or
        //anything arriving during the pause sees a free host and starts
        //immediately — which is the race the pause exists to close.
        ['the host is left ownerless through the settle',
            '        holder = { name: next.name, kind: next.kind, depth: 1 };\n        after(settleMs',
            '        after(settleMs'],

        //ONLY THE WAIT IS BOUNDED. An install is half an hour by nature, and a
        //timeout around the work would be a machine abandoned half-built.
        ['a machine that waited too long is left waiting for ever',
            '            mine.timer = after(waitMs, function () {',
            '            mine.timer = null; var never = function () {'],

        ['the refusal does not say what it was waiting for',
            "                no(new Error('Waited ' + Math.round(waitMs / 60000) + ' minutes for \"'\n                    + (holder ? holder.name : 'another machine') + '\" to finish coming up before starting \"'\n                    + name + '\". One machine comes up at a time on purpose — two at once wedges this host.'));",
            "                no(new Error('timed out'));"],

        //A BOOT THAT GAVE UP MUST COME OFF THE QUEUE, or the machine ahead of it
        //later hands the host to something that is no longer waiting — and the
        //host sits held by a turn nobody will ever give up.
        ['a boot that was refused stays on the queue and is later given the host',
            '                var at = waiting.indexOf(mine);\n                if (at >= 0) waiting.splice(at, 1);',
            ''],

        //ONE FAILED BOOT MUST NOT STOP EVERY MACHINE ON THE HOST, for ever.
        ['a boot that threw keeps the host',
            '        try {\n            return await fn();\n        } finally {\n            giveUpTurn();\n        }',
            '        var out = await fn();\n        giveUpTurn();\n        return out;'],

        ['the turn is never given up at all',
            '            giveUpTurn();',
            ''],

        //IN THE ORDER THEY ASKED. A stack rather than a queue starves whatever
        //asked first, which on a busy host is the thing that has waited longest.
        ['machines take their turns in the reverse of the order they asked',
            '        var next = waiting.shift();',
            '        var next = waiting.pop();'],

        //A MACHINE THAT IS WAITING SHOULD BE ABLE TO SAY SO.
        ['nothing can tell what is waiting for a turn',
            '        return waiting.map(function (w) { return { name: w.name, kind: w.kind }; });',
            '        return [];'],

        ['a waiting machine is not told what it is waiting for',
            '            if (onWait) onWait(holder.name);',
            '']
    ]
};
