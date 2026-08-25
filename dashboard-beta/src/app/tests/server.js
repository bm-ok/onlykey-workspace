var path = require('path');
var fs = require('fs');
var os = require('os');
var child = require('child_process');

var makeRuns = require('./runs');

//---- MAKING ONE COMMIT, WITHOUT TOUCHING ANYBODY'S WORKING TREE -------------
//
//THE FOLDER IN THE WORKSPACE IS SOMEBODY'S. It has their files open in it, their
//index, and possibly a branch they are in the middle of. So this never checks
//anything out and never writes into the tree: it builds the commit out of git's
//own object database and moves the ref, which is the same set of steps `git
//commit` performs and none of the ones that touch a file.
//
//    hash-object   the new file's bytes become an object
//    read-tree     the branch's current tree, into an index OF ITS OWN
//    update-index  the one file added to it
//    write-tree    that index becomes a tree
//    commit-tree   the tree, with the branch tip as its parent
//    update-ref    the branch moves, and ONLY if it is still where it was
//
//ITS OWN INDEX FILE, thrown away afterwards. The repository's real index belongs
//to whoever has the folder open, and using it would leave their staged work
//looking like something else happened to it.
//
//AND THE LAST STEP IS A COMPARE-AND-SWAP. `update-ref <ref> <new> <old>` refuses
//unless the branch is still at `old`, so a drill and a person committing at the
//same moment cannot silently lose one of the two.
//
//AN IDENTITY OF ITS OWN, so a drill's commits are legible as a drill's in any log
//that shows them — and so this does not depend on git being configured on the
//host, which it may not be.
function commitOnDrillBranch(folder, what) {
    var it = what || {};

    var git = function (args, opts) {
        var o = opts || {};
        return child.execFileSync('git', ['-C', folder].concat(args), {
            input: o.input,
            encoding: 'utf8',
            timeout: 30000,
            windowsHide: true,
            env: o.env || process.env
        }).trim();
    };

    //WHERE THE BRANCH IS, AND WHETHER IT IS HERE AT ALL. A repository without it
    //is skipped: a cut spans the workspace and a change usually does not.
    var tip = null;
    try { tip = git(['rev-parse', '--verify', 'refs/heads/' + it.branch]); }
    catch (e) { return null; }

    var blob = git(['hash-object', '-w', '--stdin'], { input: it.text });

    var index = path.join(os.tmpdir(), 'okc-drill-' + process.pid + '-'
        + String(it.branch).replace(/[^\w]/g, '') + '.idx');
    var withIndex = Object.assign({}, process.env, { GIT_INDEX_FILE: index });

    try {
        git(['read-tree', tip], { env: withIndex });
        git(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + it.file], { env: withIndex });
        var tree = git(['write-tree'], { env: withIndex });

        var commit = git(['commit-tree', tree, '-p', tip, '-m', String(it.message)], {
            env: Object.assign({}, process.env, {
                GIT_AUTHOR_NAME: 'okc drill',
                GIT_AUTHOR_EMAIL: 'drill@okc.invalid',
                GIT_COMMITTER_NAME: 'okc drill',
                GIT_COMMITTER_EMAIL: 'drill@okc.invalid'
            })
        });

        git(['update-ref', 'refs/heads/' + it.branch, commit, tip]);
        return { repo: it.repo, branch: it.branch, file: it.file, commit: commit, was: tip };
    } finally {
        try { fs.unlinkSync(index); } catch (e) { /* it was never written */ }
    }
}

//---------------------------------------------------------------------------
//THE DRILLS: enumerating them, running them, and remembering what happened.
//
//WHAT MAKES THESE DRILLS RATHER THAN UNIT TESTS is that a check is handed this
//app's own ACTION TABLE and asks for things exactly the way a person does —
//through the same surface, meeting the same refusals. A test that reached past
//the actions into the modules underneath would be proving something about code
//nobody uses.
//
//---- why the kit is loaded off disk rather than bundled -------------------
//
//THE BOARD SHOWS EACH CHECK'S SOURCE, and its fingerprint is a hash of that
//source — which is how a remembered result knows it is about code that has since
//changed. Both come from `fn.toString()`.
//
//Bundled, both would be BABEL'S OUTPUT rather than what somebody wrote: the
//window would show a transpiled arrow function with renamed bindings, and every
//fingerprint would change the day a preset was updated. So the drills and the
//harness are a PAYLOAD — copied beside the server bundle, required at runtime,
//byte for byte what is on disk. The same arrangement as ../vms/provision/scripts
//and for the same reason: what is handed to something else to read or run must
//arrive as itself.
//
//IT IS ALSO THE ONLY WAY THE LOADER CAN WORK AT ALL. It walks a directory and
//requires what it finds; webpack cannot follow a require built from a variable,
//so bundling would have produced an empty kit rather than an error.
//
//ONE ABSOLUTE REQUIRE, AND EVERYTHING ELSE RELATIVE TO IT. The harness keeps its
//registry in a module-level array, so a second copy of it — which node makes if
//the same file is required by two paths it does not normalise to one, and on
//Windows a differently-cased drive letter is enough — is a registry nothing
//reads. So this asks the loader for the harness rather than requiring it
//separately, and the loader's own require of it is relative.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'state', 'cached', 'settings', 'workspace',
    //A DRILL THAT FAILED IS SOMETHING WAITING ON A PERSON -- see the
    //source registered below. ../../inbox consumes `app` and `log` and
    //nothing else, so this cannot close a loop.
    'inbox'];
plugin.provides = ['tests'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('tests');

    var runs = makeRuns(imports.state);

    //---- the kit -----------------------------------------------------------

    var kit = null;
    var kitFault = null;

    function theKit() {
        if (kit || kitFault) return kit;
        try {
            //`__non_webpack_require__` IS A REAL REQUIRE. webpack rewrites the
            //ordinary one; this is the escape hatch it leaves for target:node,
            //and it is what keeps the drills off the bundle.
            var req = (typeof __non_webpack_require__ === 'function')
                ? __non_webpack_require__
                : require;

            //FORGOTTEN FIRST, or a save changes nothing.
            //
            //These are outside the bundle, so node's own module cache holds them
            //— and node's cache does not care that the bundle around it was
            //rebuilt. The server half would reload, this would require the kit
            //again, and get back the SAME objects: the same harness with the same
            //module-level registry, still holding the drills as they were when
            //the process started.
            //
            //It is not a subtle failure once you see it and it is invisible until
            //then. helpers.js was added to what gets copied, the bundle rebuilt,
            //and the board went on reporting forty-one drills that could not be
            //loaded — because the answer it was giving had been worked out before
            //the file existed.
            //
            //So everything the kit is made of is dropped from the cache before it
            //is asked for, which makes editing a drill the same five seconds as
            //editing anything else here.
            var mine = path.join(__dirname, 'suites');
            Object.keys(req.cache || {}).forEach(function (loaded) {
                if (loaded.indexOf(mine) === 0
                    || loaded === path.join(__dirname, 'harness.js')
                    || loaded === path.join(__dirname, 'helpers.js')) {
                    delete req.cache[loaded];
                }
            });

            var loader = req(path.join(__dirname, 'suites', 'index.js'));
            loader.load();

            kit = {
                harness: req(path.join(__dirname, 'harness.js')),
                titleOf: loader.titleOf,
                broken: loader.broken || []
            };
        } catch (e) {
            //SAID ONCE AND KEPT, because a kit that cannot be loaded is not a
            //kit with no drills — and those two look identical on a board that
            //answers with an empty list.
            kitFault = (e && e.message) ? e.message : String(e);
            log.bad('the drills could not be loaded: ' + kitFault);
        }
        return kit;
    }

    //---- enumerating -------------------------------------------------------
    //
    //THE HARNESS SPEAKS IN THE PORTED VOCABULARY and the window speaks in this
    //app's, and the translation happens exactly here. A folder is a SUITE, a
    //file in it is a TEST, and the it()s are CHECKS — but the ported registry
    //calls a file a "suite" and a check a "test", because that is what it was
    //when it had two levels. Translating once, here, is what keeps the harness
    //the ported shape.
    async function board() {
        var it = theKit();
        if (!it) return { suites: [], broke: kitFault };

        var registered = it.harness.getRegisteredSuites();
        var seen = await runs.all();

        //WHICH DRILLS WOULD NOT LOAD, SAID WITHOUT RUNNING ANYTHING.
        //
        //Each of those registers a check that fails when run — but until
        //somebody runs it, "not run" is what the board says, and that is the same
        //sentence it gives a drill nobody has got round to. One of those is a
        //queue of work; the other is a drill that is not there.
        var wontLoad = {};
        (it.broken || []).forEach(function (b) { wontLoad[b.group + ' / ' + b.test] = b.why; });

        //ONE READ OF THE RECORD FOR THE WHOLE BOARD. Asking per check is 236
        //reads and 236 parses of the same document to draw one screen.
        var groups = {};
        var order = [];

        for (var i = 0; i < registered.length; i++) {
            var file = registered[i];
            if (!groups[file.group]) {
                groups[file.group] = { name: file.group, tests: [] };
                order.push(file.group);
            }

            var cannotLoad = wontLoad[file.group + ' / ' + file.name] || null;

            var checks = (file.tests || []).map(function (check) {
                //TAKEN FROM THE REGISTRY, NOT RECOMPUTED.
                //
                //getRegisteredSuites() does not hand out the function. It hands
                //out its fingerprint and its source, and that is deliberate: a
                //DRAFT has no function at all, and hashing `undefined` would give
                //every draft the same number and call it a check whose code has
                //not changed. The harness says so where it does it.
                //
                //Recomputing here did that to EVERY check rather than only to
                //drafts. `check.fn` is undefined on all of them, so all 236
                //fingerprinted as the hash of the word "undefined" — 9c327aff-9,
                //four times over in a screenshot of the board, which is how it
                //was caught. Every "has this check been edited" comparison was
                //then one constant against the same constant, so a remembered
                //result could never go stale.
                var print = check.fingerprint;
                var key = runs.keyOf(file.group, file.name, check.name);
                var had = seen.checks[key] || null;

                //A REMEMBERED RESULT WHOSE CHECK HAS BEEN EDITED IS NOT A
                //RESULT. It says the check changed, which is more useful than a
                //stale green tick.
                var stale = had && had.fingerprint && had.fingerprint !== print;

                return {
                    name: check.name,
                    draft: !!check.draft,
                    note: check.note || null,
                    fingerprint: print,

                    //HOW MUCH CODE, NOT THE CODE.
                    //
                    //The board polls every five seconds while it is showing, and
                    //carrying every check's source made that answer 570 KB — for
                    //text that is FOLDED AWAY behind a line you click. So the
                    //listing says how many lines are behind the fold, and the
                    //source itself is one action away: see `suiteSource`.
                    //
                    //The pane's own note said "`suites` takes no arguments so
                    //there is no lighter listing to ask for". There is now.
                    lines: String(check.source || '').split('\n').length,
                    //A DRILL THAT WILL NOT LOAD SAYS SO BEFORE IT IS ASKED TO.
                    state: cannotLoad ? 'broken'
                        : stale ? 'changed'
                            : ((had && had.state) || 'not run'),
                    ms: (had && !stale) ? had.ms : null,
                    at: (had && !stale) ? had.at : null,
                    why: cannotLoad || ((had && !stale) ? had.why : null),
                    log: (had && !stale) ? (had.log || []) : [],
                    fromBefore: !!had && !stale
                };
            });

            groups[file.group].tests.push({
                name: file.name,
                checks: checks,
                state: worstOf(checks),
                ms: checks.reduce(function (n, c) { return n + (c.ms || 0); }, 0),
                ranWhole: seen.wholes[runs.wholeOf(file.group, file.name)] || null,
                dirty: null
            });
        }

        var suites = order.map(function (name) {
            var group = groups[name];
            return {
                name: name,
                tests: group.tests,
                state: worstOf(group.tests),
                ranWhole: seen.wholes[runs.wholeOf(name)] || null,
                dirty: null,
                dirtyBecause: null,
                disprovedBy: null,
                requires: it.harness.requirements()[name] || []
            };
        });

        //---- AND WHAT IS HAPPENING RIGHT NOW, IF ANYTHING --------------
        //
        //THE BANNER READS THIS AND HAS NEVER ONCE SHOWN. ../ui/banners/running
        //asks for `running` — the check in flight, with the score so far — and
        //this answered `run`, the RECORD of a run: when it started, what was
        //asked for, whether it finished. Two different questions one letter
        //apart, and the one the banner wanted was simply not here.
        //
        //So the purple banner announcing a drill in flight could not appear at
        //any point, on any run. It failed the way a thing does when it is
        //looking at a field nobody put there: silently, and by doing nothing.
        //
        //`progress()` ALREADY WORKED OUT THE HARD PART — see ./runs.js, and the
        //note there about a check being written down as running and overwritten
        //when it ends, so between two of them the honest answer is "nothing" and
        //the useful one is the most recent. It was never asked.
        //
        //NULL WHEN NOTHING IS RUNNING, which is what the banner tests. Both are
        //returned: `run` is the record the Test tab draws, `running` is the
        //moment the banner is about.
        return {
            suites: suites,
            broke: null,
            run: seen.run || null,
            running: await runs.progress()
        };
    }

    //THE WORST OF WHAT IS UNDER IT, because a suite is only as good as its
    //weakest check and an average would hide the one that matters.
    function worstOf(rows) {
        //EVERY STATE THAT CAN REACH THIS, WORST FIRST. It held five of eleven.
        //
        //IT WORKED ANYWAY, BY ACCIDENT, AND THAT IS THE INTERESTING PART.
        //`indexOf` gives -1 for a state that is missing, and -1 is less than
        //every real rank — so `broken` and `interrupted` beat everything, became
        //`worst`, and could then never be beaten, since every later row was
        //compared against -1 too. Which is roughly right for `broken` and wrong
        //for `draft`, and right for neither reason.
        //
        //SO NAMING THEM ALL IS THE FIX, and ranking an unknown one LAST is only
        //the floor under it. Made -1 explicit first and left the list short, and
        //every broken drill on the board immediately read as passing: the
        //accident had been holding up the answer.
        //NOT ../tests.js's `RANK`, WHICH IS A DIFFERENT QUESTION. That one is
        //the order rows are DRAWN in, and it puts `passed` above `not run`
        //because a reader wants results before blanks. Severity is the other way
        //round: a suite half of which has never been tried is "not run", and
        //borrowing the display order would have summarised it as "passed" —
        //which is the most flattering wrong answer available.
        var order = ['broken', 'failed', 'interrupted', 'asks you', 'changed', 'unrunnable',
            'running', 'not run', 'carried', 'passed', 'draft'];

        //A word this function has not been taught is a reason to teach it, not a
        //reason for a board to change colour.
        function rank(state) {
            var at = order.indexOf(state);
            return at < 0 ? order.length : at;
        }

        var worst = 'passed';
        rows.forEach(function (r) {
            if (rank(r.state) < rank(worst)) worst = r.state;
        });
        return rows.length ? worst : 'not run';
    }

    //---- running -----------------------------------------------------------

    var going = null;

    //---- SAYING IT RATHER THAN BEING ASKED ---------------------------------
    //
    //THE BANNER USED TO POLL FOR THIS EVERY THREE SECONDS, for ever, and
    //`board()` walks the whole registry and reads the run records off disk to
    //answer. Almost every one of those answers is "nothing is running".
    //
    //AND A RUN SHORTER THAN THE INTERVAL COULD NOT BE SEEN AT ALL. "the
    //refusals" finishes in 214ms; three seconds of poll can land either side of
    //it and never inside it. No cadence fixes that — only being told does.
    //
    //THE SHAPE IS ../core/okc's, WHICH HAS ALL THREE PARTS AND SAYS WHY. Told on
    //change, told again when a page connects, and ASKABLE — because the connect
    //emit races the listener: "the window attaches its listener a moment after
    //the socket is up, so the one page that most needs the answer is the one
    //that can miss it." Over there the cost was a dot reading "not connected"
    //above a panel full of live data.
    var io = host && host.io;

    //---- BUILT HERE AND NOT ASKED FOR, WHICH IS THE WHOLE OF IT ------------
    //
    //THE FIRST VERSION CALLED `runs.progress()`, which is the obvious thing and
    //was wrong for a reason worth keeping: it reads off disk, so it AWAITS. A
    //run keeps this process busy, so none of those awaits settle until the run
    //is over — and every emit of a twenty-check run arrived in the same two
    //milliseconds at the end, the last of them the `null` that takes the banner
    //down. React batched them, the null won, and the banner never drew.
    //
    //MEASURED, NOT REASONED: five `heard` lines in the window's console inside
    //2ms, then `heard null`, for a run that took seconds.
    //
    //SO THE PAYLOAD IS ASSEMBLED FROM WHAT THE RUN LOOP ALREADY HOLDS — the
    //check it is on and the counts so far — and emitted with nothing awaited.
    //An announcement that has to go and look something up is not an
    //announcement, it is another poll wearing a different hat.
    //
    //`keyOf`'s SHAPE, SPELT OUT: "group / test / check", the same string
    //./runs.js files a result under, so what the banner shows and what the board
    //shows are one thing rather than two that agree today.
    //THE COUNTS ARE PASSED IN, AND THEY WERE NOT.
    //
    //`counts` belongs to one RUN and this function is outside `runIt`, so
    //naming it here was a free identifier: a ReferenceError, thrown from inside
    //`onTestStart`, swallowed by the harness — and the only emit that survived
    //was the `null` one, because the ternary never reaches `counts` on that
    //branch. So the banner heard "nothing is running", precisely and only.
    //
    //IT LOOKED LIKE A SOCKET PROBLEM FOR THREE ATTEMPTS. The server logged that
    //it was announcing, the window logged that it heard something, and what it
    //heard was always null. Nothing in the chain was wrong except a name that
    //was not in scope — the same shape as `git.nameIsOk`, `whatIsOn`, and the
    //four rules in the git door, all in one sitting.
    function announce(at, counts) {
        if (!io) return;
        io.emit('tests:running', at
            ? {
                doing: [at.groupName, at.suiteName, at.testName].join(' / '),
                passed: counts.passed,
                failed: counts.failed,
                //NEITHER PASSED NOR FAILED, TOGETHER. The banner has room for
                //three numbers and a person watching one wants to know how much
                //is left, not the taxonomy — but `done` has to count them or the
                //bar stops short of the end for a run with anything asked in it.
                other: counts.unrunnable + counts.asking,
                done: counts.passed + counts.failed + counts.unrunnable + counts.asking
            }
            : null);
    }
    var stopAsked = false;

    async function runIt(args) {
        var a = args || {};
        if (going) throw new Error('A run is already going. Stop it, or wait for it to finish.');

        var it = theKit();
        if (!it) throw new Error('The drills could not be loaded: ' + kitFault);

        stopAsked = false;

        //WHICH ONES. A name matches a suite, a test, or both — so "run this one
        //file" and "run this whole folder" are the same verb.
        var wantGroup = a.suite ? String(a.suite) : null;
        var wantTest = a.test ? String(a.test) : null;
        var wantCheck = a.check ? String(a.check) : null;

        await runs.began({ suite: wantGroup, test: wantTest });

        var counts = { passed: 0, failed: 0, unrunnable: 0, asking: 0 };

        //WHICH CHECK IS SPEAKING, so its log lines land against it.
        var onCheck = null;

        //AND THE WRITES IN ORDER. Each is a read-change-write of one document;
        //two overlapping ones would read the same thing and the second would
        //write over the first's result.
        var remembering = Promise.resolve();

        going = it.harness.run({
            //THE TABLE ITSELF. A drill asks this app for something the way
            //anything else does, and meets the same refusals.
            actions: actions,

            //---- A DRILL IS NOT A PERSON EITHER -------------------------
            //
            //`_fromTest` IS FORCED, NOT MERGED, and it goes on LAST so a drill
            //cannot clear it by passing its own. The whole point of the flag is
            //that a check cannot pretend to be somebody it is not — a drill that
            //could unset it would be the exact hole the drills exist to look
            //for, reachable from inside them.
            //
            //NOTHING SET IT BEFORE, so every guard reading it was inert and a
            //drill reached the action table looking exactly like the window.
            //`the ways round a refusal` says why that matters: with the drills
            //on, this app will write a task, dispatch it and take a credential
            //off a machine — so a drill able to arm the drills is a drill that
            //can arm itself.
            //
            //IT IS NOT THE SAME AS `_overTheWire`, and merging them would break
            //more than it fixed: a drill legitimately writes branches and tasks,
            //and those doors refuse the WIRE. What `_fromTest` closes is the
            //narrower set that only a person may do — see ATTHEWINDOW in
            //../settings/server.js.
            okc: async function (name, callArgs) {
                if (!actions) throw new Error('there is no action table to drive');
                return actions.call(name, Object.assign({}, callArgs || {}, { _fromTest: true }));
            },

            //THE HALF-HOUR ONES ARE OFF UNLESS SOMEBODY SAYS SO. Building a
            //machine from nothing holds the whole host for twenty-five minutes —
            //a thing to decide to do, not something "Run all" does to you
            //because you wanted to see the board go green.
            slow: a.slow === true || a.slow === 'true',

            //AND COOLING THE HOST DOWN IS OFF TOO, separately, because they are
            //opposite kinds of expensive: slow is "this takes twenty minutes",
            //teardown is "this UNDOES the twenty minutes somebody already spent".
            teardown: a.teardown === true || a.teardown === 'true',

            keepGoing: a.keepGoing === true || a.keepGoing === 'true',

            //IT FILTERS CHECKS, NOT FILES, and takes them in the ported
            //vocabulary: the CHECK's name, then the file it is in, then the
            //folder. Written first as though it were handed a file, which
            //matched nothing and reported a run of zero checks as a success —
            //"ran: true, passed: 0" is the shape of a filter that never fired.
            testFilter: function (check, test, group) {
                if (wantGroup && group !== wantGroup) return false;
                if (wantTest && test !== wantTest) return false;
                if (wantCheck && check !== wantCheck) return false;
                return true;
            },

            //WHAT A CHECK SAW, KEPT AGAINST THAT CHECK.
            //
            //The harness hands every check a `log`, and what it writes is the
            //concrete thing it met: a branch name, a task number, how long a
            //machine took, and above all THE WORDING OF A REFUSAL. Half of what
            //this app promises is a refusal, and a refusal is only as good as the
            //sentence it hands back.
            //
            //Kept per check rather than in one stream, because the board shows it
            //beside the source of the check that wrote it.
            log: function () {
                var line = Array.prototype.slice.call(arguments).join(' ');
                if (onCheck) onCheck.log.push(line);
                log.info(line);
            },

            shouldStop: function () { return stopAsked; },

            //WHAT A SERIES HANDS ITSELF ACROSS A RESTART — see keep() in the
            //harness and ./runs.js for where it is kept.
            stateLoad: function (group, test) { return runs.loadState(group, test); },
            stateSave: function (group, test, value) { return runs.saveState(group, test, value); },

            onTestStart: function (at) {
                onCheck = { group: at.groupName, test: at.suiteName, check: at.testName, log: [] };
                //SYNCHRONOUS, so it leaves before the check does — see `announce`.
                announce(at, counts);
            },

            //WRITTEN DOWN WHEN THE CHECK ENDS, not when its status changes.
            //
            //`onTestUpdate` carries a STATUS and nothing else — no duration, no
            //fingerprint, no log — because it exists to drive a live board. The
            //durable record needs all three, and they are only complete here.
            onTestEnd: function (at) {
                var was = at.result || {};

                //A JOB FOR SOMEBODY IS NOT A FAILURE, and this ladder used to
                //say it was. `asksYou` was not on it, so a check that ended by
                //asking a person to do something — sign a worker in, answer a
                //request — fell off the end into `failed`: filed red in the
                //durable record and counted against the run.
                //
                //THE PANE WAS ALREADY BUILT FOR IT. ./tests.js ranks and counts
                //a state called "asks you", between the failures and the
                //changed ones, and nothing has ever written one. The reader was
                //waiting for a word the writer never said.
                //
                //IT IS WORTH GETTING RIGHT BEYOND THE COLOUR. What the drills
                //ask for is exactly the list of what a person has to do to keep
                //this host running, and filing it as a failure both slanders the
                //kit and throws away the best source of that list there is.
                var state = was.draft ? 'draft'
                    : was.carried ? 'passed'
                        : was.asksYou ? 'asks you'
                            : was.unrunnable ? 'unrunnable'
                                : was.ok ? 'passed' : 'failed';

                if (state === 'passed' && !was.carried) counts.passed++;
                if (state === 'failed') counts.failed++;
                if (state === 'unrunnable') counts.unrunnable++;
                if (state === 'asks you') counts.asking++;

                var lines = (onCheck && onCheck.check === at.testName) ? onCheck.log : [];
                onCheck = null;

                //THE SCORE MOVES HERE, not at the start — `1 passed, 1 failed`
                //is what somebody watches change, and `counts` has just been
                //added to. Still naming the check that ended: it is the last
                //thing that happened, and the next `onTestStart` is a moment
                //away.
                announce(at, counts);

                //A DRAFT IS NOT A RESULT. It has not been written yet, so
                //remembering one would put a row on the board about a check that
                //has never run.
                if (state === 'draft') return;

                //FINGERPRINTED WITH WHAT JUST RAN, so a result cannot outlive the
                //code it is about.
                var print = null;
                try { print = fingerprintOf(at.groupName, at.suiteName, at.testName); } catch (e) { /* said by being null */ }

                remembering = remembering.then(function () {
                    return runs.remember(at.groupName, at.suiteName, at.testName, {
                        state: state,
                        at: was.at || new Date().toISOString(),
                        ms: was.ms == null ? null : was.ms,
                        why: was.error || was.unrunnable || was.asksYou || null,
                        log: lines,
                        fingerprint: print
                    });
                }).catch(function (e) {
                    log.warn('could not write down "' + at.testName + '": ' + e.message);
                });
            }
        });

        try {
            var out = await going;
            //THE WRITES FIRST. Answering before they land means a caller that
            //asks for the board straight afterwards sees the run it just did as
            //not having happened.
            await remembering;
            await runs.ended(counts);
            return { ran: true, passed: counts.passed, failed: counts.failed,
                unrunnable: counts.unrunnable, asking: counts.asking,
                suites: (out && out.suites) || [] };
        } finally {
            going = null;
            //AND THE BANNER COMES DOWN. Nothing to name, so nothing is running.
            announce(null, counts);
        }
    }

    //THE FINGERPRINT OF ONE CHECK, found in the registry rather than recomputed
    //from anything the run reports — it must be a hash of the SAME function the
    //board will show, or a result would look stale the moment it was written.
    function fingerprintOf(group, test, check) {
        var it = theKit();
        if (!it) return null;
        var file = it.harness.getRegisteredSuites().filter(function (f) {
            return f.group === group && f.name === test;
        })[0];
        if (!file) return null;
        var found = (file.tests || []).filter(function (c) { return c.name === check; })[0];
        return found ? found.fingerprint : null;
    }

    //ONE CHECK'S SOURCE, KEYED ON ITS FINGERPRINT.
    //
    //THE FINGERPRINT IS A HASH OF THE SOURCE, which makes it the one key worth
    //having: the answer is a pure function of it, so it is true for ever and a
    //check that has been edited has a different key rather than a stale entry.
    //That is exactly what ../core/cached's `byContent` drawer is for, and this is
    //the honest use of it — the RESULTS are a record and stay in ./runs.js,
    //because a cache drawer wipes itself at five hundred entries and starts empty
    //on every restart, which is the half-hour of ISO evidence that record exists
    //to keep.
    var sources = imports.cached.byContent('drill-sources');

    async function sourceOf(args) {
        var a = args || {};
        var print = fingerprintOf(a.suite, a.test, a.check);
        if (!print) {
            throw new Error('There is no check called "' + a.check + '" in "' + a.test + '".');
        }

        return sources.get(print, function () {
            var it = theKit();
            var file = it.harness.getRegisteredSuites().filter(function (f) {
                return f.group === a.suite && f.name === a.test;
            })[0];
            var found = (file.tests || []).filter(function (c) { return c.name === a.check; })[0];
            return {
                suite: a.suite, test: a.test, check: a.check,
                fingerprint: print,
                source: String(found.source)
            };
        });
    }

    //---- the surface -------------------------------------------------------

    var undo = [];
    //---- AND A PAGE THAT ARRIVES MID-RUN ----------------------------------
    //
    //Both halves of ../core/okc's answer, for its reasons: a client is told the
    //state as it connects, AND can ask for it, because attaching a listener
    //takes a moment and the emit does not wait.
    function onConnection(client) {
        runs.progress().then(
            function (now) { client.emit('tests:running', now); },
            function () { /* nothing to say; the ask below still works */ }
        );

        client.on('tests:running?', function (_args, reply) {
            if (typeof reply != 'function') return;
            runs.progress().then(function (now) { reply(now); }, function () { reply(null); });
        });
    }
    if (io) {
        io.on('connection', onConnection);
        //NAMED SO IT COMES OFF BY ITSELF. `io` is made in ../core/io/main.js and
        //outlives every reload, so `removeAllListeners` here would take every
        //other plugin's handlers with it.
        undo.push(function () { io.off('connection', onConnection); });
    }

    if (actions) {
        undo.push(actions.define('suites', {
            about: 'Every drill there is, and what happened last time each one ran',
            run: board
        }));

        //---- PUTTING A COMMIT ON A DRILL BRANCH ---------------------------
        //
        //WHY THE KIT NEEDS ONE AT ALL. Several drills are about what happens to a
        //CHANGE — a verdict is refused on a branch with nothing on it, a change
        //goes out and comes back — and none of them can ask that question without
        //a commit existing. Waiting for a real worker to make one costs a machine
        //and real money to set up a precondition.
        //
        //---- WHY IT IS HERE AND NOT IN ../git ------------------------------
        //
        //../git/server.js states it plainly: "NOTHING CREATES OR REWRITES A
        //COMMIT. History is made by people and by workers on machines; this app
        //moves labels around." Its `WRITES` list is closed and a test holds the
        //list to what is callable, so adding a commit-maker there would take a
        //promise the app makes about itself and make it false — for the benefit
        //of the drills, which is the worst possible reason.
        //
        //So the kit brings its own, and it is the kit's: it lives with the drills,
        //it is gated by the same switch they are, and it goes when they go. The
        //sentence in ../git stays literally true.
        //
        //---- WHAT IT REFUSES, WHICH IS THE ONLY PART THAT LASTS ------------
        //
        //None of this is a promise about how drills are written. A rule that
        //depends on every future drill being careful is not a rule.
        //
        //  the drills must be on         the same gate suiteRun uses, for the
        //                                same folder somebody turned them on for
        //  only a `drill/` branch        so it cannot land on a line, a default,
        //                                or anything somebody is working on
        //  only a `drill-` file          so even on the right branch it cannot
        //                                land on top of somebody's file
        //  only a repository here        named, and checked against the workspace
        //
        //THE BRANCH MUST ALREADY EXIST, and a repository that does not have it is
        //skipped rather than refused: a cut spans the workspace, a change usually
        //does not, and a drill naming one repository is making a point about a
        //change that spans one.
        undo.push(actions.define('drillCommit', {
            about: 'Put a commit on a drill branch, so a drill has a change to send out. Refused off a drill branch',
            takes: ['branch', 'repo', 'file', 'text', 'message'],
            run: async function (args) {
                var a = args || {};

                var may = await imports.settings.allowed();
                if (!may.allowed) throw new Error(may.why);

                var on = String(a.branch || '').trim();
                if (on.indexOf('drill/') !== 0) {
                    throw new Error('"' + on + '" is not a drill branch. This only ever commits on drill/ branches — '
                        + 'a drill that could commit anywhere is a drill that can write into somebody\'s work.');
                }

                var name = String(a.file || 'drill-note.md').trim();
                if (!/^drill-/.test(name)) {
                    throw new Error('"' + name + '" is not a drill file. The name has to start with "drill-" so it '
                        + 'cannot land on top of something somebody wrote.');
                }
                //A PLAIN RELATIVE PATH. `..` in a name written into a tree is a
                //path this never has to understand, so it is refused rather than
                //reasoned about.
                if (!/^[\w.-]+(\/[\w.-]+)*$/.test(name) || name.indexOf('..') >= 0) {
                    throw new Error('"' + name + '" is not a plain relative path.');
                }

                var here = (await imports.workspace.repos()).map(function (r) { return r.name; });
                var want = a.repo ? [String(a.repo)] : here;
                for (var i = 0; i < want.length; i++) {
                    if (here.indexOf(want[i]) < 0) {
                        throw new Error('There is no repository called "' + want[i] + '" here. There is: '
                            + here.join(', ') + '.');
                    }
                }

                var done = [];
                for (var j = 0; j < want.length; j++) {
                    var made = commitOnDrillBranch(await imports.workspace.folderOf(want[j]), {
                        repo: want[j],
                        branch: on,
                        file: name,
                        text: String(a.text == null ? 'Written by a drill.\n' : a.text),
                        message: String(a.message || 'drill: a change to send out')
                    });
                    if (made) done.push(made);
                }

                if (!done.length) throw new Error('No repository here has a branch called "' + on + '". Cut it first.');

                log.info('committed ' + name + ' on ' + on + ' in ' + done.map(function (d) { return d.repo; }).join(', '));
                return {
                    branch: on,
                    commits: done,
                    note: done.length + ' commit(s) on ' + on + ': ' + done.map(function (d) {
                        return d.repo + ' ' + d.commit.slice(0, 7);
                    }).join(', ') + '.'
                };
            }
        }));

        undo.push(actions.define('suiteSource', {
            about: 'What one check actually does, which is the only way to know what its tick means',
            takes: ['suite', 'test', 'check'],
            run: sourceOf
        }));

        undo.push(actions.define('suiteRun', {
            about: 'Run the drills, or one suite or one test of them',
            takes: ['suite', 'test', 'check', 'slow', 'teardown', 'keepGoing'],
            run: runIt
        }));

        undo.push(actions.define('suiteStop', {
            about: 'Ask the run to stop after the check it is on',
            run: function () {
                if (!going) return { stopping: false, note: 'Nothing is running.' };
                stopAsked = true;
                //IT FINISHES THE CHECK IT IS ON. A check killed mid-way leaves
                //the world where nothing expected it — a branch half made, a
                //machine holding something — and the drill after it would then
                //be failing about that rather than about the app.
                return { stopping: true, note: 'It will stop after the check it is on.' };
            }
        }));

        undo.push(actions.define('testsForget', {
            about: 'Forget remembered drill results, all of them or one',
            takes: ['suite', 'test', 'check'],
            run: function (args) {
                var a = args || {};
                return runs.forget({ group: a.suite, test: a.test, check: a.check })
                    .then(function (n) { return { forgotten: n }; });
            }
        }));
    }

    //---- AND A DRILL THAT FAILED IS WAITING ON SOMEBODY --------------------
    //
    //IT PASSES THE TEST FOR BEING ON THAT LIST: it would sit for a week if
    //nobody looked, and that would be a problem. A red drill is this app telling
    //you something it relies on has stopped being true.
    //
    //FAILURES, AND CHECKS THAT ASKED FOR SOMETHING. Not-tried is the resting
    //state of a quiet host, and a number on the bar that is high when nothing is
    //wrong is a number people stop reading -- which is the failure mode
    //../../inbox's own header is about, arriving through this source.
    //
    //THE SECOND KIND IS WHY THIS SOURCE EARNS ITS PLACE. A drill that asks has
    //RUN, found this host short of something only a person can supply, and said
    //what to do — which is the definition of a row on this list, worked out by
    //trying rather than guessed at. Both go to zero on a host that is looked
    //after, which is the test for belonging here.
    //
    //---- IT USED TO BE PUSHED FROM INSIDE THE PANE -------------------------
    //
    //`shell.badge('Test', ...)` in a `useEffect` in ./tests.js, so the count
    //only moved while somebody was looking at the Test tab -- which is exactly
    //when nobody needs it. Its own comment admitted the compromise: "the shell
    //offers no way to push one, and inventing a channel here for a digit is
    //worse than the lag."
    //
    //There is a channel now, and it is not a digit: it is a row on the list of
    //things waiting, with somewhere to go. The badge falls out of that.
    undo.push(imports.inbox.source({
        name: 'drills that failed or are asking you',
        //---- WHAT IS NOT COUNTED, AND WHY IT WOULD RUIN THE COUNT --------
        //
        //`broken` AND `unrunnable` ARE NOT ERRANDS TODAY. Eighteen drills are
        //broken on this host and every one is the same fact: they `require` the
        //layout of the app being ported from, which has not been moved yet. That
        //is one job, written down, not eighteen things a person must go and do.
        //
        //Counting them would put the badge at twenty-two and hold it there for
        //as long as the port runs -- which is exactly the failure ../../inbox's
        //header describes: "a count that is never zero is a count nobody reads".
        //Named here so the omission is a decision rather than an oversight.
        notReading: ['drills that are broken rather than failing — they are one port gap, not many errands'],

        waiting: async function () {
            var said = await board();
            var out = [];

            //`tests`, NOT `checks`. A suite has `tests`, and each of those has
            //`checks` inside it — reading the wrong one found nothing at all and
            //said so by putting zero on a tab that plainly reads four.
            ((said && said.suites) || []).forEach(function (suite) {
                (suite.tests || []).forEach(function (one) {
                    if (one.state !== 'failed' && one.state !== 'asks you') return;

                    //NO `id` ON A CHECK, so the name is the identity — and the
                    //suite is part of it, because two suites may reasonably ask
                    //the same question of different things.
                    var which = (suite.name || '') + ' / ' + (one.name || '');

                    //---- THE OTHER KIND, AND IT IS THE BETTER ONE -----------
                    //
                    //A CHECK THAT ASKS IS NOT REPORTING A FAULT. It ran, found
                    //this host missing something only a person can supply — a
                    //worker signed in, a request answered — and said what to do
                    //about it. That is precisely what this list is for, and the
                    //drills are the only thing on this host that works it out by
                    //trying.
                    //
                    //THE DRILL'S OWN WORDS, NOT A SENTENCE WRITTEN HERE. It
                    //knows what it wanted and this does not; `why` is the whole
                    //value of the row, and paraphrasing it into "a drill needs
                    //something" would throw away the only part worth reading.
                    var asking = one.state === 'asks you';

                    //FROM THE CHECK, NOT FROM THE ROW ABOVE IT. A test row
                    //carries a state and the checks under it carry the reason —
                    //so reading `why` here found nothing and every asked row
                    //came out saying "it needs something", which is the one
                    //sentence a person cannot act on.
                    var asked = asking
                        ? (one.checks || []).filter(function (c) { return c.state === 'asks you' && c.why; })[0]
                        : null;

                    out.push(imports.inbox.item(
                        asking ? 'a drill is asking you' : 'drill that failed',
                        one.name || which,
                        asking
                            ? ((asked && asked.why) || 'It ran, and it needs something from you before it can go further.')
                                + ' Asked by "' + (suite.name || '?') + '".'
                            : 'It is a check this app makes about itself, and it does not hold. In "'
                                + (suite.name || '?') + '". Nothing else here will say so.',
                        imports.inbox.at('Test', null, one.name || null),
                        { id: which }
                    ));
                });
            });
            return out;
        }
    }));

    await register(null, {
        tests: {
            board: board,
            runs: runs,
            kit: theKit,
            running: function () { return !!going; }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
