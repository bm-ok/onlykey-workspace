var looksLike = require('./looks-like');

//the same sealing, seen from the app's node half.
//
//it is owned by ./main.js because that is where `dataDir` is and because a save
//must not change what a sealed file means. What arrives here is that same
//object, handed over on the host.
//
//REDACTION ANSWERS WHATEVER HAPPENS, and sealing does not. They are different
//kinds of thing and the fallback says so:
//
//  `redact` is a pure function over ./looks-like.js and needs nothing. A half
//  that could not redact would be a half that quietly stopped — so it is
//  required directly and always works, in every process, with or without a main
//  half behind it. This is the one service where a stand-in is BETTER than a
//  refusal, because the failure it prevents is a credential in a log.
//
//  `seal`/`open` touch DPAPI and the disk. There is no honest stand-in for
//  them: pretending to seal would write cleartext, and pretending to open would
//  hand back ciphertext as though it were a token. So without a main half they
//  refuse, loudly, naming what is missing.
//
//The test suite builds server halves against a bare host, which is exactly the
//case this shape is for.

plugin.consumes = ['app'];
plugin.provides = ['secret'];
async function plugin(imports, register) {
    var real = imports.app.host && imports.app.host.secret;

    if (real) return register(null, { secret: real });

    var nowhere = function (what) {
        return function () {
            throw new Error(
                'Nothing can ' + what + ' in this process — there is no main half behind it. '
                + 'A credential is not something to guess about: sealing without DPAPI would write cleartext, '
                + 'and opening without it would hand back ciphertext as though it were a token.');
        };
    };

    await register(null, {
        secret: {
            seal: nowhere('seal a credential'),
            open: nowhere('open a credential'),
            write: nowhere('keep a credential'),
            read: nowhere('read a credential'),
            //A FILE EITHER STARTS WITH THE MARK OR IT DOES NOT, which is a fact
            //about bytes rather than about DPAPI — so this one is answerable.
            isSealed: function () { return false; },
            redact: looksLike.redact,
            WINDOWS: process.platform === 'win32',
            MARK: 'okc-dpapi-v1:'
        }
    });
}
module.exports = plugin;
