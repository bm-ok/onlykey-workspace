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

plugin.consumes = ['app', 'log', 'secret', 'dataDir', 'ssh'];
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

    //---- AND THE KEY THIS APP USES TO REACH ITS OWN MACHINES --------------
    //
    //../core/ssh's, CONSUMED RATHER THAN REBUILT. It keeps the key beside the
    //TLS material and for the same reason — the two are one kind of thing, a
    //credential this app needs in order to BE ITSELF — and it owns the ssh
    //config as well, because a key nothing offers is a key VS Code Remote will
    //never use.
    //
    //THIS FILE HAD A SECOND COPY OF ALL OF IT. ../core/ssh was ported, tested,
    //and consumed by nobody, so it was invisible: a grep for the ACTION found
    //nothing and a grep for the SERVICE was never run. Two implementations of
    //the key machines are reached by is one that drifts, and the live key had
    //already been made by the wrong one.
    //
    //What is here is the pane's actions. What the key IS belongs one layer down.
    var ssh = imports.ssh;

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

    //---- and the other half of that exit -----------------------------------
    //
    //A PATH, NOT AN EXIT. `envForPush` hands the token to a child's environment;
    //this says which program reads it out again. Git asks a credential helper
    //for a username and password on stdout, and that is the ONLY way to
    //authenticate a push that does not put the secret somewhere another process
    //can read:
    //
    //  in the URL              https://TOKEN@github.com/… lands in .git/config,
    //                          in reflogs, and in every error message git prints
    //  in -c http.extraheader  the token is in argv, which anything running as
    //                          this user can read out of the process list
    //  the helper              the token is in the child's environment, inherited
    //                          from the process that spawned it, gone when it exits
    //
    //It is a filename and not a secret, so it is not in EXITS — but it only
    //means anything alongside `envForPush`, which is why it lives here rather
    //than in ../git. See ./credential-helper.js for why it answers `get` and
    //nothing else.
    var HELPER = path.join(__dirname, 'credential-helper.js');

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
        //---- THE APP'S OWN SSH KEY, AS THE Keys → SSH PANE ASKS FOR IT -------
        //
        //THE PANE WAS ALREADY THERE AND HAD NOTHING BEHIND IT — ./ssh.js calls
        //`sshKey` and `sshKeyMake`, and both fell through to the app being
        //ported from. So the pane was showing the OTHER app's key, and a machine
        //built here would have been authorised with it.
        undo.push(actions.define('sshKey', {
            about: "The key this app uses to reach the machines it made — its public half and fingerprint",
            run: async function () {
                var said = ssh.state();

                //---- AND WHICH MACHINES WOULD ACTUALLY ACCEPT IT -----------
                //
                //NOT THE SAME QUESTION AS WHETHER THE KEY EXISTS. A machine
                //built before this key — or with a different one named in the
                //dialog — does not have this one's public half in its
                //`authorized_keys`, and no amount of having a key changes that.
                //
                //SPLIT INTO TWO LISTS BECAUSE THEY LEAD TO DIFFERENT PLACES.
                //"Some machines will not accept it" is a sentence somebody has
                //to go and investigate; the NAMES are the investigation.
                //
                //AND IT IS NOT UNFIXABLE, which the app being ported from said
                //for a while and was wrong about: an agent runs on the machine
                //and executes what this host sends it, so the key can be put
                //there over the channel. That sentence stopped three machines
                //from having a working terminal for as long as it stood, so it
                //is not repeated here.
                var machines = [];
                try {
                    var list = await actions.call('vmList', {});
                    machines = (list && list.vms) || [];
                } catch (e) { /* no register reachable; the key is still the answer */ }

                //WHO WOULD ACCEPT IT IS ../core/ssh's ANSWER, not a comparison
                //made here. It is the same decision that puts `IdentityFile` in
                //a host block, and a pane that said "authorised" while the file
                //named no identity would be describing a machine nobody can
                //reach — in the one place somebody looks to find that out.
                var rows = machines.map(function (vm) {
                    var theirs = String((vm.spec && vm.spec.sshKey) || '').trim();
                    return {
                        name: vm.name,
                        authorised: ssh.readingOf(vm).usesOurKey,
                        //ENOUGH TO TELL TWO KEYS APART, and never a whole one.
                        builtWith: theirs ? theirs.split(' ').slice(0, 2).join(' ').slice(0, 28) + '…' : null
                    };
                });

                return Object.assign({}, said, {
                    machines: rows.filter(function (m) { return m.authorised; }),
                    strangers: rows.filter(function (m) { return !m.authorised; })
                });
            }
        }));

        //---- AND MAKING A NEW ONE, WHICH IS NOT A REPAIR --------------------
        //
        //A NEW KEY LOCKS OUT EVERY EXISTING MACHINE. The old public half is in
        //their `authorized_keys` and nothing here can reach in to change it, so
        //this is "start again with the machines" — said in the answer rather
        //than discovered by a machine that can no longer be logged into.
        //
        //The same shape as `tlsRegenerate`, and for the same reason.
        undo.push(actions.define('sshKeyMake', {
            about: 'Make a new ssh key — every machine built with the old one becomes unreachable',
            takes: ['force'],
            run: function (args) {
                var force = (args || {}).force === true || (args || {}).force === 'true';
                var out = ssh.make({ force: force });

                if (out.made && force) {
                    log.warn('A new ssh key was made. Every machine built with the old one can no '
                        + 'longer be logged into — they carry the old public half and nothing here '
                        + 'can reach in to change it.');
                }

                return Object.assign({}, ssh.state(), {
                    made: out.made,
                    note: out.made
                        ? 'A new key was made. Machines built before now carry the old one.'
                        : 'There was already a key; nothing was changed. Pass --force to make a new one.'
                });
            }
        }));

        //---- AND WHERE THAT KEY IS OFFERED FROM ----------------------------
        //
        //THE PANE ASKS FOR THIS — ./ssh.js calls `sshConfig` — and it was
        //relaying, so it showed the OTHER app's file.
        //
        //THE MACHINES COME FROM THE ACTION TABLE rather than from a consumed
        //service, deliberately: this plugin holds keys and has no business
        //knowing what a machine is. `vmList` is the same answer everything else
        //reads, and asking for it by name resolves at call time rather than
        //being an edge in the graph.
        undo.push(actions.define('sshConfig', {
            about: 'The ssh config this app writes, so its machines can be reached by name',
            takes: ['write'],
            run: async function (args) {
                var machines = [];
                try {
                    var said = await actions.call('vmList', {});
                    //HANDED OVER AS THEY COME. Where a machine IS and who to log
                    //in as is worked out inside ../core/ssh, because there are
                    //two callers and the other one — ../vms/provision on dial-in
                    //— passes raw register rows. Mapping it here meant every
                    //dial-in rewrote the file with no hosts in it.
                    machines = (said && said.vms) || [];
                } catch (e) { /* no register reachable; the paths are still worth showing */ }

                //WRITING IS ASKED FOR, NOT DONE ON EVERY READ. Drawing a pane
                //should not touch the operator's `~/.ssh/config`.
                var wrote = null;
                if ((args || {}).write === true || (args || {}).write === 'true') {
                    wrote = {
                        file: ssh.writeConfig(machines),
                        include: ssh.ensureInclude()
                    };
                }

                //WHAT THE PANE IS SHOWN. Names, aliases and paths — never a key.
                //`usesOurKey` per machine because "why does this one not take the
                //app's key" is the question this answers.
                //
                //READ BY ../core/ssh AND NOT HERE. This used to work out an
                //address and a user of its own, beside the one inside
                //`writeConfig` that decides what goes in the file — and two
                //readings of one register is how a pane says a machine is
                //reachable while the file it is describing says nothing about it.
                return {
                    file: ssh.where.config(),
                    include: ssh.where.user(),
                    lines: ssh.includeLines(),
                    hosts: machines
                        .map(ssh.readingOf)
                        .filter(function (h) { return h.address && h.user; })
                        .map(function (h) {
                            return {
                                name: h.name, alias: h.alias,
                                address: h.address, user: h.user,
                                usesOurKey: h.usesOurKey
                            };
                        }),
                    wrote: wrote
                };
            }
        }));

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
                //THE PROGRAM THAT READS WHAT envForPush WROTE. A path, not a
                //secret — see the block where it is defined.
                credentialHelper: HELPER,
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
            //---- AND THE APP'S OWN SSH KEY -----------------------------------
            //
            //NOT AN EXIT, AND THAT IS THE WHOLE DIFFERENCE. `EXITS` counts the
            //ways SOMEBODY ELSE'S secret can leave — a GitHub token this app was
            //handed. This key is the app's OWN, its public half is meant to be
            //given away (it goes into every guest's `authorized_keys`), and the
            //private half never leaves this object: what is offered is the
            //public key, a fingerprint, and a PATH.
            //
            //PASSED STRAIGHT THROUGH rather than wrapped, because it is not this
            //plugin's. ../core/ssh owns the key and the config; this plugin owns
            //the GitHub token and the Keys pane's actions. Anything else that
            //needs the key consumes `ssh` directly — ../vms/provision does.
            //
            //IT IS NOT AN EXIT EITHER WAY. `EXITS` counts the ways SOMEBODY
            //ELSE'S secret can leave — a GitHub token this app was handed. This
            //key is the app's own, its public half is MEANT to be given away,
            //and the private half is offered only as a path.
            ssh: ssh,

            //DECLARED SO IT CAN BE COUNTED. See the header, and the test.
            EXITS: EXITS
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
