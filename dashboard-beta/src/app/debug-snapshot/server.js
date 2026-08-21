var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//`capture` — what the window is made of, and what it looks like, at one moment.
//
//TWO FILES BECAUSE THEY ANSWER DIFFERENT HALVES OF ONE QUESTION, and this app's
//own CLAUDE.md makes the argument: a class that matches no rule is invisible in
//the picture and obvious in the markup; a value drawn from the wrong field is
//the other way round. CSS has no undefined-name error here, so a misspelt class
//is the quietest failure available — and until this existed, the markup half was
//simply not available for THIS app.
//
//IT WAS AVAILABLE FOR THE OTHER ONE, WHICH IS WORSE THAN NOTHING. `capture`
//already appeared in the catalogue, answered by the relay, so `okc.js capture`
//from here photographed the app being ported FROM and said it had succeeded.
//Defining it locally is what stops that: the table tries its own first.
//
//A PLUGIN OF ITS OWN, AND NOTHING OUTSIDE THIS FOLDER KNOWS ABOUT IT. Delete the
//folder and the action, the key and the dialog all go with it; nothing else has
//a line to take out. That is what the plugin system is for, and a debugging tool
//is exactly the kind of thing that should be removable without a search.
//
//---- what this writes to disk, and why that needs watching -----------------
//
//THIS IS THE ONE THING IN THE APP THAT COPIES THE WHOLE SCREEN TO A FILE, AND IT
//SCRUBS NOTHING. Every other route to disk here is narrowed on purpose: the live
//log stays in memory because command output carries sign-in URLs and tokens, and
//../core/events keeps only an allowlist of tags and redacts inside them. This
//keeps whatever was rendered, verbatim, in two files.
//
//WHAT SAVES IT TODAY IS NOT A DECISION ANYBODY MADE HERE. A value somebody typed
//does not reach the markup, because React sets `value` as a PROPERTY and
//`outerHTML` serialises ATTRIBUTES — measured, with a canary typed into a field
//and zero occurrences in the file. That is a property of React, not a rule this
//app enforces, and it stops being true for an uncontrolled input, a
//`defaultValue`, or any `<input value={...}>` written by hand. Anything that
//starts putting a secret in an attribute puts it in every capture from then on,
//silently.
//
//THE PICTURE IS THE OTHER HALF AND HAS NO SUCH LUCK: it is what the screen looks
//like. The token field is `type="password"` so it photographs as dots, and that
//is the only reason a capture of the Keys dialog is safe. A field that stops
//being a password field stops being safe here too.
//
//SO THE RULES, FOR ANYTHING ADDED TO THIS APP LATER:
//
//  * a secret must never be an attribute value, only a property
//  * a secret on screen must be a password field, or not on screen
//  * `/shots` is gitignored, and nothing in it is tracked — checked. These files
//    are not protected, only unpublished: they sit in the working tree in
//    cleartext, and they are the right thing to delete after reading.
//
//AND IT IS CALLABLE OVER THE PIPE, which is what makes ../core/ipc's token the
//thing standing in front of it. Before that, anything on this machine that could
//open a named pipe could have written the screen to disk and read it back. An
//action that dumps the window is exactly the kind the socket needed closing for.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var io = host && host.io;
    var log = imports.log.on('capture');

    //`actions` is absent when this half is built against a bare host — the test
    //suite does exactly that. See ../core/okc/server.js.
    if (!actions) return register(null, {});

    //ASKED OF THE PAGE RATHER THAN PUSHED BY IT, so this works from the command
    //line as well as from the key. A `capture` that only functioned when the
    //window called it would be an action in the table that the table's own
    //command line could not use, which is the one property this app's actions
    //are supposed to have.
    //ASKS EVERY CONNECTED PAGE, AND SAYS WHEN THERE IS MORE THAN ONE.
    //
    //This took `pages[0]` — the socket that connected FIRST — and the argument
    //for it was that there is one window. There is not: a browser tab left open
    //at this address is a page, and it stays connected for as long as it is
    //open. When one is, `capture` photographs THAT page: the picture comes from
    //the nw window and the markup comes from somewhere else entirely, and the
    //pair that is supposed to describe one instant describes two windows.
    //
    //IT IS THE WORST SHAPE A VERIFICATION TOOL CAN HAVE. Every symptom points at
    //the code: an edit lands, the bundle serves it, the capture does not show
    //it. Hours can go into the edit before anybody suspects the camera. So this
    //prefers the nw window — the page a person is actually looking at — and when
    //it cannot tell which, it REFUSES rather than picking one, because a capture
    //of an unknown page is worse than no capture.
    function ask(page) {
        return new Promise(function (resolve) {
            page.timeout(15000).emit('snapshot:markup?', {}, function (err, a) {
                resolve(err ? { error: 'the page did not answer' } : a);
            });
        });
    }

    async function markup() {
        var pages = io ? [...io.sockets.sockets.values()] : [];
        if (!pages.length) throw new Error('no page is connected — the window may be closed, or still loading');
        if (pages.length === 1) return await ask(pages[0]);

        var all = await Promise.all(pages.map(ask));

        //THE NEWEST ONE, and it is not a coin toss. A page that reloaded a
        //moment ago connected a moment ago; a page that has been sitting there
        //since before the last three edits connected first. `pages[0]` picked
        //that one — the oldest — which is the single worst choice available, and
        //an abandoned socket answers for as long as it is open.
        //
        //It is still a guess when somebody genuinely has two windows up, so it
        //SAYS SO in what it returns rather than quietly picking. The failure this
        //is guarding against was silent for an hour: an edit lands, the bundle
        //serves it, the capture does not show it, and every symptom points at the
        //code rather than at the camera.
        var use = all[all.length - 1];
        var window = all.filter(function (a) { return a && a.window; });
        if (window.length === 1) use = window[0];

        if (use && use.html && all.length > 1) {
            use = Object.assign({}, use, {
                pages: all.length,
                others: all.filter(function (a) { return a !== use; })
                    .map(function (a) { return (a && a.on) || 'nowhere'; })
            });
        }
        return use;
    }

    var undo = [actions.define('capture', {
        about: 'Save what the window currently looks like: the markup, and a picture of it. Takes everything windowShot takes',
        //EVERY OPTION windowShot HAS, PASSED STRAIGHT THROUGH.
        //
        //Without this, `capture` was the only way to get the markup and
        //`windowShot` was the only way to get a whole-page picture — so anybody
        //wanting both had to take two snapshots, of two different moments, and
        //the pair that is supposed to describe one instant described two. The
        //two halves answering different questions is the entire argument for
        //writing both files; they have to be of the same window.
        takes: ['name', 'whole', 'width', 'height'],
        run: async function (args) {
            var a = args || {};
            var said = await markup();
            if (said && said.error) throw new Error(said.error);
            if (!said || !said.html) throw new Error('the page sent no markup');

            //THE PICTURE COMES FROM ../core/shot RATHER THAN FROM A SECOND COPY
            //OF THE DEBUGGER DANCE. That plugin has already worked out which of
            //the debugger's targets is the window and which is the background
            //page — photographing the wrong one returns a blank image, which is
            //evidence worse than none — and two implementations of that would
            //drift, with the drifted one being whichever nobody reads.
            //
            //AND THE OPTIONS ARE NOT INTERPRETED ON THE WAY PAST. `whole` and
            //`width` mean whatever windowShot means by them, today and after it
            //changes; a copy of that reasoning here would be a second opinion
            //about a picture this half never sees.
            var shot = await actions.call('windowShot', {
                name: a.name, whole: a.whole, width: a.width, height: a.height
            });

            //BESIDE THE PICTURE, AND NAMED AFTER IT. Two files from one moment
            //that do not share a name are two files somebody has to pair up by
            //timestamp, at the point they are already comparing two things.
            var file = String(shot.file).replace(/\.png$/, '.html');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, said.html);

            log.good('captured ' + (said.on || 'the window') + ' — ' + said.html.length
                + ' bytes of markup, and a picture beside it');

            return {
                file: file,
                bytes: said.html.length,
                image: shot.file,
                on: said.on || null,
                of: shot.of || null,

                //HOW MANY PAGES WERE LISTENING, said whenever it was more than
                //one. The picture is of the app window and the markup is of a
                //page; when only one page is connected those are the same thing
                //and this is silent. When they might not be, it says so on the
                //answer rather than leaving somebody to trust a pair that may
                //describe two different windows.
                pages: said.pages || undefined,
                note: said.pages
                    ? said.pages + ' pages were connected (' + said.others.join(', ') + ' as well) — the markup is of '
                        + 'the newest one, and the picture is of the app window. Close the extras if they disagree.'
                    : undefined
            };
        }
    })];

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
