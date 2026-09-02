var os = require('node:os');
var path = require('node:path');

//---------------------------------------------------------------------------
//where this app's data lives on disk, worked out once.
//
//IT IS DERIVED FROM `name` IN package.json, AND THAT IS NOT OBVIOUS.
//
//NW.js picks its profile directory from the package name, and everything else
//that wants a place to put something has followed it there. So:
//
//    package.json  "name": "dashboard-beta"
//    Windows       %LOCALAPPDATA%\dashboard-beta\
//    elsewhere     ~/.config/dashboard-beta/
//
//WHICH MEANS RENAMING THE APP MOVES ITS DATA, SILENTLY. Change that one string
//and the next launch looks in a directory that does not exist yet, finds
//nothing, and behaves exactly as though this were a first run:
//
//  the nw profile is new         localStorage is empty, so the remembered tab,
//                                pane and selection are gone. See ../remember.
//  DevToolsActivePort is absent  `windowShot` cannot find the debugger and
//                                photographing the window stops working.
//
//None of that announces itself. It reads as "the app lost my settings", which
//is a search in the wrong place.
//
//AND IT IS WHY THIS APP AND THE ONE IT IS PORTED FROM DO NOT COLLIDE. They are
//`dashboard-beta` and `okc-dashboard`, so they have separate profiles, separate
//data, separate everything — different names in different package.json files,
//and nothing else keeping them apart. The only channel between them is the
//relay in ../okc, which asks the other app's action table for answers. Neither
//reaches into the other's files, and neither should learn how.
//
//THE POINT OF PUTTING IT HERE: two plugins were each rebuilding this path from
//`appPackage.name` on their own — the guards plugin for its file, since removed,
//and shot for the debugger port. Two derivations of one fact is how a rename
//becomes a mystery in one place and not the other.
//
//WHAT BELONGS IN IT. Things the main side owns and the page may not reach:
//anything where being out of the page's reach is the point.
//Not where somebody was looking — that is the browser's, and ../remember says
//why. Not anything a person typed into a guarded field.
//---------------------------------------------------------------------------

plugin.consumes = ['app'];
plugin.provides = ['dataDir'];
async function plugin(imports, register) {
    var app = imports.app;
    var name = (app.appPackage && app.appPackage.name) || 'okc-app';

    var dir = process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || os.homedir(), name)
        : path.join(os.homedir(), '.config', name);

    await register(null, {
        dataDir: {
            //The directory itself, and the name it came from — so anything
            //reporting a path can also report WHY it is that path.
            path: dir,
            from: name,
            at: function (/* ...parts */) {
                return path.join.apply(path, [dir].concat([].slice.call(arguments)));
            }
        }
    });
}
module.exports = plugin;
