//---------------------------------------------------------------------------
//RUNNING SOMETHING ON A DIALLED-IN MACHINE, AND WAITING FOR IT.
//
//THIS IS THE FAST PATH. Re-running a provisioning script on a live machine
//takes a minute, where reinstalling to try a change takes half an hour — and
//nobody iterates on a half-hour loop.
//
//WHAT TO RUN LIVES ON THIS SIDE. A dialled-in machine reports output and
//results and nothing else; it is not asked what it would like to do.
//---------------------------------------------------------------------------

//A COMMAND THAT HAS NOT FINISHED IN HALF AN HOUR is not going to. Long, because
//a provision is long; bounded, because a job that never settles is a promise
//nobody ever resolves and a machine nobody ever puts away.
var GIVE_UP_AFTER = 30 * 60 * 1000;

module.exports = function jobs(deps) {
    var d = deps || {};
    var say = d.say || function () { return { info: function () {}, out: function () {}, good: function () {}, bad: function () {} }; };

    //HOW TO REACH A MACHINE. Handed in, so this file holds no sockets and the
    //roster stays the one place that knows who is dialled in.
    var agentFor = d.agentFor || function () { return null; };

    var after = d.after || function (ms, fn) { return setTimeout(fn, ms); };
    var cancel = d.cancel || function (t) { clearTimeout(t); };

    var seq = 0;
    var open = {};   //job id -> { vm, quiet, lines, settle }

    //---- asking ------------------------------------------------------------

    function run(name, command, opts) {
        var o = opts || {};
        var what = o.what || 'command';
        var timeout = o.timeout || GIVE_UP_AFTER;

        //`quiet` — WHAT COMES BACK IS NOT PUT IN THE LOG.
        //
        //The caller still gets every line; the live log gets none of them. There
        //is exactly one reason to want this and it is the reason it exists:
        //reading a CREDENTIAL back off a machine. That is done with `cat`, the
        //guest dutifully reports what it printed, and an access token and a
        //refresh token were then sitting in the live log — which the window
        //draws, `capture` photographs, and `logSince` hands to anyone at the
        //command line.
        var quiet = !!o.quiet;

        var agent = agentFor(name);
        if (!agent) {
            //SAYS WHAT TO DO ABOUT IT. "not connected" is a true sentence that
            //leaves somebody looking at a machine wondering whose fault it is.
            throw new Error('"' + name + '" is not dialled in, so there is nothing to run a '
                + 'command on. Start it and wait for it to connect.');
        }

        var id = String(++seq);

        //THE LINE SAYING THE COMMAND RAN IS STILL LOGGED, even when quiet.
        //
        //"this host read the credential off kit-1" is exactly the kind of act
        //that should be visible. It is the VALUE that must not be — which is the
        //rule the Keys tab is built to: somebody may know something was done in
        //there without knowing what.
        say('vm', name, 'channel').info('running on ' + name + ': ' + what);

        return new Promise(function (resolve, reject) {
            var timer = after(timeout, function () {
                delete open[id];
                reject(new Error('"' + what + '" on ' + name + ' did not finish within '
                    + Math.round(timeout / 60000) + ' minutes.'));
            });

            open[id] = {
                vm: name,
                quiet: quiet,
                lines: [],
                settle: function (err, out) {
                    cancel(timer);
                    if (err) reject(err); else resolve(out);
                }
            };

            agent.write({ type: 'run', job: id, command: command, what: what });
        });
    }

    //---- what comes back ---------------------------------------------------

    function out(vm, msg) {
        var m = msg || {};
        var job = open[m.job];
        var text = m.text || '';

        //KEPT FOR THE CALLER, WITHHELD FROM THE LOG.
        if (job) job.lines.push(text);
        if (!(job && job.quiet)) say('vm', vm, 'guest').out(text);
        return !!job;
    }

    function done(vm, msg) {
        var m = msg || {};
        var job = open[m.job];
        var to = say('vm', vm, 'guest');

        if (m.code === 0) to.good('finished: ' + (m.what || 'command'));
        else to.bad('failed (' + m.code + '): ' + (m.what || 'command'));

        if (!job) return false;
        delete open[m.job];

        //A NON-ZERO CODE IS AN ANSWER, NOT A FAILURE OF THE CHANNEL. The command
        //ran and said no; the caller decides what that means.
        job.settle(null, { code: m.code, output: job.lines.join('\n') });
        return true;
    }

    //---- when the machine goes ---------------------------------------------
    //
    //REJECTING THE PENDING JOBS MATTERS AS MUCH AS CLOSING THE SOCKET. A job
    //whose machine has gone will never be answered, and without this it sat
    //until its timeout — so asking a destroyed machine to do something appeared
    //to HANG rather than to fail.
    function abandon(vm, why) {
        var abandoned = [];
        Object.keys(open).forEach(function (id) {
            if (open[id].vm !== vm) return;
            var job = open[id];
            delete open[id];
            abandoned.push(id);
            job.settle(new Error('"' + vm + '" ' + why + ', so the command was not finished.'));
        });
        return abandoned;
    }

    //FOR A TEST, AND FOR A LINE ABOUT A HOST THAT IS SHUTTING DOWN WITH WORK OUT.
    function waiting() {
        return Object.keys(open).map(function (id) { return { job: id, vm: open[id].vm }; });
    }

    return { run: run, out: out, done: done, abandon: abandon, waiting: waiting, GIVE_UP_AFTER: GIVE_UP_AFTER };
};

module.exports.GIVE_UP_AFTER = GIVE_UP_AFTER;
