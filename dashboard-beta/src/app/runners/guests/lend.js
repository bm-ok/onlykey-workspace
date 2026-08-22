//---------------------------------------------------------------------------
//PUTTING A SIGN-IN ON A MACHINE, AND TAKING IT BACK.
//
//The two acts that make ./store a list of things with HOLDERS rather than a
//setting. A sign-in is LENT, not copied: one goes to a machine while it works
//and comes back after, because the Claude CLI refreshes its token as it runs and
//two machines sharing one are two workers rotating the same credential
//underneath each other.
//
//---- the ORDER of the checks is the design ---------------------------------
//
//../../vms/sealed refuses a mismatched pair too, and ./store refuses at
//`lentTo` — which runs AFTER the credential has been written onto the machine.
//So a throw there would arrive with the token already on a disk and nothing on
//this host recording that it is there: refused, and handed over anyway.
//
//A drill found that by asking for a machine that does not exist and being
//refused for THAT instead — which is why the machine is READ rather than
//DEMANDED first. `ours.get` throws for a machine this app did not make, so
//asking it before the role check means a supervisor sign-in named against an
//unknown machine is refused for the MACHINE, and the role is never reached.
//
//So: the ROLE first, from the tag, which is answerable with the machine switched
//off. Then the machine. Then everything that costs a round trip.
//---------------------------------------------------------------------------

module.exports = function lend(deps) {
    var d = deps || {};

    var store = d.store;            //get, token, lentTo, backFrom
    var ours = d.ours;              //read, get, update, kindsOf, SUPERVISOR
    var channel = d.channel;        //connected, run
    var sealed = d.sealed;          //toTheMachine, fingerprint
    var dispatch = d.dispatch;      //RUNS, SUPERVISOR, watcherFor
    var say = d.say;
    var paused = d.paused || function () { return false; };

    var NEWLINE = String.fromCharCode(10);

    //=======================================================================
    //LEND ONE.
    //=======================================================================
    async function toMachine(name, machine) {
        var guest = store.get(name);
        if (!guest) throw new Error('There is no guest called "' + name + '".');

        //FROM THE TAG, WHICH IS WHAT EVERYTHING ELSE READS and is answerable with
        //the machine switched off. An unknown machine has no tags, so it is not a
        //supervisor machine — which is the right answer to be refused by.
        var mine = (ours.read() || []).filter(function (v) { return v.name === machine; })[0] || {};
        var kinds = ours.kindsOf(mine);

        var why = d.whyNotOn(guest.role, kinds, name, machine);

        //---- A SUPERVISOR SIGN-IN IS REFUSED FOR BEING ONE, FIRST ----------
        //
        //True of every machine, INCLUDING ONE THAT DOES NOT EXIST — which is the
        //shape a drill uses to isolate which reason a refusal is for. Asking the
        //machine before this would refuse for the MACHINE and never reach the
        //role, and the role is the one that must not be fixable by tagging
        //something.
        if (why && d.roleFrom(guest.role) === 'supervisor') throw new Error(why);

        //---- AND OTHERWISE THE MACHINE HAS TO EXIST ------------------------
        //
        //BEFORE ITS TAGS MEAN ANYTHING. An unknown machine carries no tags, so
        //the untagged refusal is TRUE of it and describes the wrong thing: it
        //said "give it the worker tag with vmTags, and then this can go to it"
        //about a machine there is nothing to tag.
        //
        //A refusal that names the wrong cause is worse than silence, because
        //somebody acts on it — they go and look for a machine to tag. Found by
        //porting: the app being ported from asks the role and then the machine,
        //and the two orderings differ only for a name that is not there.
        ours.get(machine);

        if (why) throw new Error(why);

        if (!guest.has) {
            throw new Error('"' + name + '" has no token file any more. It was removed by hand, or sealed by '
                + 'another account.');
        }

        //---- A PAUSED SIGN-IN IS LENT, AND SAID OUT LOUD -------------------
        //
        //NOT REFUSED, DELIBERATELY. A sign-in that failed on a machine is
        //skipped by everything that CHOOSES one — the queue will not spend a
        //machine on it — and that is where the flag belongs, because those are
        //the paths where nobody is watching.
        //
        //This one is somebody NAMING it. A credential known to be dead is a
        //useful thing to keep and move around on purpose: it is the only way to
        //exercise what happens to work that cannot be given an identity, without
        //breaking a working credential to arrange it. Refusing here would take
        //that away to prevent a mistake the automatic paths already prevent.
        if (paused(guest)) {
            say('keys').warn('"' + name + '" is being lent to ' + machine + ' and it is a sign-in that has '
                + 'already failed on a machine — ' + ((guest.lastCheck && guest.lastCheck.on) || 'a machine')
                + ' took it and the worker reported itself signed out. Nothing that CHOOSES a sign-in would '
                + 'pick this one; lending it by name is allowed on purpose, so this is a test unless it was '
                + 'a mistake.');
        }

        if (!channel.connected(machine)) {
            throw new Error('"' + machine + '" is not dialled in. Start it and wait for it to connect.');
        }

        //ONE MACHINE AT A TIME, which is the whole reason this list exists. A
        //sign-in already out is refused rather than copied: two machines running
        //as the same identity is the thing being prevented.
        if (guest.holder && guest.holder !== machine) {
            throw new Error('"' + name + '" is on ' + guest.holder + '. Take it back first — two machines '
                + 'holding one sign-in refresh the same token underneath each other, which is how a '
                + 'credential dies.');
        }

        var text = store.token(name);

        //AND THE MEANS TO WATCH WHAT IT DOES WITH IT, IN THE SAME ROUND TRIP.
        //
        //A sign-in landing on a machine is the moment that machine becomes worth
        //watching, and it is the moment the window opens a tab for it — so what
        //that tab runs has to be there already. WHICH BOX DEPENDS ON WHAT THE
        //MACHINE IS FOR: a supervisor's turns and a runner's runs are written by
        //different halves of this app into different directories, and each has
        //its own link to whatever is current.
        var isSupervisor = kinds.indexOf(ours.SUPERVISOR) >= 0;
        var box = isSupervisor ? dispatch.SUPERVISOR : dispatch.RUNS;

        //NOT `log`, WHICH IS A NAME THIS SCOPE ALREADY HAS.
        //
        //It was called that in the app being ported from, and it shadowed the
        //logger for the rest of the function — so twenty lines further down, the
        //line recording the machine as holding a sign-in threw `log.on is not a
        //function` and took the whole lending with it. A drill found it; nothing
        //else would have, because the throw is AFTER the credential has already
        //landed on the machine and been checked.
        //
        //`node --check` passes on this and so does every reading of the line in
        //isolation: it is not an undeclared name, it is a declared one meaning
        //something else. The only defence is not to reuse the word.
        var logFile = isSupervisor ? box + '/current.log' : box + '/current/out.log';

        var done = await sealed.toTheMachine({
            run: function (command, opts) { return channel.run(machine, command, opts); },
            text: text,
            what: 'lending it the Claude guest "' + name + '"',
            andThen: dispatch.watcherFor(box, logFile)
        });

        //AND WHAT LANDED IS WHAT WAS SENT, asked by fingerprint — the same
        //sixteen characters the list keeps, computed ON THE MACHINE from the
        //bytes it actually wrote. Anything else means a handover that reported
        //success while placing something else.
        var mineIs = sealed.fingerprint(text);
        if (done.fingerprint !== mineIs) {
            throw new Error('"' + machine + '" wrote ' + done.fingerprint + ' where "' + name + '" is '
                + mineIs + '. The credential was sealed to that machine\'s key and what it opened is not '
                + 'what was sent — nothing on this host records it as lent.');
        }

        store.lentTo(name, machine, { kind: kinds });
        ours.update(machine, { holdsCredential: true, guest: name });

        say('vm', machine).warn(machine + ' is holding the Claude guest "' + name + '" — it cannot be '
            + 'snapshotted until that is taken back');

        return {
            name: name,
            machine: machine,
            note: machine + ' is signed in as "' + name + '". Take it back with guestBack before the '
                + 'machine is snapshotted or put away.'
        };
    }

    //=======================================================================
    //TAKE ONE BACK.
    //
    //TAKEN, NOT DELETED, and this is the whole point of the call.
    //
    //Ending a run with `rm -f` throws away everything the Claude CLI refreshed
    //while the worker was running, and this host goes on handing out a token that
    //is one or more rotations behind. That is the failure already on record: a
    //credential read as good for months while the worker answering with it said
    //"OAuth session expired".
    //=======================================================================
    async function fromMachine(name, machine) {
        var guest = store.get(name);
        if (!guest) throw new Error('There is no guest called "' + name + '".');

        var on = machine || guest.holder;
        if (!on) throw new Error('"' + name + '" is not out on any machine.');
        ours.get(on);

        var text = null;
        if (channel.connected(on)) {
            //QUIET, and this is the call that proved why that had to exist. The
            //guest reports what a command printed, so `cat` of the credential
            //file put an access token and a refresh token straight into the live
            //log — which the window draws and a screenshot photographs. The
            //caller still gets every byte; THE LOG GETS THE ACT AND NOT THE
            //VALUE.
            var said = await channel.run(on,
                'cat "$HOME/.claude/.credentials.json" 2>/dev/null || true',
                { what: 'taking the Claude guest "' + name + '" back', timeout: 60000, quiet: true });

            //THE FIRST LINE IS THIS APP'S OWN FRAMING, and what follows is the
            //file. A guest shell prints things nobody asked for, so what is taken
            //is only something that starts like JSON.
            var body = String((said && said.output) || '').split(NEWLINE).slice(1).join(NEWLINE).trim();
            if (body.indexOf('{') === 0) text = body;

            await channel.run(on, 'rm -f "$HOME/.claude/.credentials.json" && echo okc-guest-gone',
                { what: 'clearing the credential off it', timeout: 60000 });
        }

        var now = store.backFrom(name, { token: text });
        ours.update(on, { holdsCredential: false, guest: null });

        say('vm', on)[now.rotated ? 'good' : 'info'](now.rotated
            ? 'the Claude guest "' + name + '" came back refreshed — ' + now.fingerprint
            : 'the Claude guest "' + name + '" came back unchanged');

        //AND IF THE STORE REFUSED WHAT CAME BACK, that is said here rather than
        //there: ./store does not log, and somebody looking for why a sign-in
        //stopped working will be reading this record.
        if (now.refused) say('keys').bad(now.refused);

        return {
            name: name,
            machine: on,
            rotated: now.rotated,
            refused: now.refused || null,
            fingerprint: now.fingerprint,
            reached: text !== null,
            note: text === null
                ? on + ' could not be read, so "' + name + '" is marked as back without anything being kept. '
                    + 'If that machine had a newer token, it went with the rollback.'
                : now.refused
                    ? now.refused
                    : now.rotated
                        ? '"' + name + '" was refreshed while it was out, and the newer one is kept. '
                            + 'Fingerprint ' + now.fingerprint + '.'
                        : '"' + name + '" came back exactly as it went out.'
        };
    }

    return { toMachine: toMachine, fromMachine: fromMachine };
};
