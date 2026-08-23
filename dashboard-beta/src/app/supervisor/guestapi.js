var allowed = require('./allowed');

//---------------------------------------------------------------------------
//THE ONLY DOOR A SUPERVISOR HAS INTO THIS HOST.
//
//Two verbs. What may I ask for, and here is one of them. Registered with
//../vms/https, which owns the certificate and has already proved which machine
//is asking before any of this runs.
//
//---- the list is fetched, not carried -------------------------------------
//
//`GET /supervisor` IS ASKED FOR RATHER THAN REMEMBERED. The MCP server on the
//machine builds its tools from this answer at startup — see ../vms/provision/
//scripts/okc-mcp.js — so a verb removed here disappears there on the next wake,
//and a model that has to guess the list will guess, and every wrong guess is a
//refusal in the log that looks like something trying doors.
//
//---- and the flag it does not get to set ----------------------------------
//
//SEVERAL ACTIONS BEHAVE DIFFERENTLY DEPENDING ON WHO ASKED. A job, prompt or
//contract written AT THE WINDOW is approved by whoever wrote it, because a
//person read it; written OVER THE WIRE it waits. And approving is refused over
//the wire outright — a model may write one and may not approve its own.
//
//That is decided from `_overTheWire`, and this route calls the action table IN
//PROCESS exactly as the window does. So without stamping it, a supervisor
//writing a job would have produced an APPROVED one: a machine writing a program
//and marking it read.
//
//TWO HALVES, AND THE SECOND IS THE ONE THAT GETS FORGOTTEN: every key the
//machine sent beginning with `_` is DROPPED before the flag is set. Otherwise a
//supervisor puts `_overTheWire: false` in its own body and is the window, or
//`_fromMachine: 'somebody-else'` and is somebody else. What arrives over the
//wire is data, and data does not get to say where it came from.
//---------------------------------------------------------------------------

//A TASK BRIEF IS PROSE AND CAN BE LONG; a megabyte is not a brief. Stopped at
//the door rather than after it is all in memory, because the point of a cap is
//not to have accepted the thing it refuses.
var MOST = 1024 * 1024;

module.exports = function guestapi(deps) {
    var d = deps || {};
    var ours = d.ours;
    var call = d.call;
    //WHAT EACH VERB TAKES, FROM THE WHOLE CATALOGUE rather than this app's own
    //half of it. Most of these verbs are still answered by the app being ported
    //from, so a supervisor asking the local table what `taskCreate` takes would
    //be told nothing at all — and a model with a verb and no argument names
    //guesses, which is a refusal in the log that looks like something trying
    //doors.
    var catalogue = d.catalogue || function () { return Promise.resolve([]); };
    var say = d.say;

    //---- what it may do ----------------------------------------------------
    async function may(at) {
        var takes = {};
        //A CATALOGUE THAT COULD NOT BE READ IS NOT AN EMPTY ONE — the verbs are
        //still the verbs, and losing the argument names is worth less than
        //failing the call. So this is best effort and the list always answers.
        try {
            (await catalogue()).forEach(function (row) { takes[row.name] = row.takes || []; });
        } catch (e) {
            say('supervisor', at.vm.name).warn('could not read what each verb takes: ' + e.message);
        }

        return {
            vm: at.vm.name,
            may: allowed.list().map(function (one) {
                return { what: one.what, why: one.why, takes: takes[one.what] || [] };
            }),
            how: 'POST /supervisor/do?what=<action> with a JSON object of arguments as the body.',
            note: 'This is a named list, not a filter over what this host can do. '
                + 'Anything not on it does not exist here.'
        };
    }

    //---- and doing one -----------------------------------------------------
    async function doIt(at) {
        var what = at.url.searchParams.get('what') || '';
        var to = say('supervisor', at.vm.name);

        //THE FENCE THAT COUNTS. The other two are on the machine, where a
        //supervisor could reach them; this one is here.
        if (!allowed.may(what)) {
            to.warn('refused "' + what + '" — a supervisor may not ask for it');
            at.res.writeHead(403, { 'content-type': 'application/json' });
            at.res.end(JSON.stringify({ error: allowed.refuse(what) }, null, 2));
            return;
        }

        var body = await read(at.req, at.res);
        if (body === null) return;   //already answered: too big, or not JSON

        //EVERY `_` KEY DROPPED, THEN OURS SET. See the header — this is the half
        //that gets forgotten, and without it the two lines below are decoration.
        var args = {};
        Object.keys(body).forEach(function (k) {
            if (k.charAt(0) !== '_') args[k] = body[k];
        });

        args._overTheWire = true;

        //AND WHICH MACHINE IS TALKING, stamped here rather than claimed there. A
        //message on the Chat tab says who said it, and the question that record
        //has to answer later is who asked for a thing — so the name comes from
        //the token that authenticated the call.
        args._fromMachine = at.vm.name;

        //COUNTED, AND THIS IS THE ONLY PLACE IT CAN BE. It is what makes "that
        //waking asked for nothing" answerable — see `asksSoFar` in ./allowed.js
        //for the three-second turn that is the reason it exists. Counted here
        //rather than at the fence above, because a supervisor spending a whole
        //turn being refused is very much a turn that did something.
        allowed.noteAsked();

        to.info('asked for ' + what);
        return await call(what, args);
    }

    //THE BODY, CAPPED AT THE DOOR AND PARSED ONCE.
    function read(req, res) {
        return new Promise(function (done) {
            var chunks = [];
            var size = 0;
            var refused = false;

            req.on('data', function (c) {
                if (refused) return;
                size += c.length;
                if (size > MOST) {
                    refused = true;
                    res.writeHead(413, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: 'that is more than a megabyte of arguments' }));
                    req.destroy();
                    done(null);
                    return;
                }
                chunks.push(c);
            });

            req.on('end', function () {
                if (refused) return;
                var text = Buffer.concat(chunks).toString('utf8').trim();
                if (!text) return done({});

                var args;
                try { args = JSON.parse(text); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: 'the body is not JSON: ' + e.message }));
                    return done(null);
                }

                //AN ARRAY IS NOT A SET OF ARGUMENTS, and neither is a number.
                //Taken here rather than left to the action, which would report
                //something confusing about a field being missing.
                if (!args || typeof args !== 'object' || Array.isArray(args)) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: 'the body is a JSON object of arguments, or nothing at all' }));
                    return done(null);
                }

                done(args);
            });
        });
    }

    return {
        name: 'supervisor',
        about: 'The only door a supervisor has into this host',

        //A RUNNER IS NOT A SUPERVISOR. Read from the role rather than from the
        //spec, because ../vms/ours is where a role is decided and a second
        //opinion here is how the two come to disagree.
        //
        //../vms/https answers this the same way it answers a bad token, and that
        //is deliberate: a machine that could tell the two apart could work out
        //what shape of machine drives this host.
        may: function (vm) { return ours.canBe(vm, 'supervisor') === true; },

        routes: [
            { method: 'GET', path: '/supervisor', about: 'what a supervisor may ask for', run: may },
            { method: 'POST', path: '/supervisor/do', about: 'ask for one of them', run: doIt }
        ]
    };
};

module.exports.MOST = MOST;
