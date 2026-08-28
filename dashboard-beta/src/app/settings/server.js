//---------------------------------------------------------------------------
//WHAT THIS APP IS SET TO, as opposed to what a workspace contains.
//
//A branch, a task and a line are statements about a folder of repositories.
//These are statements about this INSTALLATION — so they survive switching
//workspace, closing one, and having none open at all. That is why this is
//`state.app` and not `state.here`, and it is the clearest example of the split
//in ../core/state: the two are one keystroke apart and mean opposite things.
//
//SMALL ON PURPOSE. Anything belonging to a workspace belongs in the workspace's
//drawer, and anything belonging to a machine belongs in the registry. What is
//left is a short list of choices about the app itself — and the moment this
//grows a hundred keys it has become a place to hide behaviour nobody can find.
//
//---- what moving this changed, and what it did not -------------------------
//
//THE THREE MARKS BECAME ONE, AND THAT IS NOT A WEAKENING. Over there the two
//refusals below turn on `_overTheWire || _driven || _fromTest`. Here it is
//`_overTheWire` alone, for the same reason ../supervisor/server.js gives: this
//app has no `_driven` because ../core/drive REFUSES TO PRESS A GUARDED BUTTON
//AT ALL rather than pressing it and marking the press. The refusal moved
//earlier. So both halves have to be real — the mark here, and `protect` on the
//control in ../settings/general.js, which the confirm dialog already carries and
//calls "the most important guard in the app".
//
//`_fromTest` has no counterpart yet because the harness has not been ported. It
//closed a real hole — a drill calling the action table in process looks exactly
//like somebody clicking — and whatever brings the harness over has to bring that
//back with it. Written down here rather than in the harness, because the guard
//is this file's and the harness is where it would be forgotten.
//
//THE DRILLS START OFF HERE, whatever the app being ported from is set to. Two
//separate settings files now exist and this one has never been written, so it
//reads as every default — which for this file means off, for nowhere, with
//nothing asked. That is the safe direction and it is the only direction worth
//having: the alternative is a fresh install that inherits somebody else's "yes".
//---------------------------------------------------------------------------

//EVERY SETTING IS NAMED HERE WITH ITS DEFAULT, and reading merges onto this.
//
//A setting that only exists once somebody has changed it is a setting nothing
//can list, nothing can explain, and which reads as `undefined` in whatever
//happens to consult it first. The pane shows this list; a key absent from it is
//not a setting, it is a typo — and `settingSet` says so rather than keeping it.
var DEFAULTS = {
    //WHETHER THE DRILLS MAY RUN, and it is off until somebody says otherwise.
    //
    //The suites drive this app for real: they write a task and remove it again,
    //they take a credential off a machine and put it back. Against three
    //scaffolding repositories that is exactly what they are for. Against
    //somebody's actual work it is a stranger typing into their repository, and
    //the app has no way to tell the two apart — so it does not guess.
    testsEnabled: false,

    //AND WHICH WORKSPACE IT WAS TURNED ON FOR.
    //
    //This is what makes "switch workspace and it goes back to off" true by
    //construction rather than by remembering to hook the switch. Enabled means
    //enabled HERE: the check is `testsEnabled && testsFor === the folder now
    //open`, so opening anything else is off without anything having to notice.
    //
    //IT COMPARES TWO FACTS RATHER THAN TRUSTING AN EVENT TO HAVE FIRED, which
    //is what covers the cases a hook misses — a workspace closed and reopened, a
    //second window, the app restarted.
    //
    //WHY THIS IS NOT `state.here`. It could be: the workspace drawer would give
    //the same answer by construction and one fewer field. It is not, because the
    //rest of this document is genuinely about the host, and splitting one key of
    //five into another drawer to save a string comparison buys a settings action
    //that has to read two places and a `settingSet` that has to know which. The
    //comparison is three lines and it is the three lines a person reads when
    //they want to know why the drills are off.
    testsFor: null,

    //SOMEBODY DOWN THE PIPE ASKING TO BE ALLOWED, and nothing more than that.
    //
    //A model may want the drills run and may not decide that somebody's
    //repository is a fine place to run them — so it can raise its hand, and a
    //person answers in the window. `{ at, why, forDir }`, or null.
    //
    //KEPT ON DISK WITH THE REST rather than in memory, so a request outlives the
    //restart a code change causes. Being asked and then having the question
    //vanish because the app reloaded is how somebody ends up running the drills
    //by hand to find out what was wanted.
    testsAsked: null,

    //WHETHER THE SUPERVISOR ANSWERS BY ITSELF, and it is off until somebody says
    //otherwise.
    //
    //A supervisor woken is a machine started and a model spending tokens, on its
    //own initiative, because somebody typed a sentence. That is the entire point
    //of it and it is not a thing to switch on by accident.
    supervisorWakes: false,

    //WHETHER THIS HOST WATCHES GITHUB FOR WORK ARRIVING, and it is off until
    //somebody says otherwise.
    //
    //An issue and a pull request are the only two things in this whole app that
    //turn up on their own. Everything else begins with somebody writing a task.
    //Off by default because it is a standing network call against somebody
    //else's service, and because what it leads to is a supervisor deciding there
    //is work. Switching it on is saying "watch my repositories and act on what
    //turns up", which is a sentence somebody should say out loud.
    watchGitHub: false,

    //---- WHOSE WORDS FROM GITHUB MAY BE READ AS A REQUEST ------------------
    //
    //AN ISSUE BODY IS TEXT WRITTEN BY ANYBODY ON THE INTERNET, and it arrives on
    //the same answer as everything this host knows for certain. See
    //../github/trust.js for what is done about that; these two are what a person
    //sets, and both are BLANK.
    //
    //BLANK IS OFF, AND THAT IS THE WHOLE DESIGN OF THE DEFAULT. With no marker
    //set, nothing that ever arrives from GitHub can be a request — every issue
    //and every pull request is a quotation, always. A host that has not been
    //told whose word to take should not be guessing, and the safe state is the
    //one it ships in rather than one somebody has to remember to choose.
    //
    //SO TURNING IT ON IS TWO DELIBERATE ACTS: naming the people, and choosing
    //the word. Neither has a sensible default and neither should be invented
    //here — a marker this app picked would be one an attacker could read out of
    //the source.
    githubTrusted: [],
    githubMarker: '',

    //WHETHER THE QUEUE COMES UP RUNNING, and it is off until somebody says
    //otherwise.
    //
    //ON MEANS: every time this app starts, it begins handing queued work to free
    //machines without being asked — rolling one back to its base snapshot,
    //handing it a credential, and running instructions on it unattended.
    //
    //WHAT MAKES THAT SAFE IS NOT THIS SETTING, and it is worth being exact about
    //where the safety actually is. Nothing can be waiting in that queue that was
    //not built from a job, a prompt and a contract somebody READ AND APPROVED,
    //and approving is refused over the wire — ../library/server.js says it: "a
    //model may write one and may not ratify its own." The gate is on the work.
    //This only decides whether somebody has to press the same button again after
    //every restart, and a `main.js` edit is a restart.
    //
    //IT IS AN ORDINARY SETTING, not one of ATTHEWINDOW below, and that follows
    //from the same sentence. Guarding it would be the second gate all over
    //again, one level further out.
    queueAutoStart: false,

    //WHICH SIGN-IN THE SUPERVISOR USES, by name, until somebody switches it.
    //
    //A supervisor holds one identity for as long as it is up, and this host can
    //keep several. Picking "whichever is free" is fine with one and is a guess
    //the moment there are two — and the wrong guess is which account the
    //deciding gets billed to. Null means "the only one there is".
    supervisorKey: null
};

//---------------------------------------------------------------------------
//THE SETTINGS THAT ARE A PERSON'S, AND IT IS THE WHOLE GATE RATHER THAN ITS
//SWITCH.
//
//This was one key — `testsEnabled` — and that is what the app being ported from
//still guards. It is not enough, and the reason is in the predicate: the drills
//are allowed when `testsEnabled` AND `testsFor === the folder open now`. Two
//settings, both writable, and only one of them was refused.
//
//SO THE WAY ROUND IT WAS TO MOVE THE FOLDER INSTEAD OF THE SWITCH. Leave
//`testsEnabled` alone — it is very often already true, turned on last week
//against the scaffolding — and write `testsFor` to whatever is open now. The
//guarded key is never touched, nothing refuses, and `allowed()` comes back true
//against somebody's real work. That is the exact state `testsFor` exists to make
//safe, defeated by the setter for `testsFor`.
//
//`testsAsked` is here for a smaller reason: forging a raised hand changes
//nothing by itself, but it is a sentence that appears in a dialog a person is
//about to read and trust, attributed to somebody having asked. `testsAsk` is the
//door — it takes a reason and stamps the folder itself.
//
//WRITTEN AS A LIST OF WHAT IS PROTECTED rather than a check inside one branch,
//so the next setting that joins this gate is a name added here rather than a
//second `if` somebody has to remember.
//---------------------------------------------------------------------------
//---- AND THE OTHER PERMISSION IN THIS FILE --------------------------------
//
//WHOSE WORDS FROM GITHUB MAY BE READ AS A REQUEST is the same kind of decision
//as arming the drills, one step further out: it does not open a door, it opens a
//CHANNEL -- text written on somebody else's service, arriving here as something
//this host acts on. See ../github/trust.js.
//
//A MODEL THAT COULD WRITE THE LIST COULD GRANT ITSELF AN INPUT. Name an account
//you control, open an issue on it, and you have commissioned your own work
//through a door nobody watched you open. That is the whole of it, and it is why
//the list is here rather than left as an ordinary setting.
//
//THE MARKER IS NOT THE LESSER HALF, which is the tempting reading -- a word on
//its own trusts nobody, so guarding it can look like ceremony. It is not, and
//the reason is that the marker is applied to text that ALREADY EXISTS. Set it to
//`Update` and every "Update: I fixed the thing" a trusted person has ever
//written becomes a request, retroactively, without anybody writing a word. The
//people are half the permission and the word is the other half; guarding one is
//the mistake this list was already made to correct once.
var ATTHEWINDOW = ['testsEnabled', 'testsFor', 'testsAsked', 'githubTrusted', 'githubMarker'];

//WHY EACH ONE IS REFUSED, IN ITS OWN WORDS. It was a ternary on `testsEnabled`
//while there was one permission here; with two, the second branch -- written for
//`testsFor` and about the folder the drills run in -- would have been the
//sentence somebody got back for naming a person on GitHub.
//
//`testsEnabled` KEEPS ITS WORDING EXACTLY, because a drill in ../tests/suites/
//02-the-refusals reads this message. A refusal whose wording drifts is a check
//that goes red for a reason that is not the one it is about.
var WHYREFUSED = {
    testsEnabled: 'The drills are switched on in the window, by somebody who knows what folder is open. They write a task and take a credential off a machine — that is a decision about somebody\'s repository, not a flag to be set down a pipe.',
    testsFor: '"testsFor" is the other half of that same permission. The drills are allowed when testsEnabled is on AND testsFor is the folder open now — so moving the folder arms them against whatever is in front of you without the switch ever being touched. It is decided in the same place, in the window, by somebody who can see which folder that is. Ask with testsAsk instead.',
    testsAsked: '"testsAsked" is the other half of that same permission seen from the other side: it is a raised hand, and forging one puts a question in front of a person that nobody actually asked. It is written by testsAsk, which takes a reason and stamps the folder itself, and answered in the window.',
    githubTrusted: 'Naming somebody trusted opens a channel from the internet into what this host acts on: from then on their marked words are read as somebody asking for something. A caller able to add a name could add one it controls and commission its own work through an issue. It is done in the window, in Settings → Trust, where the account is looked up and its picture shown first.',
    githubMarker: 'The marker is the other half of that same permission, and it is applied to text that already exists — set it to a word a trusted person writes habitually and their old comments become requests, with nobody having written anything new. It is chosen in Settings → Trust, in the window.'
};

function truth(v) {
    return v === true || v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'yes';
}

//A VALUE ARRIVES AS A STRING AND HAS TO BE PUT BACK INTO THE SHAPE ITS DEFAULT
//DECLARES, and the app being ported from does not do this — it keeps whatever
//came in.
//
//WHICH IS A LIVE DEFECT THERE, IN THE DANGEROUS DIRECTION. A command line has no
//types: `settingSet --name watchGitHub --value false` hands over the STRING
//"false", which is stored as-is and is TRUTHY. So the one command anybody would
//type to turn off a standing network call against somebody else's service —
//the setting whose own comment says switching it on means "watch my repositories
//and act on what turns up" — TURNS IT ON. Silently, and reporting "Saved."
//
//Found by printing the settings back after setting one, which is the whole
//argument for a printer: `watchGitHub false` in a wall of braces reads as fine,
//and `watchGitHub  false` under a column of `off` does not.
//
//DECLARED SHAPE WINS, so this cannot be got wrong one key at a time. A boolean
//default means the value is coerced to a boolean; anything else is a name, and
//an empty name is null rather than "".
function shaped(key, v) {
    if (typeof DEFAULTS[key] === 'boolean') return truth(v);

    //A LIST DEFAULT MEANS A LIST, and this is the same defect as the boolean one
    //above wearing different clothes. `settingSet --name githubTrusted --value
    //bmatusiak` is the obvious thing to type and hands over a STRING, which
    //stored as-is is not an array — so ../github/trust.js reads it as nobody
    //being trusted, and this reports "Saved." The direction is the safe one, but
    //the silence is not: somebody has named a person and been told it worked.
    //
    //COMMA-SEPARATED, because that is what a person types into one box, and a
    //login cannot contain a comma. JSON is accepted too, since that is what a
    //script hands over.
    if (Array.isArray(DEFAULTS[key])) {
        var items = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
        if (!Array.isArray(v)) {
            var text = String(v == null ? '' : v).trim();
            if (text.charAt(0) === '[') {
                try {
                    var parsed = JSON.parse(text);
                    if (Array.isArray(parsed)) items = parsed;
                } catch (e) { /* not JSON: it was a name with a bracket in it */ }
            }
        }
        var out = [];
        var seen = {};
        items.forEach(function (one) {
            //AN ENTRY MAY BE A SHAPE. `githubTrusted` holds `{login, id}` when
            //the window wrote it — it looked the name up before adding it, so it
            //has the number, and the number is what survives a rename. A bare
            //name still works and is what a command line can express.
            var name = (one && typeof one === 'object') ? String(one.login || '').trim()
                : String(one == null ? '' : one).trim();
            //BLANKS DROPPED HERE, at the one place they can enter. A trailing
            //comma is how an empty entry gets into a list, and `same()` in
            //../github/trust.js has to defend against one reaching it — this is
            //the other half of that defence, and the reason it stays cheap.
            if (!name) return;
            var key = name.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            out.push((one && typeof one === 'object' && one.id != null)
                ? { login: name, id: one.id }
                : name);
        });
        return out;
    }

    if (v === null || v === undefined) return null;
    //AN OBJECT IS ALREADY A SHAPE. This is only here because a COMMAND LINE has
    //no types; a caller that hands over a structure has already said what it
    //means, and `String({...})` is "[object Object]" — which for `testsAsked`
    //would turn a standing request into a corrupt one that still renders.
    //Unreachable today, since ATTHEWINDOW refuses the pipe and the window's own
    //writers build their values; a trap laid for whoever adds the next setting.
    if (typeof v === 'object') return v;
    var s = String(v).trim();
    return s === '' ? null : s;
}

plugin.consumes = ['app', 'log', 'state', 'workspace'];
plugin.provides = ['settings'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('app');

    var kept = imports.state.app.doc('settings');

    //ONLY WHAT IS DECLARED ABOVE. A key left over from a setting that has since
    //been removed is not carried forward as though it still meant something.
    function read() {
        var was = kept.read({}) || {};
        var out = {};
        Object.keys(DEFAULTS).forEach(function (k) {
            out[k] = (k in was) ? was[k] : DEFAULTS[k];
        });
        return out;
    }

    function write(patch) {
        var now = Object.assign({}, read(), patch || {});
        Object.keys(now).forEach(function (k) {
            if (!(k in DEFAULTS)) {
                throw new Error('"' + k + '" is not a setting. See DEFAULTS in settings/server.js — a setting that is not declared cannot be listed or explained.');
            }
        });
        kept.write(now);
        return now;
    }

    //A WORKSPACE THAT CANNOT BE DETERMINED IS NOT AN OPEN ONE, and the drills
    //are refused rather than allowed while the question is unanswerable.
    async function openDir() {
        try { return (await imports.workspace.dir()) || null; }
        catch (e) { return null; }
    }

    //THE ONE QUESTION THE REST OF THE APP ASKS, rather than reading two fields
    //and comparing them in four places.
    //
    //BOTH HALVES ARE REQUIRED. Enabled but for a different folder is not enabled
    //— it is the state somebody left behind on Tuesday, pointed at work they
    //care about today.
    function allowed(open) {
        var s = read();
        if (!s.testsEnabled) {
            return { allowed: false, why: 'The drills are switched off. They drive this app for real — they write a task, and one of them takes a credential off a machine — so they are off until somebody turns them on for a workspace they do not mind that happening to.' };
        }
        if (!open) return { allowed: false, why: 'No workspace is open, so there is nothing for the drills to run against.' };
        if (s.testsFor !== open) {
            return {
                allowed: false,
                why: 'The drills were turned on for ' + (s.testsFor || 'another folder') + ', and the folder open now is ' + open + '. Switching workspace switches them off — turn them on again here if this is a folder you do not mind them touching.'
            };
        }
        return { allowed: true, why: null };
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('settings', {
            about: 'What this app is set to, and why each one is where it is',
            run: async function () {
                var now = read();
                var open = await openDir();
                return {
                    settings: now,
                    //THE DERIVED ANSWER AS WELL AS THE TWO FIELDS IT COMES FROM,
                    //because "enabled" alone is not the question anything
                    //actually asks — enabled for somewhere else is not enabled.
                    tests: Object.assign(allowed(open), {
                        enabled: now.testsEnabled,
                        forDir: now.testsFor,
                        openDir: open
                    }),
                    //THE STANDING REQUEST COMES BACK HERE RATHER THAN FROM
                    //`status`, and that is a change from the app being ported
                    //from. Over there the pane read it off `status` because the
                    //request and the setting lived in different modules. They
                    //live in one document now, so two reads answering one
                    //question would be two reads that can disagree — and the one
                    //that would be wrong is the one still coming down the pipe
                    //from the other app's settings file.
                    //
                    //ALREADY FILTERED TO THE OPEN FOLDER, as `status` did. A
                    //request raised against another workspace is not a question
                    //anybody standing here can answer, and `testsAnswer` clears
                    //such a request rather than honouring it.
                    askedToTest: (now.testsAsked && now.testsAsked.forDir === open) ? now.testsAsked : null,
                    where: kept.path
                };
            }
        }));

        undo.push(actions.define('settingSet', {
            about: 'Change one setting. Turning the drills on is done in the window, by a person',
            takes: ['name', 'value'],
            run: async function (args) {
                var a = args || {};
                var key = String(a.name || '').trim();
                if (!(key in DEFAULTS)) {
                    throw new Error('"' + key + '" is not a setting. It is one of: ' + Object.keys(DEFAULTS).join(', ') + '.');
                }

                //ARMING THE DRILLS IS NOT SOMETHING THE PIPE MAY DO, and that
                //means all of ATTHEWINDOW rather than the switch alone — see
                //the head of this file for the way round that guarding one key
                //left open.
                //
                //The refusal in `suiteRun` is worth nothing if whatever is
                //refused can switch it off first — a guard a caller can disable
                //is a guard that only stops callers who were not going to do it
                //anyway. Same rule as approving a job: a model may ASK for the
                //drills and may not decide that somebody's repository is a fine
                //place to run them.
                //THE SWITCH KEEPS ITS OWN SENTENCE, WORD FOR WORD, because a
                //drill in ../tests/suites/02-the-refusals reads this message. A
                //refusal whose wording drifts is a check that goes red for a
                //reason that is not the one it is about.
                //---- THREE WAYS IN, AND THIS WATCHED ONE OF THEM ----------
                //
                //IT READ `a._overTheWire` ALONE. The other two reach the same
                //door and were not looked at:
                //
                //  `_driven`    a press driven from the command line. ../core/
                //               drive refuses a PROTECTED button before it gets
                //               here, which is a real guard -- but this is the
                //               one that holds when the button is not painted,
                //               or when the call arrives some other way.
                //  `_fromTest`  a drill. Nothing set it until now, so a drill
                //               reached this looking exactly like the window --
                //               and with the drills on, this app writes a task,
                //               dispatches it and takes a credential off a
                //               machine. A drill able to arm the drills is a
                //               drill that can arm itself.
                //
                //THE DRILL THAT ASKS THIS COULD NOT HAVE PASSED HONESTLY. `the
                //ways round a refusal` calls `settingSet` as a drill and expects
                //to be refused; with nothing marking it, being refused or not
                //said nothing about anybody else.
                if (ATTHEWINDOW.indexOf(key) !== -1 && (a._overTheWire || a._driven || a._fromTest)) {
                    throw new Error(WHYREFUSED[key]);
                }

                var on = truth(a.value);
                var patch;
                if (key === 'testsEnabled') {
                    //ENABLED IS ALWAYS ENABLED *FOR* THE FOLDER OPEN RIGHT NOW,
                    //written in the same act. Two calls to set two fields is two
                    //chances to end up enabled for nowhere, or for whatever was
                    //open last week.
                    patch = { testsEnabled: on, testsFor: on ? await openDir() : null };
                } else {
                    patch = {};
                    patch[key] = shaped(key, a.value);
                }

                var now = write(patch);
                if (key === 'testsEnabled') {
                    log.warn(on
                        ? 'the drills are ON for ' + now.testsFor + ' — they write a task and take a credential off a machine'
                        : 'the drills are off');
                } else {
                    log.warn(key + ' is now ' + JSON.stringify(now[key]));
                }
                return {
                    settings: now,
                    note: (key === 'testsEnabled' && on)
                        ? 'On for ' + now.testsFor + '. Opening a different workspace switches them off.'
                        : 'Saved.'
                };
            }
        }));

        //ASKING TO BE ALLOWED, which is the one thing the pipe MAY do about this.
        //
        //The refusal in `settingSet` is right and it left a model with nowhere to
        //go: it can want the drills run and cannot say so, which in practice
        //means somebody types the request into a chat window and it is lost the
        //moment the conversation moves on. This puts the question where the
        //answer is. It changes nothing by itself — it raises a hand.
        undo.push(actions.define('testsAsk', {
            about: 'Ask to be allowed to run the drills. A person answers in the window',
            takes: ['why'],
            run: async function (args) {
                var a = args || {};
                var open = await openDir();
                if (!open) throw new Error('No workspace is open, so there is nothing to ask about.');

                var already = allowed(open);
                if (already.allowed) return { asked: false, note: 'The drills are already allowed here. Nothing to ask.' };

                var reason = String(a.why || '').trim();
                if (!reason) throw new Error('Say what they are wanted for. A request with no reason is one somebody has to interrupt you to understand, which is the thing this exists to avoid.');

                var now = write({ testsAsked: { at: new Date().toISOString(), why: reason, forDir: open } });
                log.warn('asked to run the drills against ' + open + ': ' + reason);
                return { asked: true, request: now.testsAsked, note: 'Asked. The window will put the question up; nothing runs until somebody answers it.' };
            }
        }));

        //ANSWERED IN THE WINDOW, by somebody who can see which folder is open.
        //Refused down the pipe for the same reason `settingSet` is: a request
        //that could answer itself is not a request.
        undo.push(actions.define('testsAnswer', {
            about: 'Answer a request to run the drills — yes for this workspace, or no',
            takes: ['allow'],
            run: async function (args) {
                var a = args || {};
                //ALL THREE, LIKE `settingSet` ABOVE. This read the wire alone,
                //and answering a request to arm the drills is the same act as
                //arming them -- so it is the same door and takes the same lock.
                //A drill that could answer its own request is the sharpest
                //version of "something that could answer its own request has not
                //asked for anything".
                if (a._overTheWire || a._driven || a._fromTest) {
                    throw new Error('A request to run the drills is answered in the window, by somebody who can see which folder is open. Something that could answer its own request has not asked for anything.');
                }

                var yes = truth(a.allow);
                var asked = read().testsAsked;
                var open = await openDir();

                if (!yes) {
                    write({ testsAsked: null });
                    log.info('the request to run the drills was declined');
                    return { allowed: false, note: 'Declined. Nothing changed, and the request is cleared.' };
                }

                //THE FOLDER IS CHECKED RATHER THAN TAKEN FROM THE REQUEST. A
                //request raised against one workspace and answered after
                //switching to another would otherwise turn the drills on
                //somewhere nobody was asked about.
                if (asked && asked.forDir && open && asked.forDir !== open) {
                    write({ testsAsked: null });
                    throw new Error('That was asked about ' + asked.forDir + ', and the folder open now is ' + open + '. The request is cleared rather than answered — ask again here if that is what is wanted.');
                }
                if (!open) throw new Error('No workspace is open, so there is nothing to allow.');

                var now = write({ testsEnabled: true, testsFor: open, testsAsked: null });
                log.warn('the drills are ON for ' + now.testsFor + ' — they write a task and take a credential off a machine');
                return { allowed: true, settings: now, note: 'On for ' + now.testsFor + '. Opening a different workspace switches them off.' };
            }
        }));
    }

    await register(null, {
        settings: {
            read: read,
            write: write,
            //ASKED WITH NO ARGUMENT IT WORKS THE FOLDER OUT ITSELF, which is what
            //every caller wants and is why it is async. A caller that already
            //holds the folder may pass it.
            allowed: async function (open) {
                return allowed(open === undefined ? await openDir() : open);
            },
            DEFAULTS: DEFAULTS,
            where: kept.path
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
