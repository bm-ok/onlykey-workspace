//---------------------------------------------------------------------------
//THE CLAUDE IDENTITIES THIS HOST HOLDS, one per name.
//
//A "guest" is a Claude Code sign-in kept here: a name somebody chose, and a
//token sealed beside it. It is not a machine and it is not a person — it is the
//thing a machine is LENT so a worker on it can authenticate, and the thing a
//supervisor uses when the supervisor is a model rather than somebody typing.
//
//WHY A LIST AND NOT A FILE. There was one credential, lent to whoever was
//working. That is enough while one machine works at a time and wrong the moment
//two do: the Claude CLI refreshes the token as it runs, so two machines sharing
//one sign-in are two workers rotating the same credential underneath each other.
//One per machine needs somewhere for several to live, and this is that place.
//
//SEALED, AND NEVER READ BY ANYTHING THAT REPORTS. ../../core/secret seals each
//token to this Windows account; everything below hands back a name, a date, a
//fingerprint and a holder, and nothing hands back a value. `token()` is the one
//exception and exists for exactly one caller — the handover that puts a
//credential on a machine.
//
//ONE FOLDER, ONE FILE PER GUEST, named after the guest. Not a single JSON file
//holding every token: a sealed blob per identity means one going bad cannot take
//the others with it, and removing one is deleting a file rather than rewriting a
//list.
//
//A SECOND STORE WOULD BE THE FAULT THIS FILE EXISTS TO FIX. One credential in
//the Keys tab and another somewhere else is how one of them goes stale
//unnoticed; making a separate file for supervisors would recreate that on the
//day it was fixed. Three roles, one list — see ./lending for why they differ.
//
//---- the named exit, and why there has to be one ---------------------------
//
//THE SECOND CREDENTIAL STORE IN THIS APP, and ../../keys is the first. That rule
//was written as "only keys/ opens a sealed file", which was true while the only
//credential was a GitHub token — and a GitHub token never has to LEAVE this
//host, so keys hands out capabilities instead: the request signed, the
//environment for a child.
//
//A CLAUDE SIGN-IN IS NOT THAT KIND OF SECRET. It has to arrive, as bytes, on a
//machine that is not this one, because that is where the worker runs. There is
//no capability form of "be signed in on another computer", so the honest thing
//is a door rather than a pretence that there is not one.
//
//SO IT IS THE SAME DISCIPLINE, NOT AN EXEMPTION. Every way a token can leave is
//in `EXITS`, and ../../../test/runners/guests-boundary.test.js asserts the list
//matches what is actually callable AND that nothing else on this service hands
//one back. A new way out has to be added to the list, which means it has to be
//argued for in a diff.
//
//    token(name)   the sealed credential, opened, as a string. For the handover
//                  that puts it on a machine and for nothing else. Everything
//                  that REPORTS goes through all(), which cannot reach it.
//
//---- what is NOT here ------------------------------------------------------
//
//THE MIGRATION FROM THE SINGLE CREDENTIAL FILE. `adoptTheOldOne` moved a token
//from the shape that came before the list. This app's state lives in its own
//folder and starts empty, so there is no old one to adopt — porting it would be
//porting a door onto a wall.
//---------------------------------------------------------------------------

//EVERY WAY A TOKEN CAN LEAVE. A boundary made of good intentions is not a
//boundary; this one has a test behind it.
var EXITS = ['token'];

var fs = require('fs');
var path = require('path');

var shape = require('./shape');
var lending = require('./lending');

module.exports = function store(deps) {
    var d = deps || {};

    //A THUNK, NOT A PATH. Asking the data directory where to write at build time
    //makes every test that loads this file create a folder, and makes the answer
    //a copy of where things were when the module was first required.
    var dir = d.dir;
    var secret = d.secret;

    //WHICH SUPERVISOR SIGN-IN IS CHOSEN. A setting somewhere else, and this is
    //the one place that turns a name into an identity to use.
    var chosen = d.chosen || function () { return null; };

    var now = d.now || function () { return new Date().toISOString(); };

    function root() { return dir(); }
    function record() { return path.join(root(), 'guests.json'); }
    function fileFor(name) { return path.join(root(), name + '.json'); }

    function read() {
        try {
            var all = JSON.parse(fs.readFileSync(record(), 'utf8'));
            return Array.isArray(all) ? all : [];
        } catch (e) { return []; }
    }

    function write(all) {
        try { fs.mkdirSync(root(), { recursive: true }); } catch (e) { /* it exists */ }
        fs.writeFileSync(record(), JSON.stringify(all, null, 2), 'utf8');
        return all;
    }

    //---- what is here ------------------------------------------------------
    //
    //NEVER THE TOKEN. Everything else about a guest is safe to show, and this is
    //the shape every caller gets — the window, the command line and a drill.
    function all() {
        return read().map(function (g) {
            return {
                name: g.name,
                role: shape.roleFrom(g.role),
                added: g.added,
                from: g.from || null,
                //READ FROM THE FILE rather than trusted from the record, so a
                //guest whose file has been removed by hand says so instead of
                //claiming a token.
                has: fs.existsSync(fileFor(g.name)),
                fingerprint: g.fingerprint || null,
                //WHEN THE TOKEN ITSELF LAST CHANGED. Written by backFrom and
                //only when the fingerprint actually differs, so this moves when
                //the credential is a DIFFERENT credential and at no other time —
                //not when it is lent, checked, relabelled or handed back
                //unchanged.
                //
                //`added` SAYS HOW OLD THE RECORD IS AND THIS SAYS HOW OLD THE
                //SECRET IS, and after a rotation those are months apart. It was
                //being recorded and then dropped by this projection, so the row
                //the window has always had for it could never draw.
                refreshed: g.refreshed || null,
                //WHO IT IS, never what it can do.
                account: g.account || null,
                plan: g.plan || null,
                lastGiven: g.lastGiven || null,
                lastGivenTo: g.lastGivenTo || null,
                holder: g.holder || null,
                //WHAT A MACHINE LAST FOUND OUT, and whether that was good news.
                //Null until one has been tried — "never checked" and "checked
                //and dead" are different, and only one is a reason to sign in
                //again.
                lastCheck: g.lastCheck || null,
                note: g.note || null
            };
        });
    }

    function get(name) {
        return all().filter(function (g) { return g.name === name; })[0] || null;
    }

    //---- adding and removing -------------------------------------------------

    function add(what) {
        var it = what || {};
        var name = it.name;

        if (!shape.okName(name)) {
            throw new Error('"' + name + '" is not a name for a guest. Letters, digits, dash, dot and '
                + 'underscore, up to 64 — it is a filename and a label in a list, so it is refused rather '
                + 'than changed into something you would not recognise.');
        }

        //A CREDENTIAL IS JSON, AND SOMETHING ON THE WAY HERE MAY HAVE PARSED IT.
        //
        //The command line does: `--token '{"claudeAiOauth":...}'` arrives as an
        //object, because that is what makes `--vm '{...}'` work. This used to be
        //String(token), which turns an object into the fourteen characters
        //"[object Object]" — and then seals them, records a fingerprint of them,
        //and reports the guest as added. The credential is gone at that point,
        //and the way you find out is a machine answering "not signed in" weeks
        //later.
        //
        //Found by handing a machine one and reading back what landed. The
        //handover was right: it delivered exactly what this host held, which was
        //"[object Object]".
        var token = it.token;
        var text = (token && typeof token === 'object' ? JSON.stringify(token) : String(token || '')).trim();

        if (!text) {
            throw new Error('A guest needs a Claude token. It is sealed to this account and never shown again.');
        }
        if (text === '[object Object]') {
            throw new Error('That token arrived as the words "[object Object]" rather than as a credential — '
                + 'something turned an object into a string on the way here. Nothing was kept; paste the '
                + 'contents of .credentials.json.');
        }
        if (get(name)) {
            throw new Error('There is already a guest called "' + name + '". Remove it first, or pick '
                + 'another name — replacing one silently would take a credential away from whatever is '
                + 'using it.');
        }

        try { fs.mkdirSync(root(), { recursive: true }); } catch (e) { /* it exists */ }
        var sealed = secret.write(fileFor(name), Buffer.from(text, 'utf8'));

        write(read().concat([{
            name: name,
            //ONE NAMESPACE ACROSS ALL THREE ROLES, because all three are
            //filenames in one folder and a supervisor called the same thing as a
            //worker would be one file.
            role: shape.roleFrom(it.role === undefined ? 'worker' : it.role),
            added: now(),
            from: it.from || null,
            note: it.note || null,
            fingerprint: shape.fingerprint(text),
            //WHOEVER THIS TURNED OUT TO BE, when the sign-in said. Null for
            //every sign-in made before this was kept, which reads as "not
            //recorded" rather than as "no account".
            account: it.account || null,
            plan: shape.planOf(text),
            sealed: sealed,
            lastGiven: null,
            lastGivenTo: null,
            holder: null
        }]));

        return get(name);
    }

    function forget(name) {
        var g = get(name);
        if (!g) throw new Error('There is no guest called "' + name + '".');
        if (g.holder) {
            throw new Error('"' + name + '" is on ' + g.holder + ' right now. Take it back first — '
                + 'removing it here would leave a credential on a machine with nothing on this host '
                + 'knowing it is there.');
        }

        try { fs.rmSync(fileFor(name), { force: true }); } catch (e) { /* already gone */ }
        write(read().filter(function (x) { return x.name !== name; }));
        return { gone: name };
    }

    //---- the one caller that gets a value -------------------------------------
    //
    //THE HANDOVER, AND NOTHING ELSE. Everything that REPORTS goes through all()
    //and cannot reach this.
    function token(name) {
        if (!get(name)) throw new Error('There is no guest called "' + name + '".');
        return secret.read(fileFor(name)).toString('utf8');
    }

    //---- what a machine found out about it -------------------------------------
    //
    //A credential's own dates say when its refresh token expires, and that is not
    //the same as it working: a refresh ROTATES the token, so a copy taken before
    //another machine refreshed is already superseded while still looking fine.
    //The only proof is a worker being handed it and reporting whether it can
    //authenticate.
    //
    //KEPT AGAINST THE ONE THAT WAS ACTUALLY TRIED. In the single-credential shape
    //this recorded that SOMETHING was bad and could not say which, which is the
    //same as not knowing.
    function checked(name, said) {
        var it = said || {};
        if (it.ready === null || it.ready === undefined) return get(name);

        var rows = read();
        var i = index(rows, name);
        if (i < 0) return null;

        //WHAT IS ALREADY KNOWN, and whether this is allowed to overturn it. See
        //./shape.mayOverturn — a probe may condemn a credential and may not
        //absolve one.
        if (!shape.mayOverturn(rows[i].lastCheck || null, it.ready === true, it.how || 'probe')) {
            //NOT RECORDED, AND THE FAILURE STANDS. Nothing is thrown: placing a
            //credential is allowed to succeed, and this is only about what the
            //record is permitted to conclude from it.
            return get(name);
        }

        rows[i] = Object.assign({}, rows[i], {
            lastCheck: {
                ready: !!it.ready,
                how: it.how || 'probe',
                on: it.on || null,
                at: it.at || now(),
                //WHAT THE MACHINE SAID, kept whole. "It failed" is a state; the
                //sentence is the diagnosis, and an OAuth session that expired
                //wants a different thing done about it than a worker that could
                //not read the file.
                why: it.why || null,
                //AND WHAT THE COMMAND EXITED WITH — a different kind of clue from
                //the words, and the half that is never ambiguous. Kept even when
                //it is zero, because "it ran fine and said no" is a real answer
                //and is not the same as "it never ran".
                code: it.code === null || it.code === undefined ? null : Number(it.code)
            }
        });

        write(rows);
        return get(name);
    }

    //---- what an identity is FOR can change, and the token does not move --------
    //
    //A worker and a judge sign-in are the same object: a name and a sealed token.
    //What separates them is which machines may hold one, which is a decision
    //about this host rather than a property of the credential. So changing it is
    //a LABEL change — nothing is re-sealed, nothing is re-read, and the
    //fingerprint is the same afterwards, which is how you can tell it was a
    //relabelling and not a replacement.
    //---- LETTING A PAUSED ONE BE LENT AGAIN ------------------------------
    //
    //THE PAUSE IS CLEARED, NOT OVERWRITTEN WITH A PASS. `lastCheck` is what a
    //MACHINE established, and nothing here tested anything — writing
    //`ready: true` would be this host claiming a result it does not have. The
    //record goes back to "nobody has checked", which is what is true.
    //
    //WHY IT WAS LET GO IS KEPT, because the sentence that paused it is about to
    //stop being visible and somebody will want to know what was overruled.
    function resume(name, why) {
        var rows = read();
        var i = index(rows, name);
        if (i < 0) return null;

        var was = rows[i].lastCheck || null;
        rows[i] = Object.assign({}, rows[i], {
            lastCheck: null,
            letGo: {
                at: now(),
                why: why || null,
                //WHAT IT WAS PAUSED FOR, carried onto the record so the history
                //is not lost with the flag.
                over: was && was.why ? String(was.why).slice(0, 400) : null
            }
        });
        write(rows);
        return get(name);
    }

    function roleOf(name, want) {
        var rows = read();
        var i = index(rows, name);
        if (i < 0) throw new Error('There is no sign-in called "' + name + '".');

        var to = String(want || '').toLowerCase();
        if (!shape.isRole(to)) {
            //THE LIST COMES FROM ./shape.js RATHER THAN BEING TYPED HERE. A
            //sentence naming three roles beside a check that allows four is a
            //refusal that argues with itself — and the reader believes the
            //sentence, because that is the part they can see.
            throw new Error('"' + want + '" is not a role. A sign-in is one of: ' + shape.ROLES.join(', ')
                + ' — which decides the kind of machine it may be lent to.');
        }

        var was = shape.roleFrom(rows[i].role);
        if (was === to) return get(name);

        //NOT WHILE IT IS OUT. A sign-in on a machine was lent under the rule that
        //the roles match; changing it underneath would leave a judge machine
        //holding a worker's identity with nothing having been refused.
        if (rows[i].holder) {
            throw new Error('"' + name + '" is out on ' + rows[i].holder + ', so what it is for cannot '
                + 'change right now. It was lent under the rule that a machine holds a sign-in of its own '
                + 'kind, and changing it underneath would leave that machine holding the wrong one. Take '
                + 'it back first with guestBack.');
        }

        //AND NOT THE ONE THE SUPERVISOR IS SET TO USE. Moving the identity out
        //from under it would leave the supervisor pointing at a sign-in it may no
        //longer hold — discovered the next time it was woken, which is the worst
        //moment to find out.
        if (was === 'supervisor' && chosen() === name) {
            throw new Error('"' + name + '" is the sign-in the supervisor is set to use, so it cannot stop '
                + 'being a supervisor. Choose another one first on the Runners tab.');
        }

        rows[i] = Object.assign({}, rows[i], { role: to });
        write(rows);
        return get(name);
    }

    //---- lending it out, and taking it back --------------------------------------
    //
    //ENFORCED AT THE ONE POINT THAT RECORDS A MACHINE HOLDING SOMETHING, rather
    //than at each of the several places that hand one over. See ./lending.
    function lentTo(name, machine, how) {
        var it = how || {};
        var rows = read();
        var i = index(rows, name);
        if (i < 0) throw new Error('There is no guest called "' + name + '".');

        //`kind` MAY BE A LIST, because a machine may be a worker and a judge at
        //once. The boolean is still read for callers that predate three roles.
        var on = it.kind || (it.supervisor ? 'supervisor' : 'worker');
        var why = lending.whyNotOn(shape.roleFrom(rows[i].role), on, name, machine);
        if (why) throw new Error(why);

        rows[i] = Object.assign({}, rows[i], {
            holder: machine, lastGiven: now(), lastGivenTo: machine
        });
        write(rows);
        return get(name);
    }

    function backFrom(name, what) {
        var it = what || {};
        var rows = read();
        var i = index(rows, name);
        if (i < 0) throw new Error('There is no guest called "' + name + '".');

        //A TOKEN THAT CAME BACK CHANGED IS THE ONE WORTH KEEPING. The CLI
        //refreshes as a worker runs, so what comes off a machine is newer than
        //what went on — and the path before this deleted it. Written only when it
        //actually differs, so an unchanged one does not re-seal a file for
        //nothing.
        var rotated = false;
        var refused = null;

        if (it.token) {
            var print = shape.fingerprint(it.token);
            if (print !== rows[i].fingerprint) {
                //DIFFERENT IS NOT THE SAME AS NEWER, and this is where that was
                //assumed. A machine that CLEARED its credential hands back
                //something with a new fingerprint and nothing in it. Storing that
                //is not keeping up with a rotation, it is destroying the only
                //copy — see ./shape.usable for the run where it happened.
                //
                //THE ONE WE HOLD HAS TO BE WORTH KEEPING for this to refuse. If
                //what is here is already unusable there is nothing to protect,
                //and the thing that came back is at worst no worse: taking it
                //keeps the old behaviour for a host recovering from exactly this,
                //and stops this refusal becoming a door that cannot be opened.
                var holding = null;
                try { holding = secret.read(fileFor(name)).toString('utf8'); } catch (e) { holding = null; }

                if (!shape.usable(it.token) && holding && shape.usable(holding)) {
                    //NOT WRITTEN, AND SAID OUT LOUD. Returned rather than logged
                    //here, because this file does not log — the caller puts it in
                    //the record, where somebody looking for why a sign-in stopped
                    //working will be.
                    refused = '"' + name + '" was handed back a credential with no access token and no '
                        + 'refresh token in it — the machine appears to have cleared its own sign-in rather '
                        + 'than refreshed it. The working one here was KEPT and nothing was overwritten.';
                } else {
                    secret.write(fileFor(name), Buffer.from(String(it.token), 'utf8'));
                    //THE PLAN TRAVELS WITH THE TOKEN, so it is re-read whenever
                    //the token is replaced — somebody who changes what they pay
                    //for gets a new credential saying so, and a stale label is
                    //worse than none.
                    rows[i] = Object.assign({}, rows[i], {
                        fingerprint: print, plan: shape.planOf(it.token), refreshed: now()
                    });
                    rotated = true;
                }
            }
        }

        rows[i] = Object.assign({}, rows[i], { holder: null });
        write(rows);
        return Object.assign({}, get(name), { rotated: rotated, refused: refused });
    }

    //---- learning whose a sign-in is, after the fact -----------------------------
    //
    //A sign-in made before the account was kept has no email, and re-signing it
    //to get one is a bad trade: it destroys a credential that works to gain a
    //label, and if the new sign-in is the same account as another here it
    //invalidates one of them. Nothing about a working key should have to be
    //risked to find out what it is called.
    //
    //FILLED ONLY WHEN EMPTY, AND NEVER OVERWRITTEN. A machine is not the
    //authority on whose credential this is: it is reporting what it saw, and if
    //that ever disagreed with what was recorded at sign-in, the sign-in is the
    //one that was watched by a person.
    function noteAccount(name, account) {
        if (!account || !(account.email || account.uuid)) return { learned: false, why: 'nothing to learn' };

        var rows = read();
        var i = index(rows, name);
        if (i < 0) return { learned: false, why: 'there is no sign-in called "' + name + '"' };
        if (rows[i].account && (rows[i].account.email || rows[i].account.uuid)) {
            return { learned: false, why: 'it already knows whose this is' };
        }

        rows[i] = Object.assign({}, rows[i], { account: account });
        write(rows);
        return { learned: true, account: account };
    }

    //---- filling in what was not recorded at the time -----------------------------
    //
    //The plan is in every sealed token this host holds, including the ones
    //written before anything read it. Recorded once, here, rather than left blank
    //until somebody signs in again — a card reading "not recorded" about a fact
    //sitting in a file two directories away is a card that makes this app look
    //like it cannot answer a question it can.
    //
    //GUARDED, AND THEN FREE. It does its work once and afterwards is a filter
    //over a handful of records, which matters because the caller is reached from
    //a paint function. Nothing is opened on a host where every record already
    //says what it is.
    //
    //THE ACCOUNT IS NOT FILLED IN THE SAME WAY AND CANNOT BE: it was never in the
    //credential, it was on a machine that has since been rolled back, and
    //inventing it is not available. Those stay null and say so.
    function ensurePlans() {
        var rows = read();
        var missing = rows.filter(function (g) {
            return g.plan === undefined && fs.existsSync(fileFor(g.name));
        });
        if (!missing.length) return 0;

        var done = 0;
        rows.forEach(function (g) {
            if (g.plan !== undefined) return;
            var text = null;
            try { text = secret.read(fileFor(g.name)).toString('utf8'); } catch (e) { text = null; }
            //`null` WHERE IT COULD NOT BE READ, which is a recorded answer — so
            //this does not try again on every call for a file that is gone.
            g.plan = text ? shape.planOf(text) : null;
            done++;
        });

        write(rows);
        return done;
    }

    //---- which supervisor sign-in is being used ------------------------------------
    //
    //"WHICH ONE IS BEING USED RIGHT NOW" IS NOT "which one is there to hand
    //over", and reading one as the other made the pane show no identity in use at
    //the exact moment one was.
    //
    //`key` is what could be given to a supervisor coming up, so an identity
    //already on a machine is not it. `inUse` is what a supervisor is signed in
    //as, and for these two that is the same word: a supervisor sign-in can only
    //be lent to a supervisor machine — ./lending refuses anything else — so a
    //holder is always a supervisor, and out always means in use.
    function supervisorKey() {
        var sups = all().filter(function (g) { return g.role === 'supervisor' && g.has; });
        var inUse = sups.filter(function (g) { return g.holder; })[0] || null;

        if (!sups.length) {
            return {
                key: null, chosen: null, inUse: null,
                why: 'this host has no supervisor sign-in at all — sign one in under Runners → Claude supervisor'
            };
        }

        var picked = chosen();
        if (!picked) {
            if (sups.length > 1) {
                return {
                    key: null, chosen: null, inUse: inUse,
                    why: 'there are ' + sups.length + ' supervisor sign-ins and none is chosen — pick one '
                        + 'under Runners → Claude supervisor'
                };
            }
            //ONE IS NOT AMBIGUOUS. Reported as chosen: null so nothing calls a
            //default a decision — the pane says "the only one" rather than "in
            //use".
            return sups[0].holder
                ? { key: null, chosen: null, inUse: inUse, why: '"' + sups[0].name + '" is already out on ' + sups[0].holder, out: sups[0].holder }
                : { key: sups[0], chosen: null, inUse: inUse, why: null };
        }

        var one = sups.filter(function (g) { return g.name === picked; })[0];
        if (!one) {
            //CHOSEN AND THEN THROWN AWAY. Not silently replaced: the setting
            //names an identity somebody picked, and the honest answer is that it
            //is gone.
            return {
                key: null, chosen: picked, inUse: inUse,
                why: 'the chosen sign-in "' + picked + '" is not kept here any more — pick another under '
                    + 'Runners → Claude supervisor'
            };
        }
        if (one.holder) {
            return {
                key: null, chosen: picked, inUse: inUse,
                why: 'the chosen sign-in "' + picked + '" is out on ' + one.holder, out: one.holder
            };
        }
        return { key: one, chosen: picked, inUse: inUse, why: null };
    }

    function index(rows, name) {
        for (var i = 0; i < rows.length; i++) if (rows[i].name === name) return i;
        return -1;
    }

    //---- and the two questions the queue asks ---------------------------------------

    function freeFor(role, machine) { return lending.choosable(all(), role, machine || null); }
    function pausedFor(role) { return lending.pausedFor(all(), role); }
    function forQueue() { return lending.forQueue(all()); }

    return {
        all: all, get: get, add: add, forget: forget, token: token,
        checked: checked, resume: resume, roleOf: roleOf, lentTo: lentTo, backFrom: backFrom,
        noteAccount: noteAccount, ensurePlans: ensurePlans, supervisorKey: supervisorKey,
        freeFor: freeFor, pausedFor: pausedFor, forQueue: forQueue,
        fileFor: fileFor, root: root,
        EXITS: EXITS
    };
};

module.exports.EXITS = EXITS;
