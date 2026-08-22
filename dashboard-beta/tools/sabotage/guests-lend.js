//what ../../test/runners/guests-lend.test.js has to be able to catch.
//
//THE PATH THAT PUTS A CREDENTIAL ON A DISK THAT IS NOT THIS ONE. Every break
//below either lands a credential somewhere it must not go, loses one that came
//back, or puts one somewhere it can be read.
module.exports = {
    file: 'src/app/runners/guests/lend.js',
    test: 'test/runners/guests-lend.test.js',
    breaks: [
        //---- the order of the checks ------------------------------------------

        //../store REFUSES A MISMATCHED PAIR TOO — at `lentTo`, which runs AFTER
        //the credential has been written onto the machine. A throw there arrives
        //with the token already on a disk and nothing recording that it is there.
        ['the role is not checked before the credential is handed over',
            "        if (why && d.roleFrom(guest.role) === 'supervisor') throw new Error(why);",
            ''],

        ['nor after the machine, so nothing checks it here at all',
            '        if (why) throw new Error(why);',
            ''],

        //THE SUPERVISOR REFUSAL IS TRUE OF EVERY MACHINE, including one that does
        //not exist — which is the shape that isolates which reason a refusal is
        //for. Asking the machine first refuses for the MACHINE and never reaches
        //the role, and the role is the one that must not be fixable by tagging.
        ['the machine is demanded first, so a supervisor sign-in is refused for the wrong reason',
            "        if (why && d.roleFrom(guest.role) === 'supervisor') throw new Error(why);",
            '        ours.get(machine);'],

        //AND A MACHINE THAT DOES NOT EXIST is not an untagged machine. "Give it
        //the worker tag and then this can go to it" is advice about a machine
        //there is nothing to tag.
        ['a machine that does not exist is told to add a tag',
            '        ours.get(machine);\n\n        if (why) throw new Error(why);',
            '        if (why) throw new Error(why);\n\n        ours.get(machine);'],

        //---- and everything that must hold before a byte moves ------------------

        ['a sign-in whose file is gone is handed over anyway',
            '        if (!guest.has) {',
            '        if (false) {'],

        ['a machine that is not dialled in is sent a credential',
            '        if (!channel.connected(machine)) {',
            '        if (false) {'],

        //ONE MACHINE AT A TIME, which is the whole reason the list has holders.
        //Two machines running as the same identity rotate the same token
        //underneath each other, which is how a credential dies.
        ['a sign-in already out on another machine is copied to a second one',
            '        if (guest.holder && guest.holder !== machine) {',
            '        if (false) {'],

        ['and a machine cannot be handed the sign-in it already holds',
            '        if (guest.holder && guest.holder !== machine) {',
            '        if (guest.holder) {'],

        //---- what landed is what was sent ---------------------------------------

        //ANYTHING ELSE MEANS A HANDOVER THAT REPORTED SUCCESS while placing
        //something else.
        ['what landed is never compared with what was sent',
            '        if (done.fingerprint !== mineIs) {',
            '        if (false) {'],

        //AND NOTHING IS RECORDED WHEN IT DID NOT LAND. A record saying a machine
        //holds a credential it does not is worse than no record.
        ['a mismatch is said and the loan is recorded anyway',
            "            throw new Error('\"' + machine + '\" wrote ' + done.fingerprint + ' where \"' + name + '\" is '",
            "            say('keys').warn('\"' + machine + '\" wrote ' + done.fingerprint + ' where \"' + name + '\" is '"],

        //---- the means to watch it, in the same round trip ------------------------

        //A SIGN-IN LANDING ON A MACHINE is the moment it becomes worth watching,
        //and the moment the window opens a tab for it.
        ['nothing to watch it with goes over with the credential',
            '            andThen: dispatch.watcherFor(box, logFile)',
            "            andThen: ''"],

        //A SUPERVISOR'S TURNS AND A RUNNER'S RUNS are written by different halves
        //of this app into different directories.
        ['a supervisor machine is given the runner box to watch',
            '        var box = isSupervisor ? dispatch.SUPERVISOR : dispatch.RUNS;',
            '        var box = dispatch.RUNS;'],

        ['and the wrong log inside it',
            "        var logFile = isSupervisor ? box + '/current.log' : box + '/current/out.log';",
            "        var logFile = box + '/current/out.log';"],

        //---- and it is recorded on both sides -------------------------------------

        ['the machine is not marked as holding it, so it can still be snapshotted',
            "        ours.update(machine, { holdsCredential: true, guest: name });",
            ''],

        ['and the store does not record who has it',
            '        store.lentTo(name, machine, { kind: kinds });',
            ''],

        //---- taking it back --------------------------------------------------------

        //ENDING A RUN WITH `rm -f` throws away everything the CLI refreshed while
        //the worker ran, and this host goes on handing out a token one or more
        //rotations behind.
        ['what the worker refreshed is thrown away rather than kept',
            "            if (body.indexOf('{') === 0) text = body;",
            ''],

        ['and the credential is left on the machine',
            '            await channel.run(on, \'rm -f "$HOME/.claude/.credentials.json" && echo okc-guest-gone\',',
            "            if (false) await channel.run(on, 'rm -f \"$HOME/.claude/.credentials.json\" && echo okc-guest-gone',"],

        //`cat` OF THE CREDENTIAL FILE put an access token and a refresh token
        //straight into the live log, which the window draws and a screenshot
        //photographs.
        ['the credential is read into the live log',
            "                { what: 'taking the Claude guest \"' + name + '\" back', timeout: 60000, quiet: true });",
            "                { what: 'taking the Claude guest \"' + name + '\" back', timeout: 60000 });"],

        //THE FIRST LINE IS THIS APP'S OWN FRAMING. Keeping it would store a
        //credential with a line of somebody else's text in front of it.
        ['this app\'s own framing is stored as part of the credential',
            '            var body = String((said && said.output) || \'\').split(NEWLINE).slice(1).join(NEWLINE).trim();',
            "            var body = String((said && said.output) || '').trim();"],

        //A GUEST SHELL PRINTS THINGS NOBODY ASKED FOR, so what is taken is only
        //something that starts like JSON.
        ['a shell error is stored as the credential',
            "            if (body.indexOf('{') === 0) text = body;",
            '            if (body) text = body;'],

        //OTHERWISE THE SIGN-IN IS HELD BY A MACHINE NOBODY CAN ASK, for ever.
        ['a machine that cannot be reached keeps the sign-in for ever',
            '        var now = store.backFrom(name, { token: text });',
            '        if (text === null) throw new Error(on + \' could not be read\');\n        var now = store.backFrom(name, { token: text });'],

        ['and the machine is left recorded as holding it',
            '        ours.update(on, { holdsCredential: false, guest: null });',
            ''],

        //../store DOES NOT LOG, and somebody looking for why a sign-in stopped
        //working will be reading this record.
        ['a refused credential is silently dropped rather than said',
            "        if (now.refused) say('keys').bad(now.refused);",
            '']
    ]
};
