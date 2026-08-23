//---------------------------------------------------------------------------
//WHAT IS WRONG, AND WHAT IS WAITING ON A PERSON.
//
//The two questions the banner over every tab is drawn from. They are here for
//the reason every other action in this app is where it is: an action goes where
//the pane that asks for it is, and ./trouble.js is the only thing that asks.
//
//IT IS NOT A PANE, WHICH IS THE POINT OF IT. A banner is something that is true
//wherever you are, so it is mounted for as long as the window is — which makes
//these two the only answers in the app that are asked on a timer regardless of
//what somebody is looking at. Everything below is written to that: nothing here
//reaches the network, and the one thing that starts a process says so.
//
//---- and the banner was half blind ----------------------------------------
//
//BOTH OF THESE WERE STILL RELAYED, so with the app being ported from switched
//off they answered nothing at all — and the banner has no way to say that.
//Every line gated on them simply never appeared: the VirtualBox warning, the
//dirty-repository warning, and everything waiting to be approved. The three
//questions that HAD been ported went on working, so the banner looked alive.
//
//That is the shape worth remembering. A surface whose whole job is to notice
//things does not report its own blindness — it reports nothing, which is what it
//also does when there is nothing wrong.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'vbox', 'workspace', 'git', 'library'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    if (!actions) return register(null, {});

    var undo = [];

    //---- IS THIS HOST ABLE TO DO ANYTHING AT ALL --------------------------
    //
    //SAID IN THE BANNER AND NOT ONLY IN THE MACHINES PANEL, because it is a fact
    //about every tab: a task cannot be given out, a branch cannot be worked on,
    //and the reason has nothing to do with either of them.
    undo.push(actions.define('status', {
        about: 'Is this host able to work, and what has it got to work with',
        run: async function () {
            //`available()` AND `exe()` ARE ../../vms/vbox's ANSWER. Whether
            //VirtualBox is here is a question about this machine, and asking it
            //twice in two ways is how two panels come to disagree.
            var vbox = null;
            try { vbox = imports.vbox.available() ? imports.vbox.exe() : null; }
            catch (e) { /* not answering reads as not there, which it is */ }

            //---- WHICH REPOSITORIES ARE MID-CHANGE -----------------------
            //
            //THE LINE THIS FEEDS HAS NEVER FIRED, IN EITHER APP. Both windows
            //read `status.repos` and neither `status` ever returned it — so
            //`(status.repos || [])` was empty for as long as the warning has
            //existed, and a repository left dirty on a branch a machine needs
            //went on producing a push failure whose error is about a git
            //configuration variable. It was carried into this app faithfully,
            //dead line and all, and found by porting the action it reads.
            //
            //IT IS A GIT PROCESS PER REPOSITORY, on a ten-second draw. That is
            //the one cost in this file and it is worth naming: a working tree
            //changes without touching anything cacheable, so there is no cheaper
            //honest version. Three repositories is three processes every ten
            //seconds, against the nine every three seconds the app being ported
            //from warns about in its own `waiting`.
            //
            //AND A REPOSITORY THAT CANNOT BE ASKED IS LEFT OUT rather than
            //reported as dirty. `clean: null` means git would not say, and
            //drawing a warning off that would put a fault on screen for a
            //repository that may be perfectly fine.
            var repos = [];
            try {
                //WHERE EACH ONE IS AND WHERE IT IS MEANT TO BE comes from
                //`repositories`, which reads what was already written down — its
                //`default` is the home branch and its `head` is where the
                //working tree actually is. Asked for by name rather than
                //consumed, so this stays one hook on a banner rather than an
                //edge into the repository half of the app.
                //
                //IT IS NOT THE GATHER. `repositories` reads the kept notes; the
                //call that goes to GitHub is `repoSync`, and a banner drawn on a
                //timer must never be the thing that reaches the network.
                var known = {};
                try {
                    var said = await actions.call('repositories', {});
                    ((said && said.repos) || []).forEach(function (r) { known[r.repo] = r; });
                } catch (e) { /* the names still come from the workspace below */ }

                //`{ name, dir }` ROWS, and only the name is used — ../../git
                //takes a NAME and turns it into a folder itself, which is the
                //boundary that keeps a path from a caller out of a git process.
                var found = await imports.workspace.repos();
                for (var i = 0; i < (found || []).length; i++) {
                    var name = found[i].name;
                    var how = await imports.git.workingTree(name);

                    //A REPOSITORY GIT WOULD NOT ANSWER ABOUT IS LEFT OUT rather
                    //than reported as dirty: `clean: null` means it could not
                    //tell, and drawing a warning off that puts a fault on screen
                    //for a repository that may be perfectly fine.
                    if (how.clean === null) continue;

                    //THE BRANCH, NOT THE COMMIT. `repositories` carries `head`
                    //and it is a SHA — the first version of this used it and the
                    //warning read `local-repo-c is on "35cb557b7af3..." here with
                    //uncommitted changes`, which names the one thing nobody can
                    //act on. What somebody has to put back is a branch, so the
                    //branch is what ../../git is asked for.
                    var on = null;
                    try { on = await imports.git.head(name); }
                    catch (e) { /* a repository with no commits has no branch yet */ }

                    var one = known[name] || {};
                    repos.push({
                        repo: name,
                        clean: how.clean,
                        files: how.files,
                        on: on,
                        //AND WHERE IT IS MEANT TO BE, which is the repository's
                        //default branch as already written down.
                        home: one.default || null
                    });
                }
            } catch (e) { /* no workspace open: there is nothing to be dirty */ }

            var open = null;
            try {
                var dir = await imports.workspace.dir();
                if (dir) open = { dir: dir, repos: repos.length };
            } catch (e) { /* none open, which is a state */ }

            return {
                ok: true,
                virtualbox: vbox,
                repos: repos,
                //NULL MEANS NONE IS OPEN, which is a state and not a failure —
                //so it has to be tellable from the poll having gone wrong.
                workspace: open,
                pid: process.pid
            };
        }
    }));


    //---- AND WHAT IS WAITING ON A PERSON ----------------------------------
    //
    //ONE THING TODAY, AND THE ANSWER SAYS SO. The app being ported from counts
    //six kinds here — approvals, verdicts, changes written and not sent, changes
    //out and not merged, pull requests that arrived, and what the supervisor
    //said. Only the first is answerable in this app yet.
    //
    //A PARTIAL ANSWER IN THE SHAPE OF A COMPLETE ONE IS THE FAILURE THIS WHOLE
    //FILE IS ABOUT, so `counts` names every kind and marks the ones nothing can
    //answer as `null` rather than `0`. Zero is a claim that there are none.
    undo.push(actions.define('waiting', {
        about: 'What is waiting on a person: things to approve, and what is not counted yet',
        run: async function () {
            //A MODEL MAY WRITE A JOB, A PROMPT OR A CONTRACT AND MAY NOT APPROVE
            //ITS OWN. That is the whole reason this is on a banner: nothing runs
            //one until somebody has read it, so an unread one is work that has
            //silently stopped.
            var unapproved = [];
            try {
                var lib = imports.library;
                [['job', lib.jobs], ['prompt', lib.prompts], ['contract', lib.contracts]].forEach(function (pair) {
                    var kind = pair[0];
                    var shelf = pair[1];
                    if (!shelf || !shelf.all) return;
                    (shelf.all() || []).filter(function (it) { return !it.approved; }).forEach(function (it) {
                        unapproved.push({
                            kind: kind,
                            //WHICH TAB IT IS ON. There are two libraries: "task"
                            //ones are under Actions, "judge" ones under Judge →
                            //Judges. Counting them together and sending somebody
                            //to Actions opens a pane the thing is not on, which
                            //reads as a button that fails to switch tabs.
                            of: String(it.kind || 'task') === 'judge' ? 'judge' : 'task',
                            id: it.id,
                            name: it.name
                        });
                    });
                });
            } catch (e) { /* the library is not answering; `counts` says so below */ }

            var counts = {
                approvals: unapproved.length,
                //NULL, NOT ZERO. Nothing in this app can answer these yet, and
                //`0` would say there are none of them waiting.
                verdicts: null,
                unsent: null,
                out: null,
                arrived: null,
                supervisor: null
            };

            return {
                approvals: unapproved,
                approvalsForTasks: unapproved.filter(function (a) { return a.of === 'task'; }),
                approvalsForJudges: unapproved.filter(function (a) { return a.of === 'judge'; }),
                counts: counts,
                total: unapproved.length,
                //WHAT IS NOT BEING COUNTED, BY NAME, so a total of zero cannot be
                //read as "nothing is waiting on you" while five kinds of thing
                //are not being looked at.
                notCounted: ['verdicts', 'unsent', 'out', 'arrived', 'supervisor'],
                note: unapproved.length
                    ? unapproved.length + (unapproved.length === 1 ? ' thing is' : ' things are')
                        + ' waiting for you to approve.'
                    : 'Nothing is waiting for you to approve. Verdicts, changes to send, changes out '
                        + 'and pull requests that arrived are not counted here yet.'
            };
        }
    }));

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
