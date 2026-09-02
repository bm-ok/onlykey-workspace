//---------------------------------------------------------------------------
//WHAT WORK HANDS BACK: the files it produced, and what a judge concluded.
//
//THE OTHER HALF OF ../../worker/sessions. That one is what a piece of work REMEMBERS
//between the machines it passes through; this is what it PRODUCES and gives to
//this host. Both are the guest talking back over https with its own token, and
//neither can be reached by anything that did not dial in as a machine we made.
//
//NEITHER OF THESE EXISTED HERE AND BOTH ARE HOW A JUDGE SPEAKS AT ALL. A judge
//may not push to what it is reading — that is the rule its whole role turns on —
//so handing a file back and recording a verdict are the only two ways it can say
//anything. Without them a judgement ran, read the change, wrote its report and
//then had nowhere to put it: the run ended "having handed nothing back", which
//reads exactly like a judge that looked and declined to answer.
//
//WHAT IT BELONGS TO IS NOT ASKED, IT IS LOOKED UP. A machine is running exactly
//one thing or it is running nothing, and a guest naming its own work would be a
//guest filing against somebody else's. The `?vm=` in the query is used for the
//log line and nothing else.
//---------------------------------------------------------------------------

module.exports = function guestapi(deps) {
    var d = deps || {};

    var whatIsOn = d.whatIsOn;      //(machine) -> what it is running, or null
    //(kind, door) -> { may, why }. Declared in ./server.js beside the code that
    //refuses by it, so this door and the pane that lists it read one string.
    var may = d.may;
    var artifacts = d.artifacts;    //keep(uid, name, body, meta)
    var verdictFor = d.verdictFor;  //(judgement, verdict, note) -> recorded
    var say = d.say;                //(who, name, 'guest') -> a logger
    var MOST = d.MOST || (64 * 1024 * 1024);

    function text(at, code, body) {
        at.res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
        at.res.end(body);
    }

    //A NAME THAT IS A NAME, not a path. Anything with a separator in it is a
    //guest choosing where on this host its file lands.
    function whyNotCalled(name) {
        var n = String(name == null ? '' : name).trim();
        if (!n) return 'give the file a name.';
        if (n.length > 200) return 'that name is too long.';
        if (/[\\/]/.test(n)) return 'a name, not a path — this side decides where it goes.';
        if (n === '.' || n === '..') return 'that is not a name.';
        return null;
    }

    function body(at) {
        return new Promise(function (done, fail) {
            var chunks = [];
            var size = 0;
            var stopped = false;

            at.req.on('data', function (chunk) {
                if (stopped) return;
                size += chunk.length;
                //STOPPED AT THE DOOR rather than after it is all in memory: the
                //point of a cap is not to have accepted the thing it refuses.
                if (size > MOST) {
                    stopped = true;
                    fail(Object.assign(new Error('the most this takes is '
                        + Math.round(MOST / 1048576) + ' MB'), { tooBig: true }));
                    try { at.req.destroy(); } catch (e) { /* already going */ }
                    return;
                }
                chunks.push(chunk);
            });
            at.req.on('end', function () { if (!stopped) done(Buffer.concat(chunks)); });
            at.req.on('error', fail);
        });
    }

    //---- A FILE ------------------------------------------------------------
    async function takeFile(at) {
        var name = at.vm.name;
        var called = at.url.searchParams.get('name') || '';

        var why = whyNotCalled(called);
        if (why) return text(at, 400, why + '\n');

        var doing = await whatIsOn(name);

        //A JOB IS NOT A TASK, AND IT HANDS THINGS BACK TOO. A run says which it
        //is in its own id, and a job's is unique by construction, so it can be
        //what the file is filed under. Preferred last: a machine running work
        //files against the WORK, which is what somebody looks under afterwards.
        var run = String(at.url.searchParams.get('run') || '');
        var job = !doing && /^job-/.test(run) ? run : null;

        if (!doing && !job) {
            return text(at, 409, 'this machine is not running a task, a judgement or a job, '
                + 'so there is nothing for an artifact to belong to.\n');
        }

        //AND WHETHER A RUN OF THIS KIND MAY HAND ONE BACK AT ALL, asked of
        //../../permissions rather than assumed. Both kinds may today and the
        //reasons differ — a task's file sits beside its commits, a judgement's
        //IS the deliverable because it may not push. A job has no kind and is
        //let through above.
        if (doing) {
            var allowed = may(doing.kind, 'artifact');
            if (!allowed.may) {
                return text(at, 403, 'refused: ' + allowed.why + '\n');
            }
        }

        var bytes;
        try { bytes = await body(at); }
        catch (e) { return text(at, e.tooBig ? 413 : 400, e.message + '\n'); }

        try {
            //FILED UNDER A UID WHERE THERE IS ONE, and under the run's own id
            //where it is a bare job. All three are unique and none is reused,
            //which is the only property this needs of them.
            var meta = doing
                ? {
                    run: (doing.item && doing.item.run) || null,
                    kind: doing.kind,
                    ref: doing.ref || null,
                    number: doing.item && doing.item.number,
                    title: doing.title || null,
                    //WHAT IT WAS ABOUT, for a judgement: the change it read.
                    reads: doing.reads || null
                }
                : { run: job };

            var kept = await artifacts.keep(doing ? doing.uid || doing.id : job, called, bytes, meta);
            say('vm', name, 'guest').good(name + ' handed over "' + called + '" ('
                + Math.round((kept && kept.bytes ? kept.bytes : bytes.length) / 1024) + ' KB) for '
                + (doing ? (doing.ref || doing.id) : job));
            return text(at, 200, 'kept\n');
        } catch (e) {
            return text(at, 500, e.message + '\n');
        }
    }

    //---- AND A VERDICT -----------------------------------------------------
    //
    //ONLY A JUDGEMENT HAS ONE. A task does not conclude anything about itself —
    //that is what a judgement is for — so this refuses rather than filing an
    //opinion against work that never asked for one.
    async function takeVerdict(at) {
        var name = at.vm.name;
        var said = String(at.url.searchParams.get('verdict') || '').trim().toLowerCase();
        var note = String(at.url.searchParams.get('note') || '');

        if (['accept', 'reject', 'pending'].indexOf(said) < 0) {
            return text(at, 400, '"' + said + '" is not a verdict. It is "accept", "reject" or "pending".\n');
        }
        //A REJECTION HAS TO SAY WHY. Nothing is automatically re-run, so that
        //note is the whole of what survives the machine.
        if (said === 'reject' && !note.trim()) {
            return text(at, 400, 'a rejection has to say why.\n');
        }

        var doing = await whatIsOn(name);
        if (!doing) {
            return text(at, 409, 'this machine is not running anything, so there is nothing to record a '
                + 'verdict against.\n');
        }

        //ASKED, NOT DECIDED. `doing.kind` says what this run is; ./server.js
        //declared what a run of that kind may do here, and this refuses with
        //the reason it gave rather than one written twice.
        var allowedVerdict = may(doing.kind, 'verdict');
        if (!allowedVerdict.may) {
            return text(at, 403, 'refused: ' + allowedVerdict.why + '\n');
        }

        try {
            await verdictFor(doing, said, note);
            say('vm', name, 'guest').good(name + ' concluded ' + (doing.ref || doing.id) + ': ' + said);
            return text(at, 200, 'recorded\n');
        } catch (e) {
            return text(at, 500, e.message + '\n');
        }
    }

    return {
        name: 'handback',
        about: 'What a machine hands back: the files its work produced, and what a judge concluded',

        //THE SAME FENCE ../../worker/sessions STATES. A supervisor runs no task and no
        //judgement, so it has nothing to hand back — said here, where the verbs
        //are, rather than left as an accident of the lookup.
        may: function (vm) {
            return !!(vm && vm.name && !(vm.tags || []).some(function (t) { return t === 'supervisor'; }));
        },

        routes: [
            { method: 'POST', path: '/artifact', about: 'keep a file this run produced', run: takeFile },
            { method: 'POST', path: '/verdict', about: 'record what a judgement concluded', run: takeVerdict }
        ]
    };
};
