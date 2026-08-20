var crypto = require('crypto');

//---------------------------------------------------------------------------
//what one connection is allowed to say, and when.
//
//SPLIT OUT OF ./main.js SO IT CAN BE DRIVEN. Everything else in that file needs
//a real socket bound to a real address, and there is exactly one of those on this
//machine — the running app's. A test that bound it would either fail or, worse,
//take the app's own pipe. This half needs neither: hand it something with
//`write` and `end` on it and it behaves exactly as it does on the wire.
//---------------------------------------------------------------------------

//TIMING-SAFE, AND THE LENGTH CHECKED FIRST BECAUSE IT HAS TO BE.
//`crypto.timingSafeEqual` THROWS on a length mismatch rather than answering
//false, so handing it a short greeting is not a failed comparison — it is an
//exception on the connection handler, which is a way to take the app down by
//sending it three characters.
//
//The length is not a secret. Everything about this token's shape is in the file
//next door; what is secret is the value, and that is what is compared without a
//shortcut.
function sameSecret(given, real) {
    //NO SECRET MEANS NOTHING IS ACCEPTED, NOT THAT EVERYTHING IS. Two empty
    //buffers are equal, and timingSafeEqual says so — so without this line a
    //connection built with no token would take an empty greeting and hand over
    //the table. Nothing constructs it that way today, because the token is
    //always 32 random bytes; this is here so that stops being load-bearing.
    if (real == null || String(real) === '') return false;

    var a = Buffer.from(String(given == null ? '' : given), 'utf8');
    var b = Buffer.from(String(real == null ? '' : real), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

//ONE CONNECTION. Nothing reaches `run` until the greeting has been accepted, and
//a connection that gets the greeting wrong is answered once and closed — leaving
//it open would let one connection be guessed at for as long as it likes.
//
//SAID THE SAME WAY WHATEVER WENT WRONG. Missing, malformed, wrong, or the right
//length and still wrong all get the one sentence, because telling them apart is
//telling a caller which half of the guess was right.
function connection(socket, opts) {
    var token = opts.token;
    var refused = opts.refused;
    var run = opts.run;

    var buf = '';
    var trusted = false;

    function say(obj) {
        try { socket.write(JSON.stringify(obj) + '\n'); } catch (e) { /* gone */ }
    }

    function greet(line) {
        var req;
        try { req = JSON.parse(line); } catch (e) { req = null; }

        if (!req || !sameSecret(req.auth, token)) {
            say({ id: req && req.id != null ? req.id : null, ok: false, error: refused });
            socket.end();
            return false;
        }

        trusted = true;
        say({ id: req.id == null ? null : req.id, ok: true, result: { authed: true } });
        return true;
    }

    return {
        get trusted() { return trusted; },
        data: function (chunk) {
            buf += chunk;
            var cut;
            while ((cut = buf.indexOf('\n')) >= 0) {
                var line = buf.slice(0, cut);
                buf = buf.slice(cut + 1);
                if (!line.trim()) continue;
                if (!trusted) {
                    //A REFUSED GREETING ENDS THE CONVERSATION, INCLUDING ANYTHING
                    //ALREADY IN THE BUFFER. A client that pipelines its command
                    //behind its greeting — which ours does — has already sent the
                    //next line by the time this is read, and running it would
                    //make the refusal decorative.
                    if (!greet(line)) return;
                } else {
                    run(line, say);
                }
            }
        }
    };
}

module.exports = { sameSecret: sameSecret, connection: connection };
