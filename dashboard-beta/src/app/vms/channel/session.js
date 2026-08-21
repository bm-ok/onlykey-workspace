var makeFraming = require('./framing');

//---------------------------------------------------------------------------
//ONE SOCKET, FROM THE FIRST BYTE TO WHATEVER ENDED IT.
//
//SEPARATE FROM THE LISTENER because everything interesting about a connection
//happens after it is accepted, and none of it needs TLS to be checked. What is
//left in ../channel/server.js is the three lines of node that make a server.
//---------------------------------------------------------------------------

//WHAT A DIALLED-IN MACHINE CAN SAY. Deliberately little: it reports output and
//results, and everything about WHAT TO RUN lives on this side. A guest is never
//asked what it would like to do.
module.exports = function session(socket, deps) {
    var d = deps || {};
    var say = d.say || function () { return { warn: function () {}, info: function () {}, out: function () {} }; };
    var roster = d.roster;
    var jobs = d.jobs;

    var from = d.from || (socket.remoteAddress + ':' + socket.remotePort);
    var frames = makeFraming();
    var vm = null;

    function write(msg) {
        if (!socket.destroyed) socket.write(frames.line(msg));
    }

    //A GOODBYE IS SENT BEFORE THE SOCKET GOES. A guest that is simply cut off
    //cannot tell being refused from the network breaking, and the two want very
    //different things done about them.
    function goodbye(why) {
        say('channel').warn(from + ': ' + why);
        write({ type: 'bye', why: why });
        socket.destroy();
    }

    function handle(msg) {
        if (msg.type === 'out') return jobs.out(vm, msg);
        if (msg.type === 'done') return jobs.done(vm, msg);
        if (msg.type === 'say') return say('vm', vm, 'guest').out(msg.text || '');
        if (msg.type === 'beat') return roster.beat(vm, msg);

        //ANYTHING ELSE IS RECORDED RATHER THAN IGNORED, and truncated because a
        //guest decides how long it is.
        say('vm', vm, 'guest').info(JSON.stringify(msg).slice(0, 400));
    }

    socket.on('data', function (chunk) {
        var got = frames.take(String(chunk));

        for (var i = 0; i < got.messages.length; i++) {
            var msg = got.messages[i];

            //NOTHING IS ACCEPTED BEFORE A VALID HELLO, so an unauthenticated
            //socket can do exactly one thing: be closed.
            if (!vm) {
                var said = roster.hello(msg, {
                    from: from,
                    write: write,
                    close: function () { socket.destroy(); }
                });
                if (said.fault) return goodbye(said.fault);

                vm = said.vm;
                write({ type: 'hi' });
                continue;
            }

            //ANYTHING AT ALL COUNTS AS A SIGN OF LIFE, not only a beat.
            roster.seen(vm);
            handle(msg);
        }

        //THE FAULT IS DEALT WITH AFTER THE GOOD MESSAGES BEFORE IT, because they
        //arrived and they are the last thing the machine managed to say — which
        //is usually the interesting part of why it then said something broken.
        if (got.fault) return goodbye(got.fault);
    });

    //---- why it went ------------------------------------------------------
    //
    //BOTH ENDINGS ONCE ARRIVED HERE AS THE SAME THREE WORDS — "hung up" — so a
    //machine that rebooted, a machine whose network died, and a connection reset
    //by something in between were one event with one description. Chasing a
    //channel that dropped the instant any command started, the two ends each
    //reported the other closing first and neither could be believed, because the
    //one place that knew the difference was throwing it away.
    //
    //WHICH EVENT CAME FIRST IS THE WHOLE DIAGNOSIS.
    //
    //`end` means the far end sent FIN: the machine closed, and this side is only
    //noticing. `error` means the connection broke. `close` on its own means THIS
    //side closed it, which is the answer nobody had.
    var why = null;
    socket.on('end', function () { why = why || 'the machine closed it'; });
    socket.on('error', function (err) {
        why = why || 'error: ' + ((err && (err.code || err.message)) || 'unknown');
    });

    function gone() {
        //NOT AN ERROR: a machine rebooting looks exactly like this, and it will
        //be back. Through drop, so anything waiting on it is told rather than
        //left waiting.
        if (!vm) return;

        //AND ONLY IF THIS SOCKET IS STILL THE ONE. A machine that reconnected
        //already replaced this session; the old socket closing afterwards must
        //not drop the new connection.
        var agent = roster.get(vm);
        if (!agent || agent.write !== write) return;

        roster.drop(vm, why
            ? 'hung up — ' + why
            : 'hung up — this side closed it, and nothing here said why');
    }
    socket.on('close', gone);
    socket.on('error', gone);

    return { from: from, write: write, whoIsIt: function () { return vm; } };
};
