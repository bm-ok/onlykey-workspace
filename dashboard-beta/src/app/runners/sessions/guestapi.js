//---------------------------------------------------------------------------
//THE ONE DOOR A WORKER HAS TO WHAT IT REMEMBERS.
//
//TWO VERBS AND THEY ARE THE SAME QUESTION FROM EITHER SIDE: give this machine
//the conversation its work is carrying on, and take the conversation back when
//the work ends.
//
//---- nothing here asks the guest what it is doing --------------------------
//
//A MACHINE SAYS WHICH MACHINE IT IS BY HOLDING ITS OWN TOKEN — ../../vms/https
//has already proved that before anything here runs — and this host then LOOKS UP
//what that machine was given. There is no argument to lie about, which is what
//makes the surface safe rather than any check further in. See ../onmachine.
//
//SO A MACHINE CANNOT ASK FOR SOMEBODY ELSE'S CONVERSATION. Not because asking is
//refused, but because there is nowhere in the request to put the question.
//
//---- and the key is worked out on BOTH sides by one function ---------------
//
//../keying.js's `keyFor`, asked here when handing one over and asked here again
//when taking it back. Two places deciding it separately is two places to get
//REMEMBERS wrong in opposite directions, and the symptom would be work handed a
//conversation it then cannot save.
//---------------------------------------------------------------------------

module.exports = function guestapi(deps) {
    var d = deps || {};

    var whatIsOn = d.whatIsOn;      //(machine) -> what it is running, or null
    var sessions = d.sessions;      //keyFor, get, keep, aboutWork, MOST
    var readFile = d.readFile;      //(path) -> Buffer
    var say = d.say;                //(who, name, 'guest') -> a logger
    var signedBy = d.signedBy;      //(machine) -> which sign-in it is holding

    function text(at, code, body) {
        at.res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
        at.res.end(body);
    }

    //---- WHAT THIS MACHINE'S WORK REMEMBERS -------------------------------
    //
    //204 RATHER THAN 404, TWICE OVER. "There is nothing running here" and "this
    //conversation has not started yet" are both ORDINARY answers — the first run
    //of every piece of work gives the second one — and a guest that treated
    //either as a failure would report an error on the most common path there is.
    async function hand(at) {
        var name = at.vm.name;

        var doing = whatIsOn(name);
        if (!doing) { at.res.writeHead(204); at.res.end(); return; }

        var kept = await sessions.get(sessions.keyFor(doing));
        if (!kept) { at.res.writeHead(204); at.res.end(); return; }

        try {
            var body = readFile(kept.path);
            at.res.writeHead(200, {
                'content-type': 'application/gzip',
                //THE CONVERSATION IT IS CARRYING ON, so the guest can pass
                //--resume without looking inside the archive it was just handed.
                //IT IS TOLD WHICH; IT DOES NOT CHOOSE.
                'x-okc-session': kept.id || ''
            });
            at.res.end(body);

            say('vm', name, 'guest').info('sent ' + doing.ref + ' what it remembers — '
                + Math.round(kept.bytes / 1024) + ' KB, ' + kept.runs + ' run(s) so far');
        } catch (e) {
            //THE ARCHIVE IS ON DISK AND WOULD NOT COME OFF IT. Not a 204: that
            //would tell the guest there is nothing to resume, and it would start
            //cold having silently lost a conversation that is still there.
            text(at, 500, e.message + '\n');
        }
    }

    //---- AND TAKING IT BACK -----------------------------------------------
    async function take(at) {
        var name = at.vm.name;
        var id = at.url.searchParams.get('id') || '';

        //---- WHAT IT BELONGS TO, DECIDED BEFORE A BYTE IS READ -------------
        //
        //409 rather than 400: nothing is wrong with the REQUEST. The machine is
        //not running anything, so a transcript has nothing to belong to — and
        //filing it under a guess is how one piece of work ends up holding
        //another's conversation.
        var doing = whatIsOn(name);
        if (!doing) {
            text(at, 409, 'this machine is not running anything, so a transcript has nothing to '
                + 'belong to.\n');
            return;
        }

        var body = await collect(at);
        if (body === null) return;   //already answered, with why

        try {
            //FILED BY THE SAME RULE IT WILL BE LOOKED UP BY — see the header.
            var kept = await sessions.keep(sessions.keyFor(doing), body, Object.assign({
                id: id,
                run: doing.item && doing.item.run,
                machine: name,
                taskId: doing.id,
                number: doing.number,
                kind: doing.kind,
                folder: at.url.searchParams.get('folder') || null,

                //WHICH SIGN-IN SPENT THIS, taken from the MACHINE rather than
                //asked of the guest. A worker naming its own identity would be a
                //worker choosing which one to bill.
                guest: signedBy(name)
            }, sessions.aboutWork(doing)));

            at.res.writeHead(200, { 'content-type': 'application/json' });
            at.res.end(JSON.stringify({ kept: kept.bytes, runs: kept.runs }));

            say('vm', name, 'guest').info('kept what ' + doing.ref + ' remembers — '
                + Math.round(kept.bytes / 1024) + ' KB, ' + kept.runs + ' run(s) so far');
        } catch (e) {
            //---- REFUSED, AND THE GUEST IS TOLD WHY ------------------------
            //
            //THE REFUSAL HAS TO BE HEARD, and until recently it was not: the
            //guest's upload used `curl` with no `--fail`, so a 4xx returned
            //normally and it printed "kept what this task remembers" about an
            //archive this host had thrown away. Fixed in
            //../../vms/dispatch/guest/job-api.js; this end sends the reason in
            //the body so what it prints says which refusal it was.
            //
            //422 rather than 400: the request is well formed and the CONTENT is
            //the problem — a credential in the archive, or an archive that will
            //not open. See ../sessions/storing.js for why both are refused
            //rather than kept with a note.
            say('vm', name, 'guest').warn('would not keep what ' + doing.ref
                + ' remembers: ' + e.message);
            text(at, 422, e.message + '\n');
        }
    }

    //---- THE BODY, WITH A CEILING ON IT -----------------------------------
    //
    //REFUSED WHILE IT ARRIVES rather than after. An archive over the limit is
    //one this host will not keep, and reading the whole of it first to say so
    //means a machine can spend this host's memory on a thing that was never
    //going to be stored.
    function collect(at) {
        return new Promise(function (resolve) {
            var chunks = [];
            var size = 0;
            var refused = false;

            at.req.on('data', function (chunk) {
                if (refused) return;
                size += chunk.length;
                if (size > sessions.MOST) {
                    refused = true;
                    text(at, 413, 'the most this takes is '
                        + Math.round(sessions.MOST / 1048576) + ' MB\n');
                    at.req.destroy();
                    resolve(null);
                    return;
                }
                chunks.push(chunk);
            });

            at.req.on('end', function () {
                if (refused) return;
                resolve(Buffer.concat(chunks));
            });

            //A CONNECTION THAT DIES MID-UPLOAD IS NOT AN EMPTY ARCHIVE. Without
            //this the promise never settles and the request hangs open forever,
            //which on a socket the guest has already abandoned is a handle this
            //host keeps until it is restarted.
            at.req.on('error', function () {
                if (!refused) resolve(null);
            });
        });
    }

    return {
        name: 'sessions',
        about: 'What a machine\'s work remembers between the machines it passes through',

        //---- WHO MAY REACH IT ---------------------------------------------
        //
        //ANY MACHINE THIS APP MADE THAT IS NOT A SUPERVISOR. A supervisor holds
        //no repositories and runs no task or judgement, so `whatIsOn` would
        //answer null for it every time — but saying so here means the fence is
        //stated where the verbs are rather than being an accident of the lookup.
        may: function (vm) {
            return !!(vm && vm.name && !(vm.tags || []).some(function (t) { return t === 'supervisor'; }));
        },

        routes: [
            { method: 'GET', path: '/session', about: 'what this machine\'s work remembers', run: hand },
            { method: 'POST', path: '/session', about: 'keep what it remembers now', run: take }
        ]
    };
};
