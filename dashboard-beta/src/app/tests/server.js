var path = require('path');

var makeRuns = require('./runs');

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

plugin.consumes = ['app', 'log', 'state', 'cached'];
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

        return { suites: suites, broke: null, run: seen.run || null };
    }

    //THE WORST OF WHAT IS UNDER IT, because a suite is only as good as its
    //weakest check and an average would hide the one that matters.
    function worstOf(rows) {
        var order = ['failed', 'changed', 'unrunnable', 'not run', 'passed'];
        var worst = 'passed';
        rows.forEach(function (r) {
            if (order.indexOf(r.state) < order.indexOf(worst)) worst = r.state;
        });
        return rows.length ? worst : 'not run';
    }

    //---- running -----------------------------------------------------------

    var going = null;
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

        var counts = { passed: 0, failed: 0, unrunnable: 0 };

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

            okc: async function (name, callArgs) {
                if (!actions) throw new Error('there is no action table to drive');
                return actions.call(name, callArgs || {});
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
            },

            //WRITTEN DOWN WHEN THE CHECK ENDS, not when its status changes.
            //
            //`onTestUpdate` carries a STATUS and nothing else — no duration, no
            //fingerprint, no log — because it exists to drive a live board. The
            //durable record needs all three, and they are only complete here.
            onTestEnd: function (at) {
                var was = at.result || {};
                var state = was.draft ? 'draft'
                    : was.carried ? 'passed'
                        : was.unrunnable ? 'unrunnable'
                            : was.ok ? 'passed' : 'failed';

                if (state === 'passed' && !was.carried) counts.passed++;
                if (state === 'failed') counts.failed++;
                if (state === 'unrunnable') counts.unrunnable++;

                var lines = (onCheck && onCheck.check === at.testName) ? onCheck.log : [];
                onCheck = null;

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
                unrunnable: counts.unrunnable, suites: (out && out.suites) || [] };
        } finally {
            going = null;
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
    if (actions) {
        undo.push(actions.define('suites', {
            about: 'Every drill there is, and what happened last time each one ran',
            run: board
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
