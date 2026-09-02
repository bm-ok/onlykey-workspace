//---------------------------------------------------------------------------
//driving the window from outside: reading what is on it, pressing a button,
//filling a field.
//
//WHY IT HAS TO EXIST. The window is the one half of this app that cannot be
//exercised any other way. Everything else is an action, reachable from the
//command line; the window had a camera and nothing else — so a pane could be
//photographed and never operated, and every fault that lives in a click handler
//has to be found by somebody clicking it. The old window shipped two that way:
//a button wired to a function that did not exist, and a pane that painted and
//then swallowed what had been typed into it.
//
//A DRIVEN PRESS IS A REAL PRESS. `.click()` runs exactly the handler a person's
//click runs, and a fill raises the same `input` and `change` events the fields
//listen for. A test that took a private path would be testing the path and not
//the button — the same reason the queue drives the actions rather than having
//its own way to the machines.
//
//AND THAT IS ALSO THE WHOLE PROBLEM, which is why the gate below is not
//optional.
//
//  Every refusal this app makes about the command line is a refusal about THE
//  WIRE. A click is not on the wire. So without a gate, "a model may not
//  approve its own job" is one `windowClick --text Approve` away from being
//  untrue — and nothing would have been refused, or even recorded as strange.
//
//So pressing and filling are shut unless testing mode is on: the same switch
//that says the drills may run, turned on at a window by a person, for one named
//folder. READING STAYS OPEN — `windowControls` lists what is there and presses
//nothing, and a photograph and a list of buttons change nothing.
//
//THE SWITCH IS THE DASHBOARD'S, ON PURPOSE. This app has no settings of its
//own; it relays to the running dashboard, and that is where testing mode is
//turned on, where the banner saying so is shown, and where it is turned off
//again when the workspace changes. A second switch for one property is the
//second set of rules, and the second set is always the one that turns out to be
//wrong.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'pages'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var io = host.io;

    //ASKED OF ../io, so there is ONE answer to "which page is somebody looking
    //at". This file had its own and it was the wrong one; see `livePage` there.
    var pageNow = imports.pages.live;
    var actions = host.actions;

    //absent when built against a bare host — the test suite does that
    if (!actions) return register(null, {});

    //---- the gate ----------------------------------------------------------

    async function mayDrive(what) {
        var s;
        try {
            s = await actions.call('settings', {});
        } catch (e) {
            throw new Error('Cannot ' + what + ': the dashboard could not be asked whether testing mode is on (' + e.message + ').');
        }

        //`tests.allowed` IS THE ANSWER, AND THE FIRST VERSION ASKED THE WRONG
        //QUESTION. It read `settings.testsEnabled`, which does not exist —
        //the shape is `settings.tests = { allowed, why, enabled, forDir,
        //openDir }`. So the gate refused every time, INCLUDING while testing
        //mode was on, and that looked exactly like the gate working.
        //
        //It failed shut, which is the right direction to fail in and is also
        //why it went unnoticed: a door that is always locked passes every test
        //you can think to run on a locked door. It was found by reading the
        //other app's own answer rather than my assumption about it.
        //
        //`allowed` rather than `enabled`, because they are not the same
        //question: enabled says somebody turned it on, allowed says it is on
        //FOR THE FOLDER THAT IS OPEN NOW. The dashboard clears it when the
        //workspace changes, and a switch that stayed on across that would be a
        //switch about a folder nobody is looking at.
        var tests = s && s.tests;
        if (!tests || tests.allowed !== true) {
            throw new Error(
                'Cannot ' + what + ' — the window is only driven while testing mode is on for this workspace. '
                + ((tests && tests.why) ? tests.why + ' ' : '')
                + "A driven press reaches exactly the handlers a person's press reaches, so this would be a way around "
                + 'every refusal this app makes about the command line. Turn it on at the dashboard window, for the '
                + 'folder being worked on. Reading what is on screen (windowControls, and --dry) stays open.'
            );
        }
        return s;
    }

    //---- the guards, enforced here as well as painted there ----------------
    //
    //THE MARK AND THE REFUSAL MUST NOT BOTH DEPEND ON A PANE USING THE KIT, and
    //this was found by setting a guard and watching it do nothing.
    //
    //The theme paints `.protected` on a `Button`, and the driver refused
    //anything wearing that class. Which works for every control built from the
    //kit — and sessions/ hand-rolls `<button class="btn small">Show in folder`.
    //So a guard set at the window, recorded in guards.json, visible in the
    //Guards pane, was pressed from the command line a moment later. A guard that
    //silently does not apply is worse than no guard: it is a promise.
    //
    //So the list is checked HERE too, by the words on the button, where no pane
    //can fail to opt in. The class is still honoured — that is what carries the
    //ones the app proposes — and this catches the ones a person added.
    async function guardedLabels() {
        try {
            var g = await actions.call('guards', {});
            return (g && g.on || []).map(function (x) { return String(x.label || '').trim().toLowerCase(); });
        } catch (e) {
            //A GUARD LIST THAT CANNOT BE READ REFUSES NOTHING EXTRA, and that is
            //the wrong way to fail — but the alternative is refusing everything
            //on a transient error, which would read as the driver being broken.
            //The class-based half still applies either way.
            return [];
        }
    }

    //---- asking the page ---------------------------------------------------

    async function drive(want) {
        //ONE PAGE, NOT ALL OF THEM, and which one is asked of ../io rather than
        //decided here — see `livePage` there for why "the page" has a wrong
        //answer available and why this file had it. Showing something in every
        //page is right; PRESSING a button in every page is pressing it several
        //times, which for anything not idempotent is a different act from the
        //one that was asked for.
        var page = pageNow();
        if (!page) throw new Error('no page is connected — the window may be closed, or still loading');
        var answer = await new Promise(function (resolve) {
            page.timeout(15000).emit('drive:do', want, function (err, a) {
                resolve(err ? { error: 'the page did not answer' } : a);
            });
        });
        if (answer && answer.error) throw new Error(answer.error);
        return answer;
    }

    var undo = [
        actions.define('windowControls', {
            about: 'What is on screen right now: the buttons that can be pressed and the fields that can be filled',
            run: async function () {
                return await drive({ do: 'controls' });
            }
        }),

        actions.define('windowClick', {
            about: 'Press a button in the window, by the words on it. Only while testing mode is on. --dry says which one it would press',
            takes: ['text', 'nth', 'dry'],
            run: async function (args) {
                var asking = args.dry === true || args.dry === 'true';
                //--dry IS ALLOWED EITHER WAY. It says WHICH button would be
                //pressed and presses nothing, which is reading rather than
                //driving — and it is how somebody finds out the door is shut
                //without opening it.
                if (!asking) await mayDrive('press a button in the window');
                return drive({
                    do: 'click',
                    text: args.text,
                    nth: args.nth == null ? null : Number(args.nth),
                    dry: asking,
                    //Sent with the request so the page can refuse by name as
                    //well as by class. See guardedLabels above.
                    guarded: await guardedLabels()
                });
            }
        }),

        actions.define('windowFill', {
            about: 'Type into a field in the window, by its label. Only while testing mode is on',
            takes: ['label', 'value', 'nth'],
            run: async function (args) {
                await mayDrive('type into the window');
                return drive({
                    do: 'fill',
                    label: args.label,
                    value: args.value,
                    nth: args.nth == null ? null : Number(args.nth)
                });
            }
        })
    ];

    await register(null, {
        onDestroy: function () { undo.forEach(function (f) { f(); }); }
    });
}
module.exports = plugin;
