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
    async function markup() {
        var pages = io ? [...io.sockets.sockets.values()] : [];
        if (!pages.length) throw new Error('no page is connected — the window may be closed, or still loading');
        return await new Promise(function (resolve) {
            pages[0].timeout(15000).emit('snapshot:markup?', {}, function (err, a) {
                resolve(err ? { error: 'the page did not answer' } : a);
            });
        });
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
                of: shot.of || null
            };
        }
    })];

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
