//---------------------------------------------------------------------------
//THE HANDOVER ITSELF, IN TWO ROUND TRIPS.
//
//THE RUNNER IS PASSED IN rather than required, so this file knows nothing about
//machines and a test can hand it anything that runs a command. That is what lets
//"nothing sent carries the value" be asked of the real path: the commands are
//not composed in a test, they are composed here and recorded on the way past.
//
//---- the guest half is SENT, not installed --------------------------------
//
//It could be provisioned — but then a machine built last month runs last month's
//half of a protocol this file changed today, and the failure is a decryption
//error on a machine at two in the morning. Sending it makes version skew
//impossible by construction, and it is four kilobytes of code that is not a
//secret.
//---------------------------------------------------------------------------

var sealing = require('./sealing');

var NEWLINE = String.fromCharCode(10);

//BASE64 HAS NO SHELL METACHARACTER IN IT, which is why every one of these is
//quoted and none of them is escaped.
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

var PUT_THE_HALF = 'mkdir -p "$HOME/.okc" && printf %s \'<b64>\' | base64 -d > "$HOME/.okc/credential.js"';

//A KEY IS RECOGNISABLE, so it is MATCHED rather than sliced: what comes back has
//this app's own framing around it, and a guest shell prints things nobody asked
//for.
var A_KEY = /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/;
var PLACED = /okc-credential-placed ([0-9a-f]{16})/;

module.exports = function deliver(deps) {
    var d = deps || {};

    //THE GUEST'S HALF, read once at load by ./payload — a missing one must be a
    //startup failure and not a surprise at the moment a machine is waiting.
    var guestHalf = d.guestHalf;

    async function toTheMachine(what) {
        var it = what || {};
        var run = it.run;
        var text = it.text;
        var andThen = it.andThen || '';

        //STEP ONE: THE GUEST SPEAKS FIRST. It makes the pair, keeps the private
        //half, and prints the public one. NOTHING SECRET HAS BEEN SENT YET —
        //there is nothing to send until it has answered.
        var begin = await run(
            'set -u' + NEWLINE
                + PUT_THE_HALF.replace('<b64>', b64(guestHalf())) + NEWLINE
                + 'node "$HOME/.okc/credential.js" begin',
            { what: it.what || 'asking it for a key to hand a credential over with', timeout: 60000 });

        var pub = (String((begin && begin.output) || '').match(A_KEY) || [])[0];
        if (!pub) {
            throw new Error('It would not make a key to receive a credential with, so nothing was sent. '
                + 'It said: ' + String((begin && begin.output) || '').trim().slice(-300));
        }

        //STEP TWO: SEALED TO THAT KEY AND NOTHING ELSE. If the machine that
        //answered is not the machine this reaches — which the channel already
        //prevents — what arrives is bytes that will not open.
        var sealed = sealing.sealFor(pub, text);

        //ON STDIN. The sealed reply is not a secret and would come to no harm in
        //a command line, but the guest half reads stdin and teaching the other
        //habit is how the next thing to be handed over ends up in argv.
        var done = await run(
            'printf %s \'' + b64(JSON.stringify(sealed)) + '\' | base64 -d | '
                + 'node "$HOME/.okc/credential.js" finish' + NEWLINE + andThen,
            { what: 'handing the credential over, sealed to the key it just made', timeout: 60000 });

        var said = String((done && done.output) || '');
        var placed = said.match(PLACED);
        if (!placed) throw new Error('It did not take the credential: ' + said.trim().slice(-300));

        return {
            //THE FINGERPRINT IT ENDED UP WITH, compared by the caller against
            //the one this host sealed. Sixteen hex characters of sha256 — it
            //says "the same one" without either side printing the thing itself.
            fingerprint: placed[1],
            output: said,
            //AND WHAT THE COMMAND EXITED WITH, carried through rather than
            //dropped. The caller writes down what a machine found out about a
            //credential, and "it ran and answered no" is a different fault from
            //"it never ran". Only the number tells those apart, and this is the
            //one place it is known.
            code: (done && done.code) === undefined ? null : done.code
        };
    }

    return { toTheMachine: toTheMachine };
};
