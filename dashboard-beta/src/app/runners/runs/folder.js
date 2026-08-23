//---------------------------------------------------------------------------
//WHICH DIRECTORY WORK RUNS IN, ON THE MACHINE.
//
//---- the bug this exists for, which was half-fixed --------------------------
//
//THE DEFAULT FOLDER IS A SHELL EXPANSION. `$HOME/workspace` — see
//../../repositories/repos/workspace.js, `FOLDER`.
//
//EVERYTHING THAT REACHES A GUEST IS SINGLE-QUOTED, deliberately, so nothing in a
//path can run as code. That is right, and it means an expansion does not expand:
//
//    the workspace is BUILT with   WS="$HOME/workspace"      -> /home/okc/workspace
//    the work is RUN with          cd '$HOME/workspace'      -> no such directory
//
//and the run line ends `|| cd "$HOME"`. So the workspace is laid out in one
//place and the work happens in another, the fallback hides it, and the machine
//reports success. A job then reported `$HOME` as its workspace: wrong, and wrong
//quietly.
//
//THE APP BEING PORTED FROM FIXED THIS FOR JOBS AND NOT FOR TASKS. `workFolder`
//sits in actions/shared.js and only `jobRun` calls it; `vmDispatch` passes the
//folder through as written, so every task on a default folder has been running
//in the home directory. Both paths resolve it here.
//
//---- asked of the machine, not assumed --------------------------------------
//
//`$HOME` is whatever the guest says it is. Hard-coding `/home/okc` would be this
//host deciding something about somebody else's computer, and it is wrong the
//first time a machine is built with a different user.
//---------------------------------------------------------------------------

//WHAT AN EXPANSION MEANS, given what the machine said its home is.
//
//ONLY AT THE FRONT, and only these two. `$HOME` and `~` are the two ways the
//folder is ever written; expanding either in the MIDDLE of a path would be this
//file doing a shell's job on text it does not own — a directory legitimately
//called `back~up` is not a home directory reference.
function resolveHome(folder, home) {
    var where = String(folder == null ? '' : folder);
    var at = String(home == null ? '' : home).replace(/\/+$/, '');
    if (!where || !at) return where;

    //`$HOME` followed by a boundary, so `$HOMEWORK` is left alone.
    if (/^\$HOME(\/|$)/.test(where)) return at + where.slice('$HOME'.length);
    if (/^~(\/|$)/.test(where)) return at + where.slice(1);
    return where;
}

//WHETHER IT STILL LOOKS LIKE AN EXPANSION AFTERWARDS.
//
//A folder written `${HOME}/work` or `$WORKSPACE` is not something this resolves,
//and sending it would reproduce the silent fallback with a different spelling.
//Named rather than guessed at: the caller decides whether to refuse, and the
//message says which part of the path nothing will expand.
function stillUnexpanded(folder) {
    var where = String(folder == null ? '' : folder);
    var found = where.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/);
    return found ? found[0] : null;
}

module.exports = function folder(deps) {
    var d = deps || {};

    var homeOf = d.homeOf;        //async (machine) -> the guest's $HOME
    var defaultFor = d.defaultFor; //(machine) -> the folder when none was asked for

    //ASKED ONCE PER RUN, not cached. A machine can be rebuilt under this app
    //with a different user, and a cached home would then send work into a
    //directory that no longer exists — which the `|| cd "$HOME"` fallback would
    //hide all over again.
    async function on(machine, asked) {
        var where = asked || defaultFor(machine);
        var home = await homeOf(machine);
        var out = resolveHome(where, home);

        var left = stillUnexpanded(out);
        if (left) {
            throw new Error('"' + where + '" has ' + left + ' in it, and nothing expands that on the '
                + 'way to the machine — everything sent there is quoted so a path cannot run as code. '
                + 'The work would silently run in the home directory instead. Write the path out, or '
                + 'use $HOME or ~ at the front.');
        }

        return out;
    }

    return { on: on };
};

module.exports.resolveHome = resolveHome;
module.exports.stillUnexpanded = stillUnexpanded;
