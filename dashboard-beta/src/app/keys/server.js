var fs = require('node:fs');
var path = require('node:path');

//---------------------------------------------------------------------------
//WHAT THIS HOST HOLDS SO THAT NOTHING ELSE HAS TO.
//
//This is the only plugin that reads a credential off the disk. Everything else
//that needs one asks HERE, and what it gets back is a capability rather than a
//secret — the request signed, the environment for a child, the answer to "is
//there one". The token itself is a local variable inside this file for the
//length of one call and is never returned, logged, or put in an error.
//
//---- THE NAMED EXITS ------------------------------------------------------
//
//A boundary made of good intentions is not a boundary. So every way a secret can
//leave this plugin is in ONE list, `EXITS`, and ../../test/keys.test.js asserts
//the list matches what is actually callable. A new way out has to be added to
//the list, which means it has to be argued for in a diff.
//
//    sign(host, headers)   adds `authorization` to headers bound for `host`, and
//                          ONLY when `host` is the API host this token was kept
//                          for. The caller builds the request and never holds
//                          the string. Signing a request to anywhere else is
//                          refused rather than shrugged at: a token attached to
//                          a URL somebody else chose is a token given away.
//
//    envForPush()          {OKC_GIT_TOKEN} for a child process's environment.
//                          The one place a raw token has to exist as a value,
//                          because `git push` takes it that way and there is no
//                          version of this that does not. Returned as an object
//                          bound for `spawn` rather than a bare string, so the
//                          shape itself discourages logging it.
//
//THE APP BEING PORTED FROM HAS THIS DISCIPLINE ALREADY, enforced by a comment:
//"THE ONE PLACE THE TOKEN LEAVES THIS MODULE, and it is named so that it is
//obvious in a diff. Nothing else may call this, and nothing else does." That was
//true and it was true because nobody had broken it yet. This is the same rule
//with a test behind it.
//
//---- AND A RAW TOKEN NEVER PASSES THROUGH ../github ------------------------
//
//A token is checked against GitHub before it is kept, so that one which does not
//work never replaces one that does. That check is an API call and the API lives
//in ../github — which consumes THIS plugin, so consuming it back to do the check
//would be a cycle.
//
//SO THE CHECK IS AN ACTION LOOKUP RATHER THAN A GRAPH EDGE. `githubKeySet` lives
//here, writes the new token, and asks the action table for `githubCheck` by
//name. A lookup resolves at call time and is not an edge, so there is no cycle —
//and the pasted token goes from the dialog straight into the store and is read
//back from there. It is never a variable in ../github at all, which is a
//stronger claim than the app being ported from can make.
//---------------------------------------------------------------------------

var PUBLIC = 'api.github.com';

plugin.consumes = ['app', 'log', 'secret', 'dataDir'];
plugin.provides = ['keys'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('keys');
    var secret = imports.secret;

    //BESIDE THE OTHER CREDENTIALS AND NOT IN `state/`. ../core/state is for the
    //small things this app remembers; a sealed credential is not a document and
    //must not end up somewhere a future "let me just read all the state" walks.
    //ASKED FOR LAZILY, NOT AT BUILD TIME. ../core/datadir/server.js refuses when
    //there is no main half behind it — correctly, because a guessed path is
    //where a sealed credential goes to be lost — and the test suite builds
    //server halves against a bare host. Resolving here would turn a plugin that
    //merely CAN store a credential into one that cannot be loaded at all.
    var DIR = function () { return imports.dataDir.at('credentials'); };
    var FILE = function () { return path.join(DIR(), 'github.json'); };
    var ABOUT = function () { return path.join(DIR(), 'github-about.json'); };

    function about() {
        try { return JSON.parse(fs.readFileSync(ABOUT(), 'utf8')); } catch (e) { return {}; }
    }
    function remember(next) {
        try { fs.mkdirSync(DIR(), { recursive: true }); } catch (e) { /* it exists */ }
        //THE ANSWER STILL STANDS FOR THIS CALL if the note cannot be written.
        //Metadata failing to save is not a reason to refuse a working token.
        try { fs.writeFileSync(ABOUT(), JSON.stringify(Object.assign(about(), next), null, 2)); } catch (e) { /* not fatal */ }
    }

    function has() { return fs.existsSync(FILE()); }

    //READ ONLY WHERE IT IS USED, AND NEVER RETURNED. Every caller of this is in
    //this file and every one of them is an entry in EXITS.
    function token() { return secret.read(FILE()).toString('utf8').trim(); }

    function apiHost() { return about().api || PUBLIC; }

    //---- exit 1: signing ---------------------------------------------------
    //
    //THE HOST IS CHECKED, and that is what makes this an exit worth having
    //rather than `token()` with extra steps. A caller that builds a request to
    //somewhere else gets no header and a refusal saying why — so a bug in the
    //URL, or a redirect followed too far, cannot carry the credential off this
    //host. ../github follows redirects for reads; this is what stops that from
    //being a way out.
    function sign(toHost, headers) {
        if (!has()) {
            throw new Error('This host holds no GitHub token. Add one on the Keys tab; nothing here can reach GitHub until it has one.');
        }
        var want = apiHost();
        if (String(toHost) !== want) {
            throw new Error(
                'This token is kept for ' + want + ' and something asked to sign a request to "' + toHost + '". '
                + 'It is not signed. A credential attached to an address somebody else chose is a credential given away — '
                + 'if the API host has genuinely changed, change it where the token is kept.');
        }
        return Object.assign({}, headers || {}, { authorization: 'Bearer ' + token() });
    }

    //---- exit 2: a child's environment -------------------------------------
    //
    //THE ONE PLACE A RAW TOKEN HAS TO BE A VALUE. `git push` reads it from the
    //environment and there is no version of this that does not. Handed back as
    //an object bound for `spawn`'s `env` rather than as a string, so the shape
    //itself is awkward to log — and never as an argument, never in a URL, never
    //onto disk.
    function envForPush() {
        if (!has()) {
            throw new Error('This host holds no GitHub token, so nothing can be pushed onward. Add one on the Keys tab.');
        }
        return { OKC_GIT_TOKEN: token() };
    }

    //EVERY WAY A SECRET CAN LEAVE, IN ONE LIST. The test asserts this matches
    //what the service actually offers, so a new way out cannot be added quietly.
    var EXITS = ['sign', 'envForPush'];

    //---- what is known ABOUT it, which is not it ---------------------------
    function held() {
        if (!has()) return { held: false, api: apiHost() };
        var meta = about();
        var stat = null;
        try { stat = fs.statSync(FILE()); } catch (e) { /* it was there a line ago */ }

        return {
            held: true,
            api: meta.api || PUBLIC,
            login: meta.login || null,
            name: meta.name || null,
            kind: meta.kind || null,
            scopes: meta.scopes || [],
            ok: meta.ok === undefined ? null : meta.ok,
            expires: meta.expires || null,
            added: meta.added || (stat ? stat.mtime.toISOString() : null),
            checked: meta.checked || null,
            sealed: secret.isSealed(FILE()),
            protection: secret.isSealed(FILE())
                ? 'encrypted for this Windows account — the file alone is not enough'
                : 'file permissions only — readable by anything running as you'
        };
    }

    function put(raw, meta) {
        var clean = String(raw == null ? '' : raw).trim();
        if (!clean) throw new Error('Nothing was given, so there is nothing to keep.');
        try { fs.mkdirSync(DIR(), { recursive: true }); } catch (e) { /* it exists */ }
        var sealed = secret.write(FILE(), Buffer.from(clean, 'utf8'));
        remember(Object.assign({ added: new Date().toISOString() }, meta || {}));
        //WHAT IS SAID IS THAT SOMETHING HAPPENED, never what. See ../../CLAUDE.md
        //and the standing rule this whole plugin is built to.
        log.warn('a GitHub token was kept' + (sealed ? ', sealed for this account' : ', with file permissions only'));
        return { sealed: sealed };
    }

    function forget() {
        var was = has();
        try { fs.unlinkSync(FILE()); } catch (e) { /* already gone */ }
        try { fs.unlinkSync(ABOUT()); } catch (e) { /* may never have existed */ }
        if (was) log.warn('the GitHub token was thrown away');
        return was;
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('githubHeld', {
            about: 'What is known about the GitHub token this host holds — never the token',
            run: function () {
                var now = held();
                return Object.assign({}, now, {
                    note: now.held
                        ? null
                        : 'No GitHub token is kept by this app. Nothing here can push a branch onward or open a pull request until one is added at the window.'
                });
            }
        }));

        //---- kept, sealed, and checked before it is believed ---------------
        //
        //VERIFIED BEFORE IT REPLACES ANYTHING. A token that does not work must
        //not evict one that does, and finding that out afterwards is how
        //somebody ends up with neither.
        //
        //THE CHECK IS AN ACTION LOOKUP, NOT A GRAPH EDGE, and that is what keeps
        //the raw token out of ../github entirely. Checking means asking GitHub,
        //which is ../github's job — but ../github consumes THIS plugin, so
        //consuming it back would be a cycle. Asking the table by name at the
        //moment of use is not an edge: it resolves at call time, it works
        //whether or not that half is loaded, and the pasted token goes from the
        //dialog straight into the store and is read back from there.
        //
        //WRITE, CHECK, PUT BACK EXACTLY WHAT WAS THERE — including nothing.
        undo.push(actions.define('githubKeySet', {
            about: 'Keep a GitHub token, after checking it against GitHub. A person, at the window',
            takes: ['token', 'api'],
            run: async function (args) {
                var a = args || {};
                var value = String(a.token == null ? '' : a.token).trim();
                if (!value) throw new Error('Paste a GitHub token.');
                //WHITESPACE MEANS SOMETHING WENT WRONG IN THE COPYING, and
                //saying so beats a rejection from GitHub two seconds later.
                if (/\s/.test(value)) throw new Error('That has whitespace in it, so it is not a token — check what was copied.');

                var was = has() ? fs.readFileSync(FILE()) : null;
                var wasAbout = about();
                //WHETHER THERE WERE NOTES AT ALL, which is not the same question
                //as what they said. Rolling back by writing `wasAbout` leaves
                //`{}` on disk where there had been no file — an empty document
                //and no document are different answers, and the app being ported
                //from leaves that `{}` behind after every rejected token.
                var hadNotes = fs.existsSync(ABOUT());

                try { fs.mkdirSync(DIR(), { recursive: true }); } catch (e) { /* it exists */ }
                var sealed = secret.write(FILE(), Buffer.from(value, 'utf8'));
                remember({ api: a.api ? String(a.api).trim() : (wasAbout.api || PUBLIC), added: new Date().toISOString() });

                try {
                    var said = await actions.call('githubCheck', {});
                    if (!said || !said.ok) throw new Error((said && said.why) || 'GitHub did not accept it.');
                    log.warn('a GitHub token was kept' + (sealed ? ', sealed for this account' : ', with file permissions only'));
                    return Object.assign({ held: true, sealed: sealed }, said, {
                        note: 'Kept. GitHub knows it as ' + said.login + (said.expires ? ', expiring ' + said.expires : '') + '.'
                    });
                } catch (e) {
                    if (was) fs.writeFileSync(FILE(), was);
                    else { try { fs.unlinkSync(FILE()); } catch (e2) { /* it was never written */ } }
                    if (hadNotes) {
                        try { fs.writeFileSync(ABOUT(), JSON.stringify(wasAbout, null, 2)); } catch (e2) { /* best effort */ }
                    } else {
                        try { fs.unlinkSync(ABOUT()); } catch (e2) { /* it was never written */ }
                    }
                    throw new Error('That token was not kept: ' + e.message);
                }
            }
        }));

        undo.push(actions.define('githubKeyForget', {
            about: 'Throw the GitHub token away. It is not revoked on GitHub',
            run: function (args) {
                //NOT GUARDED AGAINST THE PIPE, and that is deliberate. Throwing
                //a credential away is the SAFE direction: the worst it costs is
                //adding it again, and a guard here would mean something that
                //believed a token was compromised could not get rid of it.
                //Adding one is the press that needs a person, and that is on the
                //dialog in ./github.js.
                var was = forget();
                return {
                    gone: was,
                    note: was
                        ? 'Gone from this host. It is NOT revoked on GitHub — if it may have been seen by anything, revoke it there as well; deleting a copy is not the same as ending a credential.'
                        : 'There was none to throw away.'
                };
            }
        }));
    }

    await register(null, {
        keys: {
            github: {
                //---- capabilities ------------------------------------------
                sign: sign,
                envForPush: envForPush,
                //---- facts, which are not the secret -----------------------
                has: has,
                held: held,
                apiHost: apiHost,
                PUBLIC: PUBLIC,
                //---- keeping it --------------------------------------------
                //`put` is called by ../github after it has checked the token
                //against GitHub — see the header for why it is not an action
                //here. `remember` is how that check's answer gets recorded.
                put: put,
                forget: forget,
                remember: remember,
                //WHERE IT IS, so a pane can say so. The path is not a secret;
                //what is in it is.
                where: function () { return FILE(); }
            },
            //DECLARED SO IT CAN BE COUNTED. See the header, and the test.
            EXITS: EXITS
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
