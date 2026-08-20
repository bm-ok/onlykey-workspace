var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//the app's state: the small things it keeps between restarts.
//
//TWO DRAWERS, AND WHICH ONE A THING GOES IN IS THE WHOLE DESIGN.
//
//    state.app     true whatever is being worked on — the machines this host
//                  made, its ssh hosts, its sign-ins, what has been approved,
//                  which workspace is open
//    state.here    about the workspace that is open — its tasks, its branch
//                  notes, what it knows about its repositories
//
//Folding them together is not a tidiness problem, it is contamination: point
//the app at a second workspace and the first one's tasks are still there,
//answering, about repositories that are not in front of you. The app being
//ported from learned this the hard way and its own comment names it — "the
//contamination this whole file exists to prevent, arriving on the first switch".
//
//BOTH LIVE UNDER THE APP'S OWN DIRECTORY. Workspace state is NOT kept inside the
//workspace, and that is deliberate: a workspace is a folder of repositories
//somebody else may own, may clone, may `git clean -xdf`. A registry in there is
//one command from gone, with the machines it describes still running. Same
//argument that moved this out of the repository in the first place.
//
//`here` IS NOTHING WHEN NOTHING IS OPEN, rather than a default drawer. A window
//about nowhere must not be answered with the tasks of the last place — and a
//write with nowhere to go is refused rather than dropped quietly, because
//"saved" and "there was nowhere to save it" are different answers.
//
//---- why this does not consume `workspace` --------------------------------
//
//It would be a cycle. ../../workspace keeps WHICH FOLDER IS OPEN in `state.app`
//— that is a fact about this host, so it belongs in this drawer — and if this
//asked `workspace` where it was, each would be waiting on the other.
//
//So the direction is inverted: `follow()` takes a function that answers "which
//folder now", and the workspace plugin hands its own in. This knows nothing
//about what a workspace IS; it knows somebody will tell it when asked. Same
//shape as ../log's `keeper`, and the reason the switch is automatic — `here` is
//resolved per call, so changing workspace changes the drawer with no one
//telling anything to reload.
//---------------------------------------------------------------------------

//A NAME, NOT A PATH, and this one WRITES. `../escape`, `a/b` and `..` are
//refused rather than sanitised: a deny list is a list somebody has to have got
//right, and there is no reading of those that is a document name.
function fileName(name) {
    var clean = String(name == null ? '' : name).trim();
    if (!clean || !/^[a-z0-9][a-z0-9-]*$/i.test(clean)) {
        throw new Error('A kept thing is named in letters, digits and dashes — "' + name + '" is not.');
    }
    return clean + '.json';
}

//A FOLDER NAME THAT CANNOT BE TWO WORKSPACES.
//
//The readable half is the folder's own name, because somebody looking in the
//app's data directory should be able to tell whose drawer is whose. The other
//half is a sum over the WHOLE path, because two folders both called `workspace`
//in different places is not a hypothetical — it is the most likely form of
//exactly the contamination this file is about.
function slugFor(dir) {
    var full = path.resolve(String(dir)).toLowerCase();
    var base = path.basename(full).replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
    var sum = 0;
    for (var i = 0; i < full.length; i++) sum = (sum * 31 + full.charCodeAt(i)) >>> 0;
    return base + '-' + sum.toString(36);
}

plugin.consumes = ['dataDir'];
plugin.provides = ['state'];
async function plugin(imports, register) {
    var dataDir = imports.dataDir;

    //THE APP'S DRAWER, and the parent of every workspace drawer. `state` is
    //where ../events and ../../supervisor already keep theirs, so this is the
    //same place with one way in rather than a new place.
    var appDir = dataDir.at('state');
    var whereWorkspaces = dataDir.at('state', 'workspaces');

    //MADE ONCE PER RUN, NOT ONCE PER CALL. mkdir on a directory that already
    //exists is cheap and is still a syscall, and this sits on the read path of
    //things a pane asks every few seconds — in the old app it showed up as the
    //fourth most sampled function in an idle trace.
    var made = {};
    function ready(dir) {
        if (!made[dir]) {
            fs.mkdirSync(dir, { recursive: true });
            made[dir] = true;
        }
        return dir;
    }

    function docIn(dir, name) {
        var file = path.join(dir, fileName(name));

        return {
            path: file,

            //A MISSING FILE AND AN UNREADABLE ONE BOTH ANSWER THE FALLBACK.
            //Neither is recoverable here and both mean "there is nothing to go
            //on"; the difference is worth a line in a log rather than a decision
            //at every call site.
            read: function (fallback) {
                var text;
                try { text = fs.readFileSync(file, 'utf8'); }
                catch (e) { return fallback; }
                //A BYTE-ORDER MARK IN FRONT OF THE BRACE is what anything on
                //Windows picks up from having been opened in an editor, and
                //JSON.parse refuses it — which reads as corruption.
                try { return JSON.parse(text.replace(/^﻿/, '')); }
                catch (e) { return fallback; }
            },

            //WRITTEN BESIDE AND MOVED INTO PLACE. A writeFileSync straight over
            //the real file is a window in which the file is half a document —
            //and a reader that opens it then does not get an error, it gets the
            //fallback, which every call site treats as "nothing kept yet".
            //Losing the workspace to a flicker mid-write is a silent, total loss
            //that reads as a fresh install.
            write: function (value) {
                ready(dir);
                var beside = file + '.writing';
                fs.writeFileSync(beside, JSON.stringify(value, null, 2));
                fs.renameSync(beside, file);
                return value;
            },

            //FOR A THING THAT SHOULD STOP EXISTING rather than become `{}`. An
            //empty document and no document are different answers.
            forget: function () {
                try { fs.unlinkSync(file); return true; }
                catch (e) { return false; }
            }
        };
    }

    //WHO KNOWS WHERE WE ARE. Installed by ../../workspace; see the header for why
    //it arrives this way round rather than being asked for.
    var asking = null;

    async function openDir() {
        if (!asking) return null;
        try { return (await asking()) || null; }
        catch (e) {
            //A WORKSPACE THAT CANNOT BE DETERMINED IS NOT AN EMPTY ONE. Falling
            //back to the app drawer here would write a workspace's tasks into
            //the host's, which is the contamination this file exists to stop.
            return null;
        }
    }

    await register(null, {
        state: {
            //---- the host's own ----------------------------------------
            app: {
                doc: function (name) { return docIn(ready(appDir), name); },
                where: appDir
            },

            //---- the open workspace's ----------------------------------
            //
            //ASYNC, BECAUSE WHICH WORKSPACE IS OPEN IS NOT A CONSTANT. It is
            //resolved on every call, which is what makes the switch automatic:
            //nothing subscribes, nothing reloads, and there is no moment where
            //one pane is answering about the folder before last.
            here: {
                doc: async function (name) {
                    var open = await openDir();
                    if (!open) {
                        throw new Error(
                            'No workspace is open, so there is nowhere to keep "' + name + '". '
                            + 'This is about a workspace rather than about this host — see state.app for what is not.');
                    }
                    return docIn(ready(path.join(whereWorkspaces, slugFor(open))), name);
                },

                //WHETHER THERE IS ONE AT ALL, so a caller can ask before it
                //decides — rather than reading a refusal as a fault.
                open: async function () { return !!(await openDir()); },
                where: async function () {
                    var open = await openDir();
                    return open ? path.join(whereWorkspaces, slugFor(open)) : null;
                }
            },

            //THE WORKSPACE PLUGIN HANDS ITS OWN `dir` IN. One slot rather than a
            //list: two things claiming to know where we are is the disagreement
            //this whole file is about.
            follow: function (fn) {
                asking = fn;
                return function () { if (asking === fn) asking = null; };
            },

            slugFor: slugFor,
            where: appDir
        }
    });
}
module.exports = plugin;
