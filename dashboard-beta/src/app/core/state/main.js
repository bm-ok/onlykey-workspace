var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//the app's state: the small things it keeps between restarts.
//
//IT EXISTS BECAUSE SEVEN FILES WERE DOING IT SEPARATELY. `guards`, `todos`,
//`events` and the rest each grew the same twenty lines — mkdir, readFileSync,
//JSON.parse in a try, writeFileSync — and each got to decide on its own what a
//missing file means, what a half-written one means, and whether a failed write
//is worth mentioning. Four of them answered differently.
//
//NOT A DATABASE, AND THE LIMIT IS THE POINT. This is for things measured in
//kilobytes that a person could read: which workspace is open, what is guarded,
//a list of todos. Anything that grows without bound wants its own file and its
//own decisions about trimming — see ../events, which keeps a cap and rewrites
//the whole file on every act, and should stay that way.
//
//WRITTEN BESIDE AND MOVED INTO PLACE. A `writeFileSync` straight over the real
//file is a window in which the file is half a document — and the reader that
//opens it in that window does not get an error, it gets JSON.parse throwing on
//truncated text, which every one of those seven call sites treats as "nothing
//kept yet". Losing the workspace because the lights flickered mid-write is a
//silent, total loss that reads as a fresh install.
//
//IN main.js, LIKE ../log, because both halves want it: `guards` is main-side and
//`todos` is a server half. ./server.js hands the same object across.
//---------------------------------------------------------------------------

plugin.consumes = ['dataDir'];
plugin.provides = ['state'];
async function plugin(imports, register) {
    var dataDir = imports.dataDir;

    //ONE FOLDER, AND IT IS THE ONE EVERYTHING ELSE ALREADY USES. `state` is
    //where ../events and ../../supervisor keep theirs, so this is not a new
    //place for things to be — it is the same place with one way in.
    var dir = dataDir.at('state');

    function fileFor(name) {
        var clean = String(name == null ? '' : name).trim();
        //A NAME, NOT A PATH. The same rule ../../workspace keeps about
        //repositories, for the same reason: a caller that can name a path can
        //name any path, and this one WRITES.
        if (!clean || !/^[a-z0-9][a-z0-9-]*$/i.test(clean)) {
            throw new Error('A kept thing is named in letters, digits and dashes — "' + name + '" is not.');
        }
        return path.join(dir, clean + '.json');
    }

    function doc(name) {
        var file = fileFor(name);

        return {
            path: file,

            //WHAT IS THERE, OR WHAT YOU SAID INSTEAD. A missing file and an
            //unreadable one both answer the fallback, deliberately: neither is
            //recoverable here and both mean "there is nothing to go on". The
            //difference is worth a line in the log rather than a decision at
            //every call site.
            read: function (fallback) {
                var text;
                try { text = fs.readFileSync(file, 'utf8'); }
                catch (e) { return fallback; }

                try {
                    //A BYTE-ORDER MARK IN FRONT OF THE BRACE. Anything on Windows
                    //that has ever been opened in an editor may carry one, and
                    //JSON.parse refuses it — which reads as a corrupt file.
                    return JSON.parse(text.replace(/^﻿/, ''));
                } catch (e) { return fallback; }
            },

            write: function (value) {
                try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* it exists */ }

                var beside = file + '.writing';
                //THE MOVE IS WHAT MAKES IT SAFE. A reader sees the old document
                //or the new one, never half of either.
                fs.writeFileSync(beside, JSON.stringify(value, null, 2));
                fs.renameSync(beside, file);
                return value;
            },

            //FOR A THING THAT SHOULD STOP EXISTING, rather than becoming `{}`.
            //An empty document and no document are different answers, and a
            //caller that wanted the second and got the first has to know.
            forget: function () {
                try { fs.unlinkSync(file); return true; }
                catch (e) { return false; }
            }
        };
    }

    await register(null, {
        state: {
            doc: doc,
            where: dir
        }
    });
}
module.exports = plugin;
